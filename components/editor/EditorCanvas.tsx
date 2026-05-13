"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Text, Group } from "react-konva";
import type Konva from "konva";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  SlotConfig,
  TemplateConfig,
} from "@/lib/editor-types";
import { renderBackgroundCanvas } from "@/lib/background";
import { DeviceFrame } from "./DeviceFrame";
import { useImage } from "./useImage";

type Props = {
  template: TemplateConfig;
  slot: SlotConfig;
  slotNumber: number;
  headline: string;
  subhead: string | null;
  screenshotUrl?: string | null;
  readOnly?: boolean;
  maxWidthClass?: string;
  /** Override perspective subdivisions; default 20 for live editor. */
  tiltSubdivisions?: number;
  onChange?: (next: SlotConfig) => void;
};

export function EditorCanvas({
  template,
  slot,
  slotNumber,
  headline,
  subhead,
  screenshotUrl,
  readOnly = false,
  maxWidthClass = "max-w-md",
  tiltSubdivisions = 20,
  onChange,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [displayWidth, setDisplayWidth] = useState(400);
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

  // Rebuild the background canvas only when its inputs change. Keyed on the
  // primitive values that affect the image, not on object identity.
  const bgCanvas = useMemo(
    () =>
      renderBackgroundCanvas({
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        bgImage,
        slot,
        fallbackColor,
      }),
    [
      bgImage,
      slot,
      fallbackColor,
    ]
  );

  const headlineX = slot.headlinePos.x * CANVAS_WIDTH;
  const headlineY = slot.headlinePos.y * CANVAS_HEIGHT;
  const subheadX = slot.subheadPos.x * CANVAS_WIDTH;
  const subheadY = slot.subheadPos.y * CANVAS_HEIGHT;
  const deviceX = slot.devicePos.x * CANVAS_WIDTH;
  const deviceY = slot.devicePos.y * CANVAS_HEIGHT;

  const TEXT_BLOCK_WIDTH = CANVAS_WIDTH * 0.9;

  return (
    <div
      ref={wrapperRef}
      className={`w-full ${maxWidthClass} mx-auto`}
      style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
    >
      <Stage
        width={displayWidth}
        height={displayHeight}
        scaleX={scale}
        scaleY={scale}
        className="rounded-2xl overflow-hidden shadow-xl"
      >
        <Layer>
          <KonvaImage
            image={bgCanvas}
            x={0}
            y={0}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            listening={false}
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
              tiltX={slot.deviceTiltX}
              tiltY={slot.deviceTiltY}
              subdivisions={tiltSubdivisions}
            />
          </Group>

          <Text
            x={headlineX - TEXT_BLOCK_WIDTH / 2}
            y={headlineY}
            width={TEXT_BLOCK_WIDTH}
            align="center"
            text={headline}
            fontSize={slot.headlineSize}
            fontFamily={template.fontFamily}
            fontStyle="700"
            fill={slot.headlineColor}
            draggable={!readOnly}
            onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
              if (!onChange) return;
              const node = e.target;
              onChange({
                ...slot,
                headlinePos: {
                  x: (node.x() + TEXT_BLOCK_WIDTH / 2) / CANVAS_WIDTH,
                  y: node.y() / CANVAS_HEIGHT,
                },
              });
            }}
          />

          {subhead && (
            <Text
              x={subheadX - TEXT_BLOCK_WIDTH / 2}
              y={subheadY}
              width={TEXT_BLOCK_WIDTH}
              align="center"
              text={subhead}
              fontSize={slot.subheadSize}
              fontFamily={template.fontFamily}
              fontStyle="500"
              fill={slot.subheadColor}
              draggable={!readOnly}
              onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                if (!onChange) return;
                const node = e.target;
                onChange({
                  ...slot,
                  subheadPos: {
                    x: (node.x() + TEXT_BLOCK_WIDTH / 2) / CANVAS_WIDTH,
                    y: node.y() / CANVAS_HEIGHT,
                  },
                });
              }}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
