"use client";

import Konva from "konva";
import {
  CANVAS_WIDTH,
  SlotConfig,
  TemplateConfig,
} from "@/lib/editor-types";
import { renderBackgroundCanvas } from "@/lib/background";
import {
  BEZEL_H,
  BEZEL_W,
  CORNER_RADIUS,
  renderFlatDeviceFrame,
} from "@/lib/deviceFrame";
import { computeTiltedDevice, renderTiltedDevice } from "@/lib/perspective";
import { scaleColor } from "@/lib/color";

export type DeviceSize = {
  key: string;
  label: string;
  folder: string;
  width: number;
  height: number;
};

export const DEVICE_SIZES: DeviceSize[] = [
  { key: "iphone-6.7", label: 'iPhone 6.7"', folder: "iPhone-6.7", width: 1290, height: 2796 },
  { key: "iphone-6.5", label: 'iPhone 6.5"', folder: "iPhone-6.5", width: 1242, height: 2688 },
  { key: "ipad-13", label: 'iPad Pro 13"', folder: "iPad-13", width: 2064, height: 2752 },
];

/**
 * Load an HTMLImageElement, awaiting decode before resolving.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/**
 * Render one slot at native device pixel size to a PNG Blob.
 *
 * Layout strategy: normalized coords (0..1 over the iPhone 6.7 base aspect)
 * are mapped to the target device size. Device frame, font sizes, and the
 * deviceScale multiplier all use a uniform scale of deviceWidth/CANVAS_WIDTH
 * so the device stays proportional. Y positions use deviceHeight, so on
 * non-iPhone aspect ratios (e.g. iPad), the vertical layout stretches —
 * acceptable for v1.
 */
export async function renderSlotToBlob(args: {
  template: TemplateConfig;
  slot: SlotConfig;
  slotNumber: number;
  totalSlots: number;
  headline: string;
  subhead: string | null;
  screenshotUrl: string | null;
  device: DeviceSize;
}): Promise<Blob> {
  const { template, slot, slotNumber, totalSlots, headline, subhead, screenshotUrl, device } = args;

  const xScale = device.width / CANVAS_WIDTH;
  const TEXT_BLOCK_WIDTH = CANVAS_WIDTH * 0.9 * xScale;

  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-99999px";
  container.style.top = "-99999px";
  document.body.appendChild(container);

  const stage = new Konva.Stage({
    container,
    width: device.width,
    height: device.height,
  });
  const layer = new Konva.Layer();
  stage.add(layer);

  try {
    const screenshotImg = screenshotUrl ? await loadImage(screenshotUrl) : null;
    const bgImage = template.bgImagePath
      ? await loadImage(`/api/uploads/${template.bgImagePath}`).catch(() => null)
      : null;

    // ---- Background ----
    const bgCanvas = renderBackgroundCanvas({
      width: device.width,
      height: device.height,
      bgImage,
      slot,
      fallbackColor: slot.backgroundColor ?? template.backgroundColor,
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
    });
    layer.add(
      new Konva.Image({
        image: bgCanvas,
        x: 0,
        y: 0,
        width: device.width,
        height: device.height,
        listening: false,
      })
    );

    // ---- Device (with optional perspective tilt) ----
    const deviceX = slot.devicePos.x * device.width;
    const deviceY = slot.devicePos.y * device.height;
    const deviceScale = slot.deviceScale * xScale;

    const flat = renderFlatDeviceFrame({
      screenshot: screenshotImg,
      slotNumber,
      bezelColor: template.bezelColor,
    });
    let warpedCanvas: HTMLCanvasElement = flat;
    let warpedW = flat.width;
    let warpedH = flat.height;
    let pivotX = flat.width / 2;
    let pivotY = flat.height / 2;
    if (Math.abs(slot.deviceTiltX) >= 0.5 || Math.abs(slot.deviceTiltY) >= 0.5) {
      const sideFill = scaleColor(template.bezelColor, 0.6);
      const device = computeTiltedDevice(
        BEZEL_W,
        BEZEL_H,
        CORNER_RADIUS,
        slot.deviceTiltX,
        slot.deviceTiltY,
        { sideFill }
      );
      warpedCanvas = renderTiltedDevice(flat, device, { subdivisions: 60 });
      warpedW = device.width;
      warpedH = device.height;
      pivotX = device.pivot.x;
      pivotY = device.pivot.y;
    }

    layer.add(
      new Konva.Image({
        image: warpedCanvas,
        x: deviceX,
        y: deviceY,
        width: warpedW,
        height: warpedH,
        offsetX: pivotX,
        offsetY: pivotY,
        scaleX: deviceScale,
        scaleY: deviceScale,
        rotation: slot.deviceRotation,
        shadowColor: "black",
        shadowBlur: 40,
        shadowOpacity: 0.35,
        shadowOffsetY: 20,
      })
    );

    // ---- Headline ----
    const headlineFontPx = slot.headlineSize * xScale;
    layer.add(
      new Konva.Text({
        x: slot.headlinePos.x * device.width - TEXT_BLOCK_WIDTH / 2,
        y: slot.headlinePos.y * device.height,
        width: TEXT_BLOCK_WIDTH,
        align: "center",
        text: headline,
        fontSize: headlineFontPx,
        fontFamily: template.fontFamily,
        fontStyle: "700",
        fill: slot.headlineColor,
      })
    );

    if (subhead) {
      const subheadFontPx = slot.subheadSize * xScale;
      layer.add(
        new Konva.Text({
          x: slot.subheadPos.x * device.width - TEXT_BLOCK_WIDTH / 2,
          y: slot.subheadPos.y * device.height,
          width: TEXT_BLOCK_WIDTH,
          align: "center",
          text: subhead,
          fontSize: subheadFontPx,
          fontFamily: template.fontFamily,
          fontStyle: "500",
          fill: slot.subheadColor,
        })
      );
    }

    layer.draw();

    const canvas = stage.toCanvas();
    if (canvas.width !== device.width || canvas.height !== device.height) {
      throw new Error(
        `Render dimension mismatch: got ${canvas.width}x${canvas.height}, expected ${device.width}x${device.height}`
      );
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
    });
    return blob;
  } finally {
    stage.destroy();
    container.remove();
  }
}
