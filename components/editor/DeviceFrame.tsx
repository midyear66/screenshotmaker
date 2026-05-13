"use client";

import { useMemo } from "react";
import { Image as KonvaImage } from "react-konva";
import {
  BEZEL_W,
  BEZEL_H,
  CORNER_RADIUS,
  renderFlatDeviceFrame,
} from "@/lib/deviceFrame";
import { computeTiltedDevice, renderTiltedDevice } from "@/lib/perspective";
import { scaleColor } from "@/lib/color";

/**
 * Renders the iPhone bezel + (optional) screenshot, applying a pseudo-3D
 * perspective tilt around both X and Y axes through the device's centre.
 * The device is modelled as a rounded-rect prism so the visible side ribbon
 * wraps cleanly around the rounded corners.
 */
export function DeviceFrame({
  slotNumber,
  screenshot,
  bezelColor,
  cornerRadius,
  tiltX,
  tiltY,
  subdivisions = 20,
}: {
  slotNumber: number;
  screenshot?: HTMLImageElement | null;
  bezelColor: string;
  /** Bezel corner radius in 1290-wide canvas px. */
  cornerRadius?: number;
  tiltX: number;
  tiltY: number;
  subdivisions?: number;
}) {
  const effectiveRadius = cornerRadius ?? CORNER_RADIUS;

  const flat = useMemo(
    () =>
      renderFlatDeviceFrame({
        screenshot,
        slotNumber,
        bezelColor,
        cornerRadius: effectiveRadius,
      }),
    [screenshot, slotNumber, bezelColor, effectiveRadius]
  );

  const tilted = useMemo(() => {
    if (Math.abs(tiltX) < 0.5 && Math.abs(tiltY) < 0.5) {
      return {
        canvas: flat,
        width: flat.width,
        height: flat.height,
        pivotX: flat.width / 2,
        pivotY: flat.height / 2,
      };
    }
    const sideFill = scaleColor(bezelColor, 0.6);
    const device = computeTiltedDevice(
      BEZEL_W,
      BEZEL_H,
      effectiveRadius,
      tiltX,
      tiltY,
      { sideFill }
    );
    const out = renderTiltedDevice(flat, device, { subdivisions });
    return {
      canvas: out,
      width: device.width,
      height: device.height,
      pivotX: device.pivot.x,
      pivotY: device.pivot.y,
    };
  }, [flat, bezelColor, effectiveRadius, tiltX, tiltY, subdivisions]);

  return (
    <KonvaImage
      image={tilted.canvas}
      width={tilted.width}
      height={tilted.height}
      offsetX={tilted.pivotX}
      offsetY={tilted.pivotY}
      shadowColor="black"
      shadowBlur={40}
      shadowOpacity={0.35}
      shadowOffsetY={20}
    />
  );
}
