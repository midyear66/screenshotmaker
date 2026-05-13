"use client";

import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Text, Group } from "react-konva";
import type Konva from "konva";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  SlotConfig,
  TemplateConfig,
} from "@/lib/editor-types";
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
  onChange,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [displayWidth, setDisplayWidth] = useState(400);
  const screenshot = useImage(screenshotUrl ?? null);

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
  const bg = slot.backgroundColor ?? template.backgroundColor;

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
          <Rect x={0} y={0} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill={bg} />

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
            <DeviceFrame slotNumber={slotNumber} screenshot={screenshot} />
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
