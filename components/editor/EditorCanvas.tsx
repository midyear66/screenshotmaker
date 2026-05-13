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
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  SlotConfig,
  SlotElement,
  TemplateConfig,
  TextElement,
  IconElement,
  isCustomIcon,
  customIconPath,
} from "@/lib/editor-types";
import { renderBackgroundCanvas } from "@/lib/background";
import { ICON_VIEWBOX_SIZE, ICONS } from "@/lib/icons";
import { autoWidth, measureTextPx } from "@/lib/textMeasure";
import { DeviceFrame } from "./DeviceFrame";
import { useImage } from "./useImage";

function fontFamilyOf(el: TextElement, template: TemplateConfig): string {
  return el.fontFamily ?? template.fontFamily;
}

type Props = {
  template: TemplateConfig;
  slot: SlotConfig;
  slotNumber: number;
  /** Total slots in the template; used for panorama mode slicing. */
  totalSlots: number;
  screenshotUrl?: string | null;
  readOnly?: boolean;
  maxWidthClass?: string;
  /** Override perspective subdivisions; default 20 for live editor. */
  tiltSubdivisions?: number;
  /** ID of the currently selected element (Transformer wraps this node). */
  selectedElementId?: string | null;
  onChange?: (next: SlotConfig) => void;
  onSelectElement?: (id: string | null) => void;
};

type EditingState = {
  id: string;
  /** Centre of the editor in CSS px relative to the wrapper div. */
  left: number;
  top: number;
  width: number;
  /** CSS font-size to apply (already scaled to display px). */
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
  slot,
  slotNumber,
  totalSlots,
  screenshotUrl,
  readOnly = false,
  maxWidthClass = "max-w-md",
  tiltSubdivisions = 20,
  selectedElementId = null,
  onChange,
  onSelectElement,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const editingTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [displayWidth, setDisplayWidth] = useState(400);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const screenshot = useImage(screenshotUrl ?? null);
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

  const scale = displayWidth / CANVAS_WIDTH;
  const displayHeight = CANVAS_HEIGHT * scale;
  const fallbackColor = slot.backgroundColor ?? template.backgroundColor;

  const bgCanvas = useMemo(
    () =>
      renderBackgroundCanvas({
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        bgImage,
        slot,
        fallbackColor,
        panorama:
          template.bgImageMode === "panorama"
            ? {
                slotIndex: slotNumber - 1,
                totalSlots,
                zoom: template.bgImagePanoZoom,
                blur: template.bgImagePanoBlur,
                brightness: template.bgImagePanoBrightness,
              }
            : undefined,
      }),
    [
      bgImage,
      slot,
      fallbackColor,
      template.bgImageMode,
      template.bgImagePanoZoom,
      template.bgImagePanoBlur,
      template.bgImagePanoBrightness,
      slotNumber,
      totalSlots,
    ]
  );

  const deviceX = slot.devicePos.x * CANVAS_WIDTH;
  const deviceY = slot.devicePos.y * CANVAS_HEIGHT;

  const selectedElement: SlotElement | undefined = slot.elements.find(
    (e) => e.id === selectedElementId
  );

  // ---- Attach/detach Transformer when selection changes ----
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
  }, [selectedElementId, editing, slot.elements]);

  // Text + icons both expose 4 corners + the rotate handle. Width is auto-
  // sized from text content (no manual wrap-width handles).
  const transformerAnchors = useMemo(
    () => ["top-left", "top-right", "bottom-left", "bottom-right"],
    []
  );

  function patchElement(id: string, patch: Partial<SlotElement>) {
    if (!onChange) return;
    const elements = slot.elements.map((el) =>
      el.id === id ? ({ ...el, ...patch } as SlotElement) : el
    );
    onChange({ ...slot, elements });
  }

  function handleTransformStart() {
    // All anchors are corners now; always keep ratio so scaling stays uniform.
    const tr = trRef.current;
    if (!tr) return;
    tr.keepRatio(true);
  }

  function handleTransformEnd(e: Konva.KonvaEventObject<Event>) {
    const node = e.target;
    const sx = node.scaleX();
    const sy = node.scaleY();
    const rotation = node.rotation();
    const newPos = {
      x: node.x() / CANVAS_WIDTH,
      y: node.y() / CANVAS_HEIGHT,
    };
    // Reset scale on the live node so successive transforms compose cleanly.
    node.scaleX(1);
    node.scaleY(1);

    const id = node.id();
    const el = slot.elements.find((e) => e.id === id);
    if (!el) return;
    const factor = Math.max(sx, sy);

    if (el.type === "text") {
      const newFontSize = Math.max(8, el.fontSize * factor);
      // Recompute width to hug the (unchanged) text at the new font size.
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
    } else {
      patchElement(id, {
        size: Math.max(12, el.size * factor),
        rotation,
        pos: newPos,
      });
    }
  }

  // ---- Inline text editor ----
  function beginEditingText(el: TextElement) {
    if (!stageRef.current || !wrapperRef.current) return;
    const cx = el.pos.x * CANVAS_WIDTH;
    const cy = el.pos.y * CANVAS_HEIGHT;
    const screenCx = cx * scale;
    const screenCy = cy * scale;
    const screenFont = el.fontSize * scale;
    const family = fontFamilyOf(el, template);

    setEditing({
      id: el.id,
      // Anchor the textarea at the centre and use CSS translate(-50%,-50%)
      // so it stays centred regardless of how it grows as the user types.
      left: screenCx,
      top: screenCy,
      width: 0, // unused — relying on auto-sized contenteditable below
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
    // Auto-grow horizontally: width = widest line's px width + a few px
    // padding. We measure in display-space (scaled) px so it tracks the
    // textarea's own rendered fontSize.
    const widestPx = measureTextPx(ta.value, {
      fontSize: e.fontSize,
      fontFamily: e.fontFamily,
      weight: e.weight,
      italic: e.italic,
    });
    ta.style.width = `${Math.max(20, widestPx + 8)}px`;
    // Auto-grow vertically: clamp to scrollHeight.
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }

  function commitEdit() {
    if (!editing) return;
    const next = editingTextareaRef.current?.value ?? editing.initialText;
    const el = slot.elements.find((e) => e.id === editing.id);
    if (!el || el.type !== "text") {
      setEditing(null);
      return;
    }
    // Update both text and the auto-fit width so the rendered Konva.Text
    // hugs the new content.
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
      style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
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
          // Click on empty stage, the bg image, or anything not an element.
          if (target === stage || target.name() === "bg") {
            onSelectElement(null);
          }
        }}
      >
        <Layer>
          <KonvaImage
            image={bgCanvas}
            x={0}
            y={0}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            name="bg"
            listening={!readOnly}
          />

          <Group
            x={deviceX}
            y={deviceY}
            scaleX={slot.deviceScale}
            scaleY={slot.deviceScale}
            rotation={slot.deviceRotation}
            draggable={!readOnly}
            onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
              if (!onChange) return;
              const node = e.target;
              onChange({
                ...slot,
                devicePos: {
                  x: node.x() / CANVAS_WIDTH,
                  y: node.y() / CANVAS_HEIGHT,
                },
              });
            }}
          >
            <DeviceFrame
              slotNumber={slotNumber}
              screenshot={screenshot}
              bezelColor={template.bezelColor}
              cornerRadius={template.bezelCornerRadius}
              tiltX={slot.deviceTiltX}
              tiltY={slot.deviceTiltY}
              subdivisions={tiltSubdivisions}
            />
          </Group>

          {slot.elements.map((el) => {
            if (el.type === "text") {
              const blockW = el.width * CANVAS_WIDTH;
              const cx = el.pos.x * CANVAS_WIDTH;
              const cy = el.pos.y * CANVAS_HEIGHT;
              const isEditing = editing?.id === el.id;
              if (isEditing) return null; // hidden while overlay is active
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
                  onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                    const node = e.target;
                    patchElement(el.id, {
                      pos: {
                        x: node.x() / CANVAS_WIDTH,
                        y: node.y() / CANVAS_HEIGHT,
                      },
                    });
                  }}
                  onTransformStart={handleTransformStart}
                  onTransformEnd={handleTransformEnd}
                />
              );
            }
            // Custom (uploaded SVG) icon — render via Konva.Image.
            if (isCustomIcon(el.icon)) {
              return (
                <CustomIconNode
                  key={el.id}
                  el={el}
                  readOnly={readOnly}
                  onSelect={(id) => onSelectElement?.(id)}
                  onMove={(id, pos) => patchElement(id, { pos })}
                  onTransformStart={handleTransformStart}
                  onTransformEnd={handleTransformEnd}
                />
              );
            }
            // Built-in icon — render via Konva.Path.
            const def = ICONS[el.icon];
            if (!def) return null;
            const cx = el.pos.x * CANVAS_WIDTH;
            const cy = el.pos.y * CANVAS_HEIGHT;
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
                onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                  const node = e.target;
                  patchElement(el.id, {
                    pos: {
                      x: node.x() / CANVAS_WIDTH,
                      y: node.y() / CANVAS_HEIGHT,
                    },
                  });
                }}
                onTransformStart={handleTransformStart}
                onTransformEnd={handleTransformEnd}
              />
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
            // Centre the textarea on (left, top) and rotate around its centre
            // so it tracks the text element as it grows during typing.
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
 * Render a user-uploaded SVG icon. Uses Konva.Image so the SVG keeps its
 * own colours / multi-path detail. Aspect ratio is preserved with `size`
 * meaning the longest edge.
 */
function CustomIconNode({
  el,
  readOnly,
  onSelect,
  onMove,
  onTransformStart,
  onTransformEnd,
}: {
  el: IconElement;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, pos: { x: number; y: number }) => void;
  onTransformStart: () => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
}) {
  const url = `/api/uploads/${customIconPath(el.icon)}`;
  const image = useImage(url);

  const cx = el.pos.x * CANVAS_WIDTH;
  const cy = el.pos.y * CANVAS_HEIGHT;

  // Aspect-preserving dimensions: longest edge of the rendered icon equals
  // `el.size`. The other axis shrinks proportionally so non-square SVGs
  // don't stretch.
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
      onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.target;
        onMove(el.id, {
          x: node.x() / CANVAS_WIDTH,
          y: node.y() / CANVAS_HEIGHT,
        });
      }}
      onTransformStart={onTransformStart}
      onTransformEnd={onTransformEnd}
    />
  );
}
