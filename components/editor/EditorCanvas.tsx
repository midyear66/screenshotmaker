"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Text,
  Group,
  Path,
  Transformer,
} from "react-konva";
import type Konva from "konva";
import {
  PANEL_GAP_PX as PANEL_GAP_PX_FROM_TYPES,
  PANEL_H,
  PANEL_W,
  TemplateConfig,
  TextElement,
  IconElement,
  DeviceElement,
  CanvasElement,
  ScreenshotAsset,
  isCustomIcon,
  customIconPath,
  panelIdxFor,
} from "@/lib/editor-types";
import { renderBackgroundCanvas } from "@/lib/background";
import { ICON_VIEWBOX_SIZE, ICONS } from "@/lib/icons";
import { autoWidth, measureTextPx } from "@/lib/textMeasure";
import { BEZEL_W, BEZEL_H, CORNER_RADIUS } from "@/lib/deviceFrame";
import { DeviceFrame } from "./DeviceFrame";
import { useImage } from "./useImage";

function fontFamilyOf(el: TextElement, template: TemplateConfig): string {
  return el.fontFamily ?? template.fontFamily;
}

/** Use the shared constant. */
const PANEL_GAP_PX = PANEL_GAP_PX_FROM_TYPES;

function panelXToDisplayX(panelX: number, panelCount: number): number {
  // Each integer boundary crossed adds one gap of shift. Clamp the gap count
  // so positions beyond the last panel don't accumulate phantom gaps.
  const flooredShift = Math.min(panelCount - 1, Math.max(0, Math.floor(panelX)));
  return panelX * PANEL_W + flooredShift * PANEL_GAP_PX;
}

function displayXToPanelX(displayX: number, panelCount: number): number {
  // If displayX is inside any panel band, invert linearly.
  for (let i = 0; i < panelCount; i++) {
    const panelStart = i * (PANEL_W + PANEL_GAP_PX);
    const panelEnd = panelStart + PANEL_W;
    if (displayX >= panelStart && displayX <= panelEnd) {
      return i + (displayX - panelStart) / PANEL_W;
    }
  }
  // Otherwise we're inside a gap (or past the last panel). Snap to nearest
  // adjacent panel edge — we can't represent "centred in the gap" because
  // panel_x is gap-free by definition.
  for (let i = 0; i < panelCount - 1; i++) {
    const gapStart = i * (PANEL_W + PANEL_GAP_PX) + PANEL_W;
    const gapEnd = gapStart + PANEL_GAP_PX;
    if (displayX > gapStart && displayX < gapEnd) {
      const distLeft = displayX - gapStart;
      const distRight = gapEnd - displayX;
      // Snap to right edge of panel i, or left edge of panel i+1.
      return distLeft <= distRight ? i + 0.999 : i + 1.0;
    }
  }
  // Past the last panel: clamp to its right edge.
  return panelCount > 0 ? panelCount - 0.001 : 0;
}

function totalStageWidth(panelCount: number): number {
  return panelCount * PANEL_W + Math.max(0, panelCount - 1) * PANEL_GAP_PX;
}

type Props = {
  template: TemplateConfig;
  screenshots: ScreenshotAsset[];
  selectedElementId?: string | null;
  readOnly?: boolean;
  maxWidthClass?: string;
  /** Override perspective subdivisions; default 20 for live editor. */
  tiltSubdivisions?: number;
  onChange?: (next: TemplateConfig) => void;
  onSelectElement?: (id: string | null) => void;
};

type EditingState = {
  id: string;
  left: number;
  top: number;
  fontSize: number;
  rotation: number;
  weight: number;
  italic: boolean;
  color: string;
  align: "left" | "center" | "right";
  fontFamily: string;
  initialText: string;
};

export function EditorCanvas({
  template,
  screenshots,
  selectedElementId = null,
  readOnly = false,
  maxWidthClass = "max-w-6xl",
  tiltSubdivisions = 20,
  onChange,
  onSelectElement,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const editingTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [displayWidth, setDisplayWidth] = useState(800);
  const [editing, setEditing] = useState<EditingState | null>(null);
  // While an element is being dragged or transformed, its panel's clip rect
  // is suppressed so the node stays visible as it crosses into the gap or
  // into a neighbouring tile. Re-applied on drag/transform end.
  const [interactingPanelIdx, setInteractingPanelIdx] = useState<number | null>(
    null
  );

  const panelCount = Math.max(1, template.panelCount);
  const canvasW = totalStageWidth(panelCount);
  const canvasH = PANEL_H;

  const bgImageUrl = template.bgImagePath ? `/api/uploads/${template.bgImagePath}` : null;
  const bgImage = useImage(bgImageUrl);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDisplayWidth(entry.contentRect.width);
      }
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  const scale = displayWidth / canvasW;
  const displayHeight = canvasH * scale;
  const fallbackColor = template.backgroundColor;

  // Render the background as N per-panel slices using `gap: 0` so the
  // editor shows EXACTLY what each exported PNG will contain. The gap
  // areas between panels stay white (or fallback colour) — the source
  // image is split into N equal parts of its cover-fit area, with no
  // source pixels lost between bands. Sliding the panels together would
  // reconstruct the full cover-fit area continuously.
  const panelBgs = useMemo(() => {
    const slot = {
      devicePos: { x: 0, y: 0 },
      deviceScale: 1,
      deviceRotation: 0,
      deviceTiltX: 0,
      deviceTiltY: 0,
      bgImagePan: { x: 0, y: 0 },
      bgImageZoom: 1,
      bgImageBlur: 0,
      bgImageBrightness: 1,
      elements: [],
    };
    return Array.from({ length: panelCount }, (_, i) =>
      renderBackgroundCanvas({
        width: PANEL_W,
        height: PANEL_H,
        bgImage,
        slot,
        fallbackColor,
        panorama: {
          slotIndex: i,
          totalSlots: panelCount,
          gap: 0,
        },
      })
    );
  }, [bgImage, fallbackColor, panelCount]);

  const selectedElement = template.elements.find((e) => e.id === selectedElementId) ?? null;

  // Partition every element into the tile it renders inside. Each tile gets
  // its own Konva.Group with a clip rect, hard-cropping anything that
  // crosses the tile edge. Devices use their explicit `panelIndex` so the
  // tile assignment is stable while the user drags them around — dragging
  // never changes which tile a device belongs to. Text + icons still infer
  // their tile from `pos.x`.
  const elementsByPanel = useMemo(() => {
    const buckets: CanvasElement[][] = Array.from(
      { length: panelCount },
      () => []
    );
    for (const el of template.elements) {
      const idx = panelIdxFor(el, panelCount);
      buckets[idx].push(el);
    }
    return buckets;
  }, [template.elements, panelCount]);

  // ---- Attach/detach Transformer ----
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    if (!selectedElementId || editing) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const stage = stageRef.current;
    const node = stage?.findOne(`#${selectedElementId}`);
    if (node) {
      tr.nodes([node]);
      tr.getLayer()?.batchDraw();
    } else {
      tr.nodes([]);
    }
  }, [selectedElementId, editing, template.elements]);

  const transformerAnchors = useMemo(
    () => ["top-left", "top-right", "bottom-left", "bottom-right"],
    []
  );

  function patchElement(id: string, patch: Partial<CanvasElement>) {
    if (!onChange) return;
    const elements = template.elements.map((el) =>
      el.id === id ? ({ ...el, ...patch } as CanvasElement) : el
    );
    onChange({ ...template, elements });
  }

  function handleTransformStart() {
    const tr = trRef.current;
    if (!tr) return;
    tr.keepRatio(true);
    if (selectedElement) {
      setInteractingPanelIdx(panelIdxFor(selectedElement, panelCount));
    }
  }

  function handleTransformEnd(e: Konva.KonvaEventObject<Event>) {
    const node = e.target;
    const sx = node.scaleX();
    const sy = node.scaleY();
    const rotation = node.rotation();

    const id = node.id();
    const el = template.elements.find((e) => e.id === id);
    if (!el) return;

    // Elements live inside a per-tile clip group offset by
    // `panelIdx * (PANEL_W + PANEL_GAP_PX)`. Add that back so `node.x()`
    // (which is group-local) converts to the same display-space coord
    // `displayXToPanelX` expects. For devices the owning tile is fixed
    // (`el.panelIndex`); for text/icons it's inferred from the pre-drag
    // `pos.x`.
    const panelIdx = panelIdxFor(el, panelCount);
    const groupX = panelIdx * (PANEL_W + PANEL_GAP_PX);
    const newPos = {
      x: displayXToPanelX(node.x() + groupX, panelCount),
      y: node.y() / PANEL_H,
    };
    node.scaleX(1);
    node.scaleY(1);

    const factor = Math.max(sx, sy);

    if (el.type === "text") {
      const newFontSize = Math.max(8, el.fontSize * factor);
      const newWidth = autoWidth(el.text, {
        fontSize: newFontSize,
        fontFamily: fontFamilyOf(el, template),
        weight: el.weight,
        italic: el.italic,
      });
      patchElement(id, {
        fontSize: newFontSize,
        width: newWidth,
        rotation,
        pos: newPos,
      });
    } else if (el.type === "device") {
      patchElement(id, {
        size: Math.max(0.05, el.size * factor),
        rotation,
        pos: newPos,
        // Lock the device's tile so a transform near the edge doesn't
        // re-partition it into an adjacent tile.
        panelIndex: panelIdx,
      });
    } else {
      patchElement(id, {
        size: Math.max(12, el.size * factor),
        rotation,
        pos: newPos,
      });
    }
    setInteractingPanelIdx(null);
  }

  // ---- Inline text editor ----
  function beginEditingText(el: TextElement) {
    if (!stageRef.current || !wrapperRef.current) return;
    const cx = panelXToDisplayX(el.pos.x, panelCount);
    const cy = el.pos.y * PANEL_H;
    const screenCx = cx * scale;
    const screenCy = cy * scale;
    const screenFont = el.fontSize * scale;
    const family = fontFamilyOf(el, template);

    setEditing({
      id: el.id,
      left: screenCx,
      top: screenCy,
      fontSize: screenFont,
      rotation: el.rotation,
      weight: el.weight,
      italic: el.italic,
      color: el.color,
      align: el.align,
      fontFamily: family,
      initialText: el.text,
    });
  }

  useEffect(() => {
    if (editing && editingTextareaRef.current) {
      const ta = editingTextareaRef.current;
      ta.focus();
      ta.select();
      sizeTextarea(ta, editing);
    }
  }, [editing]);

  function sizeTextarea(ta: HTMLTextAreaElement, e: EditingState) {
    const widestPx = measureTextPx(ta.value, {
      fontSize: e.fontSize,
      fontFamily: e.fontFamily,
      weight: e.weight,
      italic: e.italic,
    });
    ta.style.width = `${Math.max(20, widestPx + 8)}px`;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }

  function commitEdit() {
    if (!editing) return;
    const next = editingTextareaRef.current?.value ?? editing.initialText;
    const el = template.elements.find((e) => e.id === editing.id);
    if (!el || el.type !== "text") {
      setEditing(null);
      return;
    }
    const newWidth = autoWidth(next, {
      fontSize: el.fontSize,
      fontFamily: fontFamilyOf(el, template),
      weight: el.weight,
      italic: el.italic,
    });
    patchElement(editing.id, { text: next, width: newWidth });
    setEditing(null);
  }

  function cancelEdit() {
    setEditing(null);
  }

  return (
    <div
      ref={wrapperRef}
      className={`relative w-full ${maxWidthClass} mx-auto`}
      style={{ aspectRatio: `${canvasW} / ${canvasH}` }}
    >
      <Stage
        ref={stageRef}
        width={displayWidth}
        height={displayHeight}
        scaleX={scale}
        scaleY={scale}
        className="rounded-2xl overflow-hidden shadow-xl"
        onMouseDown={(e) => {
          if (readOnly || !onSelectElement) return;
          const target = e.target;
          const stage = target.getStage();
          if (target === stage || target.name() === "bg") {
            onSelectElement(null);
          }
        }}
      >
        <Layer>
          {/* Stage backdrop — fills gap regions with white (or fallback). */}
          <KonvaImage
            image={undefined}
            x={0}
            y={0}
            width={canvasW}
            height={canvasH}
            fill="#ffffff"
            name="bg"
            listening={!readOnly}
          />

          {/* Per-panel bg slices, drawn at gap-shifted display positions. */}
          {panelBgs.map((bg, i) => (
            <KonvaImage
              key={`bg-${i}`}
              image={bg}
              x={i * (PANEL_W + PANEL_GAP_PX)}
              y={0}
              width={PANEL_W}
              height={PANEL_H}
              name="bg"
              listening={!readOnly}
            />
          ))}

          {/* One clip group per panel — Konva enforces a rectangular clip
              at the tile bounds, so a device near the right edge of tile N
              is cut at the gap instead of bleeding into the next tile.
              While an element in this panel is being dragged or transformed,
              the clip is dropped so the node stays visible past the edge. */}
          {elementsByPanel.map((panelElements, panelIdx) => {
            const clipProps =
              interactingPanelIdx === panelIdx
                ? {}
                : {
                    clipX: 0,
                    clipY: 0,
                    clipWidth: PANEL_W,
                    clipHeight: PANEL_H,
                  };
            return (
            <Group
              key={`panel-${panelIdx}`}
              x={panelIdx * (PANEL_W + PANEL_GAP_PX)}
              y={0}
              {...clipProps}
            >
              {panelElements.map((el) => {
                if (el.type === "text") {
                  const blockW = el.width * PANEL_W;
                  const cx = (el.pos.x - panelIdx) * PANEL_W;
                  const cy = el.pos.y * PANEL_H;
                  const isEditing = editing?.id === el.id;
                  if (isEditing) return null;
                  return (
                    <Text
                      key={el.id}
                      id={el.id}
                      x={cx}
                      y={cy}
                      width={blockW}
                      offsetX={blockW / 2}
                      offsetY={el.fontSize * 0.6}
                      rotation={el.rotation}
                      align={el.align}
                      text={el.text}
                      fontSize={el.fontSize}
                      fontFamily={fontFamilyOf(el, template)}
                      fontStyle={`${el.italic ? "italic " : ""}${el.weight}`}
                      fill={el.color}
                      draggable={!readOnly}
                      onMouseDown={(e) => {
                        if (readOnly || !onSelectElement) return;
                        e.cancelBubble = true;
                        onSelectElement(el.id);
                      }}
                      onDblClick={() => {
                        if (readOnly) return;
                        beginEditingText(el);
                      }}
                      onDblTap={() => {
                        if (readOnly) return;
                        beginEditingText(el);
                      }}
                      onDragStart={() => setInteractingPanelIdx(panelIdx)}
                      onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                        const node = e.target;
                        const displayX =
                          node.x() + panelIdx * (PANEL_W + PANEL_GAP_PX);
                        patchElement(el.id, {
                          pos: {
                            x: displayXToPanelX(displayX, panelCount),
                            y: node.y() / PANEL_H,
                          },
                        });
                        setInteractingPanelIdx(null);
                      }}
                      onTransformStart={handleTransformStart}
                      onTransformEnd={handleTransformEnd}
                    />
                  );
                }

                if (el.type === "device") {
                  return (
                    <DeviceNode
                      key={el.id}
                      el={el}
                      template={template}
                      screenshots={screenshots}
                      readOnly={readOnly}
                      tiltSubdivisions={tiltSubdivisions}
                      panelCount={panelCount}
                      panelIdx={panelIdx}
                      onSelect={(id) => onSelectElement?.(id)}
                      onMove={(id, pos) => {
                        // Lock the device's tile to whichever group it's
                        // currently rendered in. Prevents drag from
                        // re-partitioning the device into a neighbouring
                        // tile just because its centre crossed an edge.
                        patchElement(id, { pos, panelIndex: panelIdx });
                        setInteractingPanelIdx(null);
                      }}
                      onDragStart={() => setInteractingPanelIdx(panelIdx)}
                      onTransformStart={handleTransformStart}
                      onTransformEnd={handleTransformEnd}
                    />
                  );
                }

                // Icon element
                if (isCustomIcon(el.icon)) {
                  return (
                    <CustomIconNode
                      key={el.id}
                      el={el}
                      readOnly={readOnly}
                      panelCount={panelCount}
                      panelIdx={panelIdx}
                      onSelect={(id) => onSelectElement?.(id)}
                      onMove={(id, pos) => {
                        patchElement(id, { pos });
                        setInteractingPanelIdx(null);
                      }}
                      onDragStart={() => setInteractingPanelIdx(panelIdx)}
                      onTransformStart={handleTransformStart}
                      onTransformEnd={handleTransformEnd}
                    />
                  );
                }
                const def = ICONS[el.icon];
                if (!def) return null;
                const cx = (el.pos.x - panelIdx) * PANEL_W;
                const cy = el.pos.y * PANEL_H;
                const iconScale = el.size / ICON_VIEWBOX_SIZE;
                return (
                  <Path
                    key={el.id}
                    id={el.id}
                    x={cx}
                    y={cy}
                    data={def.path}
                    fill={def.stroke ? undefined : el.color}
                    stroke={def.stroke ? el.color : undefined}
                    strokeWidth={def.stroke ? 2 : 0}
                    strokeScaleEnabled={false}
                    lineCap="round"
                    lineJoin="round"
                    scaleX={iconScale}
                    scaleY={iconScale}
                    offsetX={ICON_VIEWBOX_SIZE / 2}
                    offsetY={ICON_VIEWBOX_SIZE / 2}
                    rotation={el.rotation}
                    draggable={!readOnly}
                    onMouseDown={(e) => {
                      if (readOnly || !onSelectElement) return;
                      e.cancelBubble = true;
                      onSelectElement(el.id);
                    }}
                    onDragStart={() => setInteractingPanelIdx(panelIdx)}
                    onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                      const node = e.target;
                      const displayX =
                        node.x() + panelIdx * (PANEL_W + PANEL_GAP_PX);
                      patchElement(el.id, {
                        pos: {
                          x: displayXToPanelX(displayX, panelCount),
                          y: node.y() / PANEL_H,
                        },
                      });
                      setInteractingPanelIdx(null);
                    }}
                    onTransformStart={handleTransformStart}
                    onTransformEnd={handleTransformEnd}
                  />
                );
              })}
            </Group>
            );
          })}

          {!readOnly && (
            <Transformer
              ref={trRef}
              rotateEnabled
              enabledAnchors={transformerAnchors}
              anchorSize={10}
              anchorStroke="#60a5fa"
              borderStroke="#60a5fa"
              borderDash={[6, 4]}
              rotateAnchorOffset={32}
              ignoreStroke
            />
          )}
        </Layer>
      </Stage>

      {editing && (
        <textarea
          ref={editingTextareaRef}
          defaultValue={editing.initialText}
          onInput={(e) => sizeTextarea(e.currentTarget, editing)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEdit();
            }
          }}
          style={{
            position: "absolute",
            left: editing.left,
            top: editing.top,
            transform: `translate(-50%, -50%) rotate(${editing.rotation}deg)`,
            transformOrigin: "50% 50%",
            fontSize: editing.fontSize,
            fontFamily: editing.fontFamily,
            fontWeight: editing.weight,
            fontStyle: editing.italic ? "italic" : "normal",
            color: editing.color,
            textAlign: editing.align,
            background: "rgba(0,0,0,0.25)",
            border: "1px dashed #60a5fa",
            outline: "none",
            padding: 0,
            margin: 0,
            resize: "none",
            overflow: "hidden",
            whiteSpace: "pre",
            lineHeight: 1.2,
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
}

/**
 * A DeviceElement rendered as a Konva.Image of the warped device canvas.
 * Pulls its screenshot from the project's screenshots pool by id.
 */
function DeviceNode({
  el,
  template,
  screenshots,
  readOnly,
  tiltSubdivisions,
  panelCount,
  panelIdx,
  onSelect,
  onMove,
  onDragStart,
  onTransformStart,
  onTransformEnd,
}: {
  el: DeviceElement;
  template: TemplateConfig;
  screenshots: ScreenshotAsset[];
  readOnly: boolean;
  tiltSubdivisions: number;
  panelCount: number;
  panelIdx: number;
  onSelect: (id: string) => void;
  onMove: (id: string, pos: { x: number; y: number }) => void;
  onDragStart?: () => void;
  onTransformStart: () => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
}) {
  const screenshotPath = el.screenshotId
    ? screenshots.find((s) => s.id === el.screenshotId)?.path
    : undefined;
  const screenshotUrl = screenshotPath ? `/api/uploads/${screenshotPath}` : null;
  const screenshot = useImage(screenshotUrl);

  // Panel-local coords — this node lives inside the panel's clip Group.
  const cx = (el.pos.x - panelIdx) * PANEL_W;
  const cy = el.pos.y * PANEL_H;
  const deviceScale = (el.size * PANEL_W) / BEZEL_W;

  return (
    <Group
      id={el.id}
      x={cx}
      y={cy}
      scaleX={deviceScale}
      scaleY={deviceScale}
      rotation={el.rotation}
      draggable={!readOnly}
      onMouseDown={(e) => {
        if (readOnly) return;
        e.cancelBubble = true;
        onSelect(el.id);
      }}
      onDragStart={onDragStart}
      onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.target;
        const displayX = node.x() + panelIdx * (PANEL_W + PANEL_GAP_PX);
        onMove(el.id, {
          x: displayXToPanelX(displayX, panelCount),
          y: node.y() / PANEL_H,
        });
      }}
      onTransformStart={onTransformStart}
      onTransformEnd={onTransformEnd}
    >
      <DeviceFrame
        slotNumber={0}
        screenshot={screenshot}
        bezelColor={template.bezelColor}
        cornerRadius={template.bezelCornerRadius ?? CORNER_RADIUS}
        tiltX={el.tiltX}
        tiltY={el.tiltY}
        subdivisions={tiltSubdivisions}
      />
    </Group>
  );
}

function CustomIconNode({
  el,
  readOnly,
  panelCount,
  panelIdx,
  onSelect,
  onMove,
  onDragStart,
  onTransformStart,
  onTransformEnd,
}: {
  el: IconElement;
  readOnly: boolean;
  panelCount: number;
  panelIdx: number;
  onSelect: (id: string) => void;
  onMove: (id: string, pos: { x: number; y: number }) => void;
  onDragStart?: () => void;
  onTransformStart: () => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
}) {
  const url = `/api/uploads/${customIconPath(el.icon)}`;
  const image = useImage(url);

  const cx = (el.pos.x - panelIdx) * PANEL_W;
  const cy = el.pos.y * PANEL_H;
  let w = el.size;
  let h = el.size;
  if (image && image.width > 0 && image.height > 0) {
    if (image.width >= image.height) {
      w = el.size;
      h = el.size * (image.height / image.width);
    } else {
      h = el.size;
      w = el.size * (image.width / image.height);
    }
  }

  return (
    <KonvaImage
      id={el.id}
      image={image ?? undefined}
      x={cx}
      y={cy}
      width={w}
      height={h}
      offsetX={w / 2}
      offsetY={h / 2}
      rotation={el.rotation}
      draggable={!readOnly}
      onMouseDown={(e) => {
        if (readOnly) return;
        e.cancelBubble = true;
        onSelect(el.id);
      }}
      onDragStart={onDragStart}
      onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.target;
        const displayX = node.x() + panelIdx * (PANEL_W + PANEL_GAP_PX);
        onMove(el.id, {
          x: displayXToPanelX(displayX, panelCount),
          y: node.y() / PANEL_H,
        });
      }}
      onTransformStart={onTransformStart}
      onTransformEnd={onTransformEnd}
    />
  );
}

// Avoid an unused-warning for BEZEL_H import; some bundlers complain.
void BEZEL_H;
