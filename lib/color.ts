/** Multiply each RGB channel by `factor` (0..2), clamped. Returns "#rrggbb". */
export function scaleColor(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const r = clamp255(((v >> 16) & 0xff) * factor);
  const g = clamp255(((v >> 8) & 0xff) * factor);
  const b = clamp255((v & 0xff) * factor);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}
function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}
