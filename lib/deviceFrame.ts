// Vanilla canvas2D renderer for the iPhone-style device frame.
// Single source of truth for what the device looks like — used by both the
// editor (after perspective warping) and the export renderer.

export const BEZEL_W = 920;
export const BEZEL_H = 1900;
/** Default bezel corner radius. Templates may override via TemplateConfig.bezelCornerRadius. */
export const CORNER_RADIUS = 90;
const SCREEN_PAD = 20;

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  // Clamp r so we don't blow up the path on very small dimensions.
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export function renderFlatDeviceFrame(args: {
  screenshot?: HTMLImageElement | null;
  slotNumber?: number;
  bezelColor?: string;
  /** Override the default bezel corner radius. */
  cornerRadius?: number;
}): HTMLCanvasElement {
  const bezelColor = args.bezelColor ?? "#1f1f1f";
  const outerR = Math.max(0, args.cornerRadius ?? CORNER_RADIUS);
  const innerR = Math.max(0, outerR - SCREEN_PAD);

  const canvas = document.createElement("canvas");
  canvas.width = BEZEL_W;
  canvas.height = BEZEL_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  // Outer bezel
  ctx.fillStyle = bezelColor;
  roundedRectPath(ctx, 0, 0, BEZEL_W, BEZEL_H, outerR);
  ctx.fill();

  // Inner screen background (placeholder gray under everything)
  const innerX = SCREEN_PAD;
  const innerY = SCREEN_PAD;
  const innerW = BEZEL_W - SCREEN_PAD * 2;
  const innerH = BEZEL_H - SCREEN_PAD * 2;
  ctx.fillStyle = "#e5e7eb";
  roundedRectPath(ctx, innerX, innerY, innerW, innerH, innerR);
  ctx.fill();

  if (args.screenshot) {
    ctx.save();
    roundedRectPath(ctx, innerX, innerY, innerW, innerH, innerR);
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
