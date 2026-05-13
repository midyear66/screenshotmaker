// Background canvas renderer.
// Fills the target rectangle with a solid color, optionally overlaid with a
// pan/zoom/blur/brightness-adjusted image (cover-fit).

import { CANVAS_WIDTH, SlotConfig } from "./editor-types";

export function renderBackgroundCanvas(args: {
  width: number;
  height: number;
  bgImage: HTMLImageElement | null;
  slot: SlotConfig;
  fallbackColor: string;
}): HTMLCanvasElement {
  const { width, height, bgImage, slot, fallbackColor } = args;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  // Solid color fill (also acts as the underlay if image is partially transparent)
  ctx.fillStyle = fallbackColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!bgImage || bgImage.width === 0 || bgImage.height === 0) {
    return canvas;
  }

  // ---- cover-fit center crop, then apply zoom + pan ----
  const imgW = bgImage.width;
  const imgH = bgImage.height;
  const imgAspect = imgW / imgH;
  const dstAspect = canvas.width / canvas.height;

  // Source rect at zoom=1 that center-crops to fill dst aspect.
  let coverW: number;
  let coverH: number;
  if (imgAspect > dstAspect) {
    // Image wider than canvas — crop horizontally
    coverH = imgH;
    coverW = imgH * dstAspect;
  } else {
    coverW = imgW;
    coverH = imgW / dstAspect;
  }

  const zoom = Math.max(1, slot.bgImageZoom);
  const srcW = coverW / zoom;
  const srcH = coverH / zoom;
  const srcX = (imgW - srcW) * (0.5 + slot.bgImagePan.x * 0.5);
  const srcY = (imgH - srcH) * (0.5 + slot.bgImagePan.y * 0.5);

  // ---- scale blur from base 1290-wide canvas to target ----
  const blurPx = Math.max(0, slot.bgImageBlur) * (canvas.width / CANVAS_WIDTH);
  const brightness = Math.max(0, slot.bgImageBrightness);
  const filters: string[] = [];
  if (blurPx > 0) filters.push(`blur(${blurPx.toFixed(2)}px)`);
  if (brightness !== 1) filters.push(`brightness(${brightness.toFixed(2)})`);
  ctx.filter = filters.length > 0 ? filters.join(" ") : "none";

  ctx.drawImage(bgImage, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
  ctx.filter = "none";

  return canvas;
}
