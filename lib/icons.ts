// Curated SVG icon registry for IconElement.
// Each icon is a single path string in a 24×24 viewBox. `stroke=true` icons
// render as outlined lines (e.g. check, x); the rest fill their interior.

export type IconDef = {
  viewBox: string;
  path: string;
  /** Render as stroked lines instead of filled. */
  stroke?: boolean;
};

export const ICON_VIEWBOX_SIZE = 24;

export const ICONS: Record<string, IconDef> = {
  star: {
    viewBox: "0 0 24 24",
    path:
      "M12 2 L9.35 8.36 L2.49 8.91 L7.72 13.39 L6.12 20.09 L12 16.5 L17.88 20.09 L16.28 13.39 L21.51 8.91 L14.65 8.36 Z",
  },
  heart: {
    viewBox: "0 0 24 24",
    path:
      "M12 21 C12 21 4 16 4 9 C4 6.5 6 4.5 8.5 4.5 C10.5 4.5 12 6 12 6 C12 6 13.5 4.5 15.5 4.5 C18 4.5 20 6.5 20 9 C20 16 12 21 12 21 Z",
  },
  play: {
    viewBox: "0 0 24 24",
    path: "M6 4 L20 12 L6 20 Z",
  },
  bolt: {
    viewBox: "0 0 24 24",
    path: "M13 2 L4 14 H11 L10 22 L20 10 H13 L13 2 Z",
  },
  bookmark: {
    viewBox: "0 0 24 24",
    path: "M6 2 H18 V22 L12 17 L6 22 Z",
  },
  circle: {
    viewBox: "0 0 24 24",
    path: "M12 2 a10 10 0 1 0 0.001 0 Z",
  },
  square: {
    viewBox: "0 0 24 24",
    path: "M3 3 H21 V21 H3 Z",
  },
  triangle: {
    viewBox: "0 0 24 24",
    path: "M12 3 L22 21 L2 21 Z",
  },
  check: {
    viewBox: "0 0 24 24",
    path: "M4 12 L10 18 L20 6",
    stroke: true,
  },
  x: {
    viewBox: "0 0 24 24",
    path: "M5 5 L19 19 M19 5 L5 19",
    stroke: true,
  },
  "arrow-right": {
    viewBox: "0 0 24 24",
    path: "M5 12 H19 M13 6 L19 12 L13 18",
    stroke: true,
  },
  plus: {
    viewBox: "0 0 24 24",
    path: "M12 5 V19 M5 12 H19",
    stroke: true,
  },
};

export const ICON_KEYS = Object.keys(ICONS);
