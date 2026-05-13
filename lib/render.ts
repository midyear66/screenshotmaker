"use client";

import Konva from "konva";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  SlotConfig,
  TemplateConfig,
} from "@/lib/editor-types";

// Re-declared here so we don't take a circular import on react-konva components.
const BEZEL_W = 920;
const BEZEL_H = 1900;
const SCREEN_PAD = 20;
const CORNER_RADIUS = 90;
const INNER_RADIUS = CORNER_RADIUS - SCREEN_PAD;

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
 * non-iPhone aspect ratios (e.g. iPad), the vertical layout will stretch —
 * acceptable for v1.
 */
export async function renderSlotToBlob(args: {
  template: TemplateConfig;
  slot: SlotConfig;
  slotNumber: number;
  headline: string;
  subhead: string | null;
  screenshotUrl: string | null;
  device: DeviceSize;
}): Promise<Blob> {
  const { template, slot, slotNumber, headline, subhead, screenshotUrl, device } = args;

  const xScale = device.width / CANVAS_WIDTH; // uniform; used for device + fonts
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

    // Background
    layer.add(
      new Konva.Rect({
        x: 0,
        y: 0,
        width: device.width,
        height: device.height,
        fill: slot.backgroundColor ?? template.backgroundColor,
      })
    );

    // Device group: rotation + uniform scale
    const deviceX = slot.devicePos.x * device.width;
    const deviceY = slot.devicePos.y * device.height;
    const deviceScale = slot.deviceScale * xScale;

    const deviceGroup = new Konva.Group({
      x: deviceX,
      y: deviceY,
      scaleX: deviceScale,
      scaleY: deviceScale,
      rotation: slot.deviceRotation,
    });

    // Inner group centered at origin (matches editor's DeviceFrame)
    const inner = new Konva.Group({ x: -BEZEL_W / 2, y: -BEZEL_H / 2 });
    deviceGroup.add(inner);

    inner.add(
      new Konva.Rect({
        x: 0,
        y: 0,
        width: BEZEL_W,
        height: BEZEL_H,
        cornerRadius: CORNER_RADIUS,
        fill: "#1f1f1f",
        shadowColor: "black",
        shadowBlur: 40,
        shadowOpacity: 0.35,
        shadowOffsetY: 20,
      })
    );
    inner.add(
      new Konva.Rect({
        x: SCREEN_PAD,
        y: SCREEN_PAD,
        width: BEZEL_W - SCREEN_PAD * 2,
        height: BEZEL_H - SCREEN_PAD * 2,
        cornerRadius: INNER_RADIUS,
        fill: "#e5e7eb",
      })
    );

    if (screenshotImg) {
      const innerW = BEZEL_W - SCREEN_PAD * 2;
      const innerH = BEZEL_H - SCREEN_PAD * 2;
      const clipped = new Konva.Group({
        clipFunc: (ctx) => {
          const x = SCREEN_PAD;
          const y = SCREEN_PAD;
          const w = innerW;
          const h = innerH;
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
        },
      });
      clipped.add(
        new Konva.Image({
          image: screenshotImg,
          x: SCREEN_PAD,
          y: SCREEN_PAD,
          width: innerW,
          height: innerH,
        })
      );
      inner.add(clipped);
    } else {
      inner.add(
        new Konva.Text({
          x: SCREEN_PAD,
          y: BEZEL_H / 2 - 40,
          width: BEZEL_W - SCREEN_PAD * 2,
          align: "center",
          text: `Slot ${slotNumber}\nscreenshot here`,
          fontSize: 48,
          fontStyle: "500",
          fill: "#9ca3af",
        })
      );
    }

    // Notch on top
    inner.add(
      new Konva.Rect({
        x: BEZEL_W / 2 - 110,
        y: SCREEN_PAD + 26,
        width: 220,
        height: 36,
        cornerRadius: 18,
        fill: "#0a0a0a",
      })
    );

    layer.add(deviceGroup);

    // Headline
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
