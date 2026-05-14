// Shared types + defaults for the editor.
//
// **Model:** the project owns a single wide canvas of size
// `panelCount * PANEL_W` wide by `PANEL_H` tall. Elements (text, icons,
// devices) live in *panel-space* — `pos.x` is in panels (0..panelCount),
// `pos.y` is normalized 0..1 of canvas height. Panels are export-only
// slice points; on export the wide canvas is hard-cropped into N PNGs.
//
// `CANVAS_WIDTH` / `CANVAS_HEIGHT` are the single-panel logical pixel
// dimensions (an iPhone 6.7 portrait). One panel = 1290 logical px wide.

export const PANEL_W = 1290;
export const PANEL_H = 2796;

/**
 * Visual gutter between panels in the editor (canvas-px, relative to PANEL_W).
 * Drawn as white space between tiles so the editor matches the App Store
 * Connect screenshot layout. Background slicing stays contiguous across the
 * gap (no source pixels are hidden) — see `lib/background.ts` panorama path.
 * Elements are hard-clipped at the panel edge so they don't bleed into the
 * gap; a "phone bridging two screens" effect is achieved by placing one
 * device on each adjacent tile.
 */
export const PANEL_GAP_PX = 60;

/**
 * @deprecated Kept as aliases for legacy callers that hard-code "the
 * canvas". New code should use PANEL_W/PANEL_H and multiply by panelCount.
 */
export const CANVAS_WIDTH = PANEL_W;
export const CANVAS_HEIGHT = PANEL_H;

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

/**
 * A screenshot upload available to any DeviceElement on the canvas.
 * Stored under `data/uploads/projects/<projectId>/screenshots/`.
 */
export type ScreenshotAsset = {
  id: string;
  path: string;          // relative to UPLOAD_DIR
  uploadedAt: string;    // ISO timestamp
};

export type TemplateConfig = {
  backgroundColor: string;
  fontFamily: string;
  bgImagePath?: string; // relative to UPLOAD_DIR, e.g. "templates/<id>/bg.jpg"
  /**
   * Legacy. Pre-canvas model used "panorama" mode to share one image across
   * slots. The new continuous-canvas model always treats the bg image as a
   * single wide image, so this field is ignored at render time but kept for
   * backwards-compatible parsing.
   */
  bgImageMode: "single" | "panorama";
  bgImagePanoZoom: number;
  bgImagePanoBlur: number;
  bgImagePanoBrightness: number;
  bezelColor: string; // hex; sides auto-derived darker
  /** Device bezel corner radius in panel-px (0..200). Default 90 ≈ iPhone. */
  bezelCornerRadius: number;
  /** User-uploaded SVG icons available as IconElement sources. */
  customIcons: CustomIcon[];
  /** Number of vertical slice bands. Width = panelCount * PANEL_W. */
  panelCount: number;
  /** Canvas-space elements (text + icon + device), drawn in array order. */
  elements: CanvasElement[];
  /** Pool of uploaded screenshots; DeviceElement.screenshotId references these. */
  screenshots: ScreenshotAsset[];
  /**
   * Numeric marker tracking which one-shot migrations have been applied.
   * Older projects open with a smaller value (or undefined → 0) and the
   * migration helper applies any missing steps before returning.
   */
  migrationVersion?: number;
};

/** Latest migration step number; bump this and add a step in lib/projectMigration.ts. */
export const LATEST_MIGRATION_VERSION = 3;

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
  /**
   * Centre of the text block in **panel-space**: `x` is in panel units
   * (0..panelCount; 1.5 = centre of the 2nd panel), `y` is 0..1 of canvas
   * height. Legacy slot-local data uses `x` in 0..1 of a single panel; the
   * migration helper offsets old values by their slot index.
   */
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
  /** Centre of the icon in panel-space (see TextElement.pos). */
  pos: { x: number; y: number };
  /** Edge length in panel-px (scaled at export per device). */
  size: number;
  /** Key in ICONS (lib/icons.ts) OR "custom:<path>" for uploaded SVG. */
  icon: string;
  color: string;
  rotation: number;
};

/**
 * A phone bezel + screenshot, positioned freely on the canvas. Replaces the
 * old per-slot device. Bezel colour + corner radius come from the project
 * config (so all devices share one device family); tilt is per-device.
 */
export type DeviceElement = {
  type: "device";
  id: string;
  /** Centre of the device in panel-space. */
  pos: { x: number; y: number };
  /** Bezel size relative to PANEL_W (0.7 ≈ today's default). */
  size: number;
  /** Z-axis spin in degrees. */
  rotation: number;
  /** X-axis perspective tilt (top tilts towards/away). */
  tiltX: number;
  /** Y-axis perspective tilt (side tilts towards/away). */
  tiltY: number;
  /** References ScreenshotAsset.id in the project's pool; undefined = placeholder. */
  screenshotId?: string;
  /**
   * Which tile this device renders inside. Dragging never changes this — the
   * user moves a device to another tile from the inspector. When undefined
   * (legacy data), `Math.floor(pos.x)` is used as a fallback. New devices
   * always set this explicitly.
   */
  panelIndex?: number;
};

export type CanvasElement = TextElement | IconElement | DeviceElement;

/** @deprecated Use CanvasElement. Kept for the migration layer. */
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
  panelCount: 1,
  elements: [],
  screenshots: [],
};

/** Default DeviceElement (placed at the centre of the active visual area). */
export function defaultDeviceElement(panelIndex: number = 0): DeviceElement {
  return {
    type: "device",
    id: newElementId(),
    pos: { x: panelIndex + 0.5, y: 0.62 },
    size: 0.7,
    rotation: 0,
    tiltX: 0,
    tiltY: 0,
    panelIndex,
  };
}

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

/**
 * Generate a fresh element id. Exposed so the migration helper can also
 * mint ids server-side.
 */
export function newElementId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
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
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
      screenshots: Array.isArray(parsed.screenshots) ? parsed.screenshots : [],
    };
  } catch {
    return { ...DEFAULT_TEMPLATE_CONFIG };
  }
}

/** Has the project been migrated to the continuous-canvas model? */
export function isMigratedConfig(config: TemplateConfig): boolean {
  return (
    typeof config.panelCount === "number" &&
    config.panelCount > 0 &&
    Array.isArray(config.elements)
    // Note: empty elements array is valid (a fresh post-migration project).
    // We rely on panelCount being explicitly set by the migration to
    // distinguish migrated configs from raw defaults.
  );
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
