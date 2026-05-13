// Measure rendered text width using a hidden canvas2D context so we can
// auto-size text boxes to their content (point-text behaviour).

import { CANVAS_WIDTH } from "./editor-types";

let _ctx: CanvasRenderingContext2D | null = null;

function ctx(): CanvasRenderingContext2D {
  if (_ctx) return _ctx;
  const canvas = document.createElement("canvas");
  const c = canvas.getContext("2d");
  if (!c) throw new Error("2d context unavailable for text measurement");
  _ctx = c;
  return _ctx;
}

export type FontSpec = {
  fontSize: number;
  fontFamily: string;
  weight: number;
  italic: boolean;
};

/**
 * Maximum line width in CSS px for the given text + font.
 * Multi-line text returns the widest line.
 */
export function measureTextPx(text: string, font: FontSpec): number {
  const c = ctx();
  c.font = `${font.italic ? "italic " : ""}${font.weight} ${font.fontSize}px ${font.fontFamily}`;
  let max = 0;
  const lines = text.split("\n");
  for (const line of lines) {
    const w = c.measureText(line).width;
    if (w > max) max = w;
  }
  return max;
}

/**
 * Compute the normalized (fraction-of-canvas-width) width to store on a
 * TextElement so the box hugs its content. Adds a few px of horizontal
 * padding so glyphs aren't pixel-tight against the right edge.
 */
export function autoWidth(text: string, font: FontSpec): number {
  const px = measureTextPx(text, font);
  const padded = px + 6; // small breathing room
  const normalized = padded / CANVAS_WIDTH;
  // Never collapse to zero — we still want the box to be draggable when empty.
  return Math.max(0.04, normalized);
}
