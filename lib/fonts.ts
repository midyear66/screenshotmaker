// Curated cross-platform font picker. All entries reference system fonts so
// no @font-face loading is needed — Konva's canvas-text path uses whatever
// the browser/OS resolves.

export type FontOption = {
  label: string;
  /** CSS font-family value. */
  value: string;
};

/** Sentinel meaning "use the template's default font". */
export const TEMPLATE_FONT_VALUE = "__template__";

export const FONT_OPTIONS: FontOption[] = [
  { label: "Default (template font)", value: TEMPLATE_FONT_VALUE },

  // Sans-serif
  { label: "Sans · System UI", value: "system-ui, -apple-system, sans-serif" },
  { label: "Sans · Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Sans · Arial Black", value: '"Arial Black", Gadget, sans-serif' },
  { label: "Sans · Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Sans · Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Sans · Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { label: "Sans · Lucida Sans", value: '"Lucida Sans Unicode", "Lucida Grande", sans-serif' },
  { label: "Sans · Trebuchet", value: '"Trebuchet MS", sans-serif' },

  // Serif
  { label: "Serif · Times New Roman", value: '"Times New Roman", Times, serif' },
  { label: "Serif · Georgia", value: "Georgia, serif" },
  { label: "Serif · Palatino", value: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
  { label: "Serif · Garamond", value: "Garamond, Georgia, serif" },
  { label: "Serif · Bookman", value: '"Bookman Old Style", serif' },

  // Monospace
  { label: "Mono · Courier New", value: '"Courier New", Courier, monospace' },
  { label: "Mono · Monaco", value: "Monaco, Consolas, monospace" },
  { label: "Mono · Lucida Console", value: '"Lucida Console", Monaco, monospace' },
  { label: "Mono · Andale Mono", value: '"Andale Mono", AndaleMono, monospace' },

  // Display
  { label: "Display · Impact", value: "Impact, Charcoal, sans-serif" },
  { label: "Display · Comic Sans", value: '"Comic Sans MS", cursive, sans-serif' },
  { label: "Display · Brush Script", value: '"Brush Script MT", cursive' },
  { label: "Display · Copperplate", value: '"Copperplate Gothic Light", "Copperplate", fantasy' },
];
