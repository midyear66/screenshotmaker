// Shared types + defaults for the template editor.
// Coordinates are normalized 0..1 over the canvas (1290 x 2796) so layouts
// scale cleanly to other device sizes at export.

export const CANVAS_WIDTH = 1290;
export const CANVAS_HEIGHT = 2796;

/**
 * A user-uploaded SVG icon attached to a template. The `path` is relative
 * to UPLOAD_DIR (typically `templates/<templateId>/icons/<iconId>.svg`).
 */
export type CustomIcon = {
  id: string;
  /** Display name (defaults to the uploaded file name). */
  name: string;
  path: string;
};

export type TemplateConfig = {
  backgroundColor: string;
  fontFamily: string;
  bgImagePath?: string; // relative to UPLOAD_DIR, e.g. "templates/<id>/bg.jpg"
  /**
   * "single"   = every slot shows the same image (per-slot pan/zoom apply).
   * "panorama" = the image is split into N equal vertical bands, slot k gets
   *              band k, so viewed side-by-side the slots form the full image.
   *              Per-slot pan/zoom are ignored in this mode; blur/brightness
   *              still apply.
   */
  bgImageMode: "single" | "panorama";
  bgImagePanoZoom: number;
  bgImagePanoBlur: number;
  bgImagePanoBrightness: number;
  bezelColor: string; // hex; sides are auto-derived as a darker shade
  /** Device bezel corner radius in 1290-wide canvas px (0..200). Default 90 ≈ iPhone. */
  bezelCornerRadius: number;
  /** User-uploaded SVG icons available to this template's slots. */
  customIcons: CustomIcon[];
};

/**
 * Custom icon sentinel: `IconElement.icon` values starting with this prefix
 * refer to an uploaded SVG; the remainder is the file's path under UPLOAD_DIR.
 */
export const CUSTOM_ICON_PREFIX = "custom:";

export function isCustomIcon(iconValue: string): boolean {
  return iconValue.startsWith(CUSTOM_ICON_PREFIX);
}

export function customIconPath(iconValue: string): string {
  return iconValue.slice(CUSTOM_ICON_PREFIX.length);
}

export type TextElement = {
  type: "text";
  id: string;
  /** Centre of the text block, normalized 0..1. */
  pos: { x: number; y: number };
  /**
   * Block width as a fraction of canvas width. Auto-maintained to hug the
   * rendered text content; updated whenever text / font / size / weight
   * changes. Used as the Konva.Text width for centre alignment of
   * multi-line content.
   */
  width: number;
  align: "left" | "center" | "right";
  text: string;
  /** Px in the 1290-wide canvas space (scaled at export per device). */
  fontSize: number;
  /** Optional per-element font family override. Falls back to template font. */
  fontFamily?: string;
  /** 400 / 500 / 600 / 700 / 800. */
  weight: number;
  italic: boolean;
  color: string;
  /** Degrees, rotated around the text block's centre. */
  rotation: number;
};

export type IconElement = {
  type: "icon";
  id: string;
  /** Centre of the icon, normalized 0..1. */
  pos: { x: number; y: number };
  /** Edge length in 1290-wide canvas space (scaled at export per device). */
  size: number;
  /** Key in ICONS (lib/icons.ts). */
  icon: string;
  color: string;
  /** Degrees, rotated around the icon's centre. */
  rotation: number;
};

export type SlotElement = TextElement | IconElement;

export type SlotConfig = {
  devicePos: { x: number; y: number };
  deviceScale: number;
  deviceRotation: number;
  deviceTiltX: number;
  deviceTiltY: number;
  backgroundColor?: string;
  bgImagePan: { x: number; y: number };
  bgImageZoom: number;
  bgImageBlur: number;
  bgImageBrightness: number;
  /** Free-form text + icon elements rendered on top of the background and
   *  device. Empty array means a slot with no overlay copy/icons. */
  elements: SlotElement[];
};

export const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  backgroundColor: "#1d4ed8",
  fontFamily: "Geist, system-ui, sans-serif",
  bgImageMode: "single",
  bgImagePanoZoom: 1,
  bgImagePanoBlur: 0,
  bgImagePanoBrightness: 1,
  bezelColor: "#1f1f1f",
  bezelCornerRadius: 90,
  customIcons: [],
};

export const DEFAULT_SLOT_CONFIG: SlotConfig = {
  devicePos: { x: 0.5, y: 0.62 },
  deviceScale: 0.7,
  deviceRotation: 0,
  deviceTiltX: 0,
  deviceTiltY: 0,
  bgImagePan: { x: 0, y: 0 },
  bgImageZoom: 1,
  bgImageBlur: 0,
  bgImageBrightness: 1,
  elements: [],
};

/**
 * Build the default starter text element placed on a brand-new slot.
 * One bold headline-style element near the top so the canvas isn't empty.
 */
export function defaultHeadlineElement(text = "Headline"): TextElement {
  return {
    type: "text",
    id: newElementId(),
    pos: { x: 0.5, y: 0.12 },
    width: 0.9,
    align: "center",
    text,
    fontSize: 96,
    weight: 700,
    italic: false,
    color: "#ffffff",
    rotation: 0,
  };
}

export function defaultTextElement(text = "Text"): TextElement {
  return {
    type: "text",
    id: newElementId(),
    pos: { x: 0.5, y: 0.5 },
    width: 0.8,
    align: "center",
    text,
    fontSize: 64,
    weight: 500,
    italic: false,
    color: "#ffffff",
    rotation: 0,
  };
}

export function defaultIconElement(icon: string): IconElement {
  return {
    type: "icon",
    id: newElementId(),
    pos: { x: 0.5, y: 0.4 },
    size: 120,
    icon,
    color: "#ffffff",
    rotation: 0,
  };
}

function newElementId(): string {
  // Available in modern browsers + Node 22+; the editor only runs in client.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback — only used in degraded environments.
  return `el-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

export function parseTemplateConfig(raw: string | null | undefined): TemplateConfig {
  if (!raw) return { ...DEFAULT_TEMPLATE_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_TEMPLATE_CONFIG,
      ...parsed,
      customIcons: Array.isArray(parsed.customIcons) ? parsed.customIcons : [],
    };
  } catch {
    return { ...DEFAULT_TEMPLATE_CONFIG };
  }
}

export function parseSlotConfig(raw: string | null | undefined): SlotConfig {
  if (!raw) return { ...DEFAULT_SLOT_CONFIG };
  try {
    const parsed = JSON.parse(raw);

    // Migration: pre-rename, `deviceTiltX` held what we now call `deviceTiltY`.
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
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
    };
  } catch {
    return { ...DEFAULT_SLOT_CONFIG };
  }
}
