"use client";

import { Group, Image as KonvaImage, Rect, Text } from "react-konva";
import type { Context as KonvaContext } from "konva/lib/Context";

/**
 * Stylized iPhone bezel rendered with Konva primitives.
 *
 *   - bezel: 920 x 1900 with 90px rounded corners
 *   - inner screen: 880 x 1860 (after 20px pad)
 *   - notch: pill on the top center
 *
 * The device is centered on (0,0) so callers can position/rotate via a parent Group.
 *
 * If `screenshot` is supplied, it's drawn (stretched) inside the inner screen
 * area, clipped to the rounded inner-screen path. Otherwise we show a
 * "Slot N screenshot here" placeholder.
 */
const BEZEL_W = 920;
const BEZEL_H = 1900;
const SCREEN_PAD = 20;
const CORNER_RADIUS = 90;
const INNER_RADIUS = CORNER_RADIUS - SCREEN_PAD;

export const DEVICE_FRAME_WIDTH = BEZEL_W;
export const DEVICE_FRAME_HEIGHT = BEZEL_H;

function drawRoundedScreenPath(ctx: KonvaContext) {
  const x = SCREEN_PAD;
  const y = SCREEN_PAD;
  const w = BEZEL_W - SCREEN_PAD * 2;
  const h = BEZEL_H - SCREEN_PAD * 2;
  const r = INNER_RADIUS;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function DeviceFrame({
  slotNumber,
  screenshot,
}: {
  slotNumber: number;
  screenshot?: HTMLImageElement | null;
}) {
  const innerW = BEZEL_W - SCREEN_PAD * 2;
  const innerH = BEZEL_H - SCREEN_PAD * 2;

  return (
    <Group x={-BEZEL_W / 2} y={-BEZEL_H / 2}>
      {/* Outer bezel */}
      <Rect
        x={0}
        y={0}
        width={BEZEL_W}
        height={BEZEL_H}
        cornerRadius={CORNER_RADIUS}
        fill="#1f1f1f"
        shadowColor="black"
        shadowBlur={40}
        shadowOpacity={0.35}
        shadowOffsetY={20}
      />
      {/* Inner screen background (placeholder grey, covered by image when present) */}
      <Rect
        x={SCREEN_PAD}
        y={SCREEN_PAD}
        width={innerW}
        height={innerH}
        cornerRadius={INNER_RADIUS}
        fill="#e5e7eb"
      />
      {/* Screenshot, clipped to the rounded inner screen */}
      {screenshot && (
        <Group clipFunc={drawRoundedScreenPath}>
          <KonvaImage
            image={screenshot}
            x={SCREEN_PAD}
            y={SCREEN_PAD}
            width={innerW}
            height={innerH}
          />
        </Group>
      )}
      {/* Placeholder label when no screenshot */}
      {!screenshot && (
        <Text
          x={SCREEN_PAD}
          y={BEZEL_H / 2 - 40}
          width={innerW}
          align="center"
          text={`Slot ${slotNumber}\nscreenshot here`}
          fontSize={48}
          fontStyle="500"
          fill="#9ca3af"
        />
      )}
      {/* Notch pill, on top of everything */}
      <Rect
        x={BEZEL_W / 2 - 110}
        y={SCREEN_PAD + 26}
        width={220}
        height={36}
        cornerRadius={18}
        fill="#0a0a0a"
      />
    </Group>
  );
}
