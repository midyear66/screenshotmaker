// Background canvas renderer.
// Fills the target rectangle with a solid color, optionally overlaid with a
// pan/zoom/blur/brightness-adjusted image. Supports two modes:
//   "single"   — the entire image is cover-fit to the canvas, with per-slot
//                pan/zoom controls.
//   "panorama" — the image is split into N equal vertical bands; this slot's
//                band is cover-fit to the canvas. Per-slot pan/zoom are
//                ignored so adjacent slots remain seamlessly continuous;
//                blur/brightness still apply for mood differentiation.

import { CANVAS_WIDTH, SlotConfig } from "./editor-types";

export type PanoramaInfo = {
  /** 0-based index of this slot within the template. */
  slotIndex: number;
  /** Total number of slots in the template. */
  totalSlots: number;
  /** Template-wide zoom (≥ 1). Shrinks the visible horizontal range of the
   *  source image around its centre, keeping band tiling intact. */
  zoom?: number;
  /** Template-wide blur override (px in 1290-wide canvas space). When
   *  supplied, used instead of slot.bgImageBlur so every slot reads the
   *  same softness. */
  blur?: number;
  /** Template-wide brightness override (0..1.5 multiplier). */
  brightness?: number;
};

export function renderBackgroundCanvas(args: {
  width: number;
  height: number;
  bgImage: HTMLImageElement | null;
  slot: SlotConfig;
  fallbackColor: string;
  /** When supplied, the image is sliced into bands; this slot gets one band. */
  panorama?: PanoramaInfo;
}): HTMLCanvasElement {
  const { width, height, bgImage, slot, fallbackColor, panorama } = args;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  ctx.fillStyle = fallbackColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!bgImage || bgImage.width === 0 || bgImage.height === 0) {
    return canvas;
  }

  const imgW = bgImage.width;
  const imgH = bgImage.height;
  const dstAspect = canvas.width / canvas.height;

  let srcX: number;
  let srcY: number;
  let srcW: number;
  let srcH: number;

  if (panorama && panorama.totalSlots > 0) {
    // ---- Panorama: this slot owns a 1/N vertical band of the image. ----
    const totalSlots = Math.max(1, panorama.totalSlots);
    const idx = Math.max(0, Math.min(totalSlots - 1, panorama.slotIndex));
    // Zoom shrinks the visible horizontal range of the image around its
    // centre. At zoom=1 the full image is split into N bands; at zoom=z
    // only the middle 1/z of the image is split into N bands. Bands stay
    // adjacent so the panorama remains continuous.
    const zoom = Math.max(1, panorama.zoom ?? 1);
    const visibleW = imgW / zoom;
    const visibleX = (imgW - visibleW) / 2;
    const bandW = visibleW / totalSlots;
    const bandX = visibleX + idx * bandW;

    // Cover-fit the band to the canvas aspect.
    const bandAspect = bandW / imgH;
    if (bandAspect > dstAspect) {
      // Band wider than the canvas — crop horizontally within the band.
      srcH = imgH;
      srcW = imgH * dstAspect;
      srcX = bandX + (bandW - srcW) / 2;
      srcY = 0;
    } else {
      // Band taller than the canvas — crop vertically within the band.
      srcW = bandW;
      srcH = bandW / dstAspect;
      srcX = bandX;
      srcY = (imgH - srcH) / 2;
    }
    // Per-slot pan/zoom intentionally ignored in panorama mode.
  } else {
    // ---- Single mode: cover-fit the full image, then zoom + pan. ----
    const imgAspect = imgW / imgH;
    let coverW: number;
    let coverH: number;
    if (imgAspect > dstAspect) {
      coverH = imgH;
      coverW = imgH * dstAspect;
    } else {
      coverW = imgW;
      coverH = imgW / dstAspect;
    }

    const zoom = Math.max(1, slot.bgImageZoom);
    srcW = coverW / zoom;
    srcH = coverH / zoom;
    srcX = (imgW - srcW) * (0.5 + slot.bgImagePan.x * 0.5);
    srcY = (imgH - srcH) * (0.5 + slot.bgImagePan.y * 0.5);
  }

  // ---- Blur + brightness ----
  // In panorama mode the values come from the template (shared across all
  // slots so the panorama reads as one continuous image). In single mode
  // they're per-slot.
  const blurBase = panorama?.blur ?? slot.bgImageBlur;
  const brightnessBase = panorama?.brightness ?? slot.bgImageBrightness;
  const blurPx = Math.max(0, blurBase) * (canvas.width / CANVAS_WIDTH);
  const brightness = Math.max(0, brightnessBase);
  const filters: string[] = [];
  if (blurPx > 0) filters.push(`blur(${blurPx.toFixed(2)}px)`);
  if (brightness !== 1) filters.push(`brightness(${brightness.toFixed(2)})`);
  ctx.filter = filters.length > 0 ? filters.join(" ") : "none";

  ctx.drawImage(bgImage, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
  ctx.filter = "none";

  return canvas;
}
