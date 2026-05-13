// Shared types + defaults for the template editor.
// Coordinates are normalized 0..1 over the canvas (1290 x 2796) so layouts
// scale cleanly to other device sizes at export.

export const CANVAS_WIDTH = 1290;
export const CANVAS_HEIGHT = 2796;

export type TemplateConfig = {
  backgroundColor: string;
  fontFamily: string;
  bgImagePath?: string; // relative to UPLOAD_DIR, e.g. "templates/<id>/bg.jpg"
  bezelColor: string; // hex; sides are auto-derived as a darker shade
};

export type SlotConfig = {
  headlinePos: { x: number; y: number }; // normalized
  headlineSize: number; // px on 1290-wide canvas
  headlineColor: string;
  subheadPos: { x: number; y: number };
  subheadSize: number;
  subheadColor: string;
  devicePos: { x: number; y: number }; // normalized center of device
  deviceScale: number; // 0..1 relative to canvas width
  deviceRotation: number; // degrees, Z-axis spin
  deviceTiltX: number; // degrees, rotation around the device's X axis (+ tilts top away)
  deviceTiltY: number; // degrees, rotation around the device's Y axis (+ tilts right side away, shows left edge)
  backgroundColor?: string; // optional per-slot override (solid color fallback)
  bgImagePan: { x: number; y: number }; // -1..1 normalized
  bgImageZoom: number; // 1..3
  bgImageBlur: number; // px in 1290-wide canvas space
  bgImageBrightness: number; // 0..1.5 multiplier
};

export const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  backgroundColor: "#1d4ed8",
  fontFamily: "Geist, system-ui, sans-serif",
  bezelColor: "#1f1f1f",
};

export const DEFAULT_SLOT_CONFIG: SlotConfig = {
  headlinePos: { x: 0.5, y: 0.12 },
  headlineSize: 96,
  headlineColor: "#ffffff",
  subheadPos: { x: 0.5, y: 0.22 },
  subheadSize: 56,
  subheadColor: "#ffffff",
  devicePos: { x: 0.5, y: 0.62 },
  deviceScale: 0.7,
  deviceRotation: 0,
  deviceTiltX: 0,
  deviceTiltY: 0,
  bgImagePan: { x: 0, y: 0 },
  bgImageZoom: 1,
  bgImageBlur: 0,
  bgImageBrightness: 1,
};

export function parseTemplateConfig(raw: string | null | undefined): TemplateConfig {
  if (!raw) return DEFAULT_TEMPLATE_CONFIG;
  try {
    return { ...DEFAULT_TEMPLATE_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_TEMPLATE_CONFIG;
  }
}

export function parseSlotConfig(raw: string | null | undefined): SlotConfig {
  if (!raw) return DEFAULT_SLOT_CONFIG;
  try {
    const parsed = JSON.parse(raw);

    // Migration: pre-rename, `deviceTiltX` held what we now call `deviceTiltY`
    // (rotation around Y axis, i.e. side-to-side lean). Detect by absence of
    // `deviceTiltY` in the saved config and move the value across.
    if (
      typeof parsed.deviceTiltX === "number" &&
      typeof parsed.deviceTiltY !== "number"
    ) {
      parsed.deviceTiltY = parsed.deviceTiltX;
      parsed.deviceTiltX = 0;
    }

    return {
      ...DEFAULT_SLOT_CONFIG,
      ...parsed,
      bgImagePan: { ...DEFAULT_SLOT_CONFIG.bgImagePan, ...(parsed.bgImagePan ?? {}) },
    };
  } catch {
    return DEFAULT_SLOT_CONFIG;
  }
}
