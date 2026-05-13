// Vanilla canvas2D renderer for the iPhone-style device frame.
// Single source of truth for what the device looks like — used by both the
// editor (after perspective warping) and the export renderer.

export const BEZEL_W = 920;
export const BEZEL_H = 1900;
export const CORNER_RADIUS = 90;
const SCREEN_PAD = 20;
const INNER_RADIUS = CORNER_RADIUS - SCREEN_PAD;

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
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

export function renderFlatDeviceFrame(args: {
  screenshot?: HTMLImageElement | null;
  slotNumber?: number;
  bezelColor?: string;
}): HTMLCanvasElement {
  const bezelColor = args.bezelColor ?? "#1f1f1f";

  const canvas = document.createElement("canvas");
  canvas.width = BEZEL_W;
  canvas.height = BEZEL_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  // Outer bezel
  ctx.fillStyle = bezelColor;
  roundedRectPath(ctx, 0, 0, BEZEL_W, BEZEL_H, CORNER_RADIUS);
  ctx.fill();

  // Inner screen background (placeholder gray under everything)
  const innerX = SCREEN_PAD;
  const innerY = SCREEN_PAD;
  const innerW = BEZEL_W - SCREEN_PAD * 2;
  const innerH = BEZEL_H - SCREEN_PAD * 2;
  ctx.fillStyle = "#e5e7eb";
  roundedRectPath(ctx, innerX, innerY, innerW, innerH, INNER_RADIUS);
  ctx.fill();

  if (args.screenshot) {
    ctx.save();
    roundedRectPath(ctx, innerX, innerY, innerW, innerH, INNER_RADIUS);
    ctx.clip();
    ctx.drawImage(args.screenshot, innerX, innerY, innerW, innerH);
    ctx.restore();
  } else if (args.slotNumber != null) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "500 48px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`Slot ${args.slotNumber}`, BEZEL_W / 2, BEZEL_H / 2 - 24);
    ctx.fillText("screenshot here", BEZEL_W / 2, BEZEL_H / 2 + 24);
  }

  // Notch pill — always black regardless of bezel colour, mirroring real phones
  ctx.fillStyle = "#0a0a0a";
  const notchX = BEZEL_W / 2 - 110;
  const notchY = SCREEN_PAD + 26;
  roundedRectPath(ctx, notchX, notchY, 220, 36, 18);
  ctx.fill();

  return canvas;
}
