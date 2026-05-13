// Shared types + defaults for the template editor.
// Coordinates are normalized 0..1 over the canvas (1290 x 2796) so layouts
// scale cleanly to other device sizes at export.

export const CANVAS_WIDTH = 1290;
export const CANVAS_HEIGHT = 2796;

export type TemplateConfig = {
  backgroundColor: string;
  fontFamily: string;
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
  deviceRotation: number; // degrees
  backgroundColor?: string; // optional per-slot override
};

export const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  backgroundColor: "#1d4ed8",
  fontFamily: "Geist, system-ui, sans-serif",
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
    return { ...DEFAULT_SLOT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SLOT_CONFIG;
  }
}
