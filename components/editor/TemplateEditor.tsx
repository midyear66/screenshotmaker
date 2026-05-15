"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import {
  CanvasElement,
  CUSTOM_ICON_PREFIX,
  CustomIcon,
  DeviceElement,
  defaultDeviceElement,
  defaultHeadlineElement,
  defaultIconElement,
  defaultTextElement,
  IconElement,
  isCustomIcon,
  parseTemplateConfig,
  TemplateConfig,
  TextElement,
} from "@/lib/editor-types";
import { ICON_KEYS, ICONS } from "@/lib/icons";
import { FONT_OPTIONS, TEMPLATE_FONT_VALUE } from "@/lib/fonts";
import { autoWidth } from "@/lib/textMeasure";
import { ExportButton } from "@/components/project/ExportButton";

const EditorCanvas = dynamic(
  () => import("./EditorCanvas").then((m) => m.EditorCanvas),
  { ssr: false }
);

export type TemplatePayload = {
  id: string;
  name: string;
  config: string;
};

export type ProjectContext = {
  projectId: string;
  projectName: string;
};

export function TemplateEditor({
  template: initial,
  project,
}: {
  template: TemplatePayload;
  project: ProjectContext;
}) {
  const router = useRouter();

  const [templateConfig, setTemplateConfig] = useState<TemplateConfig>(() =>
    parseTemplateConfig(initial.config)
  );
  const [templateName, setTemplateName] = useState(initial.name);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  const bgFileInput = useRef<HTMLInputElement>(null);
  const screenshotFileInput = useRef<HTMLInputElement>(null);

  const selectedElement = templateConfig.elements.find((el) => el.id === selectedElementId) ?? null;

  // ---- Autosave ----

  const templateDirty = useRef(false);

  const flushSaves = useDebouncedCallback(async () => {
    if (!templateDirty.current) return;
    templateDirty.current = false;
    setSaving(true);
    await fetch(`/api/templates/${initial.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: templateName, config: templateConfig }),
    });
    setSaving(false);
  }, 600);

  function markDirty() {
    templateDirty.current = true;
    flushSaves();
  }

  // Persist any config change (set via setTemplateConfig).
  function updateConfig(updater: (c: TemplateConfig) => TemplateConfig) {
    setTemplateConfig((c) => {
      const next = updater(c);
      return next;
    });
    markDirty();
  }

  // ---- Element CRUD ----

  function patchElement(id: string, patch: Partial<CanvasElement>) {
    updateConfig((c) => ({
      ...c,
      elements: c.elements.map((el) =>
        el.id === id ? ({ ...el, ...patch } as CanvasElement) : el
      ),
    }));
  }

  function patchTextWithReflow(id: string, patch: Partial<TextElement>) {
    const current = templateConfig.elements.find((el) => el.id === id);
    if (!current || current.type !== "text") return;
    const next = { ...current, ...patch } as TextElement;
    const width = autoWidth(next.text, {
      fontSize: next.fontSize,
      fontFamily: next.fontFamily ?? templateConfig.fontFamily,
      weight: next.weight,
      italic: next.italic,
    });
    patchElement(id, { ...patch, width });
  }

  function addElement(el: CanvasElement) {
    updateConfig((c) => ({ ...c, elements: [...c.elements, el] }));
    setSelectedElementId(el.id);
  }

  function addTextElement() {
    // Drop in the middle of the canvas's first panel.
    const el = defaultHeadlineElement("Text");
    el.pos = { x: 0.5, y: 0.12 };
    addElement(el);
  }

  function addIconElement(iconKey: string) {
    const el = defaultIconElement(iconKey);
    addElement(el);
  }

  function addDeviceElement() {
    // Drop in the centre of the first empty panel if any, else panel 1.
    const usedPanels = new Set<number>();
    for (const el of templateConfig.elements) {
      if (el.type === "device") usedPanels.add(Math.floor(el.pos.x));
    }
    let panelIdx = 0;
    for (let i = 0; i < templateConfig.panelCount; i++) {
      if (!usedPanels.has(i)) {
        panelIdx = i;
        break;
      }
    }
    const el = defaultDeviceElement(panelIdx);
    addElement(el);
  }

  function removeElement(id: string) {
    updateConfig((c) => ({
      ...c,
      elements: c.elements.filter((el) => el.id !== id),
    }));
    if (selectedElementId === id) setSelectedElementId(null);
  }

  function moveElement(id: string, direction: -1 | 1) {
    updateConfig((c) => {
      const idx = c.elements.findIndex((e) => e.id === id);
      if (idx < 0) return c;
      const target = idx + direction;
      if (target < 0 || target >= c.elements.length) return c;
      const next = c.elements.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...c, elements: next };
    });
  }

  // ---- Panels ----

  function setPanelCount(n: number) {
    const next = Math.max(1, Math.min(10, n));
    updateConfig((c) => ({ ...c, panelCount: next }));
  }

  function addPanel() {
    setPanelCount(templateConfig.panelCount + 1);
  }

  function removePanel() {
    if (templateConfig.panelCount <= 1) return;
    setPanelCount(templateConfig.panelCount - 1);
  }

  // ---- Background image ----

  async function uploadBg(file: File) {
    setUploadingBg(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/templates/${initial.id}/background`, {
      method: "POST",
      body: fd,
    });
    setUploadingBg(false);
    if (res.ok) {
      const json = await res.json();
      setTemplateConfig((c) => ({ ...c, bgImagePath: json.bgImagePath }));
    } else alert("Upload failed");
  }
  async function removeBg() {
    if (!confirm("Remove background image?")) return;
    const res = await fetch(`/api/templates/${initial.id}/background`, {
      method: "DELETE",
    });
    if (res.ok) {
      setTemplateConfig((c) => {
        const { bgImagePath: _drop, ...rest } = c;
        void _drop;
        return rest;
      });
    }
  }

  // ---- Custom SVG icons ----

  async function uploadCustomIcon(file: File) {
    if (!file.name.toLowerCase().endsWith(".svg") && file.type !== "image/svg+xml") {
      alert("Only SVG files are accepted.");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/templates/${initial.id}/icons`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      alert("SVG upload failed");
      return;
    }
    const icon = await res.json();
    setTemplateConfig((c) => ({ ...c, customIcons: [...c.customIcons, icon] }));
  }
  async function removeCustomIcon(iconId: string) {
    if (!confirm("Delete this custom icon? It will be removed from any elements using it."))
      return;
    const res = await fetch(`/api/templates/${initial.id}/icons/${iconId}`, {
      method: "DELETE",
    });
    if (!res.ok) return;
    setTemplateConfig((c) => ({
      ...c,
      customIcons: c.customIcons.filter((i) => i.id !== iconId),
    }));
  }

  // ---- Screenshots pool ----

  async function uploadScreenshot(file: File): Promise<string | null> {
    setUploadingScreenshot(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/projects/${project.projectId}/screenshots`, {
      method: "POST",
      body: fd,
    });
    setUploadingScreenshot(false);
    if (!res.ok) {
      alert("Screenshot upload failed");
      return null;
    }
    const asset = await res.json();
    setTemplateConfig((c) => ({ ...c, screenshots: [...c.screenshots, asset] }));
    return asset.id as string;
  }
  async function deleteScreenshot(screenshotId: string) {
    if (!confirm("Delete this screenshot? Any device using it will lose its image."))
      return;
    const res = await fetch(
      `/api/projects/${project.projectId}/screenshots/${screenshotId}`,
      { method: "DELETE" }
    );
    if (!res.ok) return;
    setTemplateConfig((c) => ({
      ...c,
      screenshots: c.screenshots.filter((s) => s.id !== screenshotId),
      elements: c.elements.map((el) =>
        el.type === "device" && el.screenshotId === screenshotId
          ? { ...el, screenshotId: undefined }
          : el
      ),
    }));
  }

  // Flush on unmount.
  useEffect(() => {
    const handler = () => flushSaves.flush();
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      flushSaves.flush();
    };
  }, [flushSaves]);

  const palette = useMemo(
    () => ["#1d4ed8", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#111827"],
    []
  );
  const hasBg = !!templateConfig.bgImagePath;
  const bgThumbUrl = templateConfig.bgImagePath
    ? `/api/uploads/${templateConfig.bgImagePath}`
    : null;

  // Informational only — panels in the free-form model don't *need* a device
  // (the user might export panels with just bg + text + icons). Export is
  // always enabled.
  const devicesWithScreenshots = useMemo(
    () =>
      templateConfig.elements.filter(
        (el) => el.type === "device" && el.screenshotId
      ).length,
    [templateConfig.elements]
  );
  const isReady = templateConfig.panelCount > 0;

  // Build a minimal ProjectPayload for ExportButton.
  const exportPayload = useMemo(
    () => ({
      id: project.projectId,
      name: project.projectName,
      template: {
        id: initial.id,
        name: templateName,
        slotCount: templateConfig.panelCount, // legacy field; ExportButton's type only reads .slots
        config: JSON.stringify(templateConfig),
        slots: [], // panels live inside config.elements now
      },
      screens: [], // legacy; renderPanelToBlob reads from templateConfig.screenshots
    }),
    [project.projectId, project.projectName, initial.id, templateName, templateConfig]
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      {/* ---- Canvas + top toolbar ---- */}
      {/* min-w-0: the canvas filmstrip can be much wider than the column;
          without this the grid item grows to fit its content and the
          horizontal scroll never engages. */}
      <div className="flex flex-col items-stretch min-w-0">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={addTextElement}
              className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              + Text
            </button>
            <IconPicker
              onPick={addIconElement}
              customIcons={templateConfig.customIcons}
              onUploadCustom={uploadCustomIcon}
              onDeleteCustom={removeCustomIcon}
            />
            <button
              onClick={addDeviceElement}
              className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              + Device
            </button>
            <span className="ml-2 text-xs text-zinc-500">
              {templateConfig.panelCount} panel{templateConfig.panelCount === 1 ? "" : "s"}
              {devicesWithScreenshots > 0 &&
                ` · ${devicesWithScreenshots} device${devicesWithScreenshots === 1 ? "" : "s"} with screenshot`}
            </span>
          </div>
          <ExportButton project={exportPayload} ready={isReady} />
        </div>

        <EditorCanvas
          template={templateConfig}
          screenshots={templateConfig.screenshots}
          selectedElementId={selectedElementId}
          onChange={(next) => {
            setTemplateConfig(next);
            markDirty();
          }}
          onSelectElement={setSelectedElementId}
          maxWidthClass="max-w-full"
        />

        {/* Panel count controls */}
        <div className="mt-4 flex items-center gap-2">
          <span className="text-sm text-zinc-500">Panels:</span>
          <button
            onClick={removePanel}
            disabled={templateConfig.panelCount <= 1}
            className="px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 disabled:opacity-30"
          >
            −
          </button>
          <span className="text-sm tabular-nums w-6 text-center">
            {templateConfig.panelCount}
          </span>
          <button
            onClick={addPanel}
            disabled={templateConfig.panelCount >= 10}
            className="px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 disabled:opacity-30"
          >
            +
          </button>
        </div>
      </div>

      {/* ---- Inspector ---- */}
      <aside className="space-y-6">
        <Section title="Project">
          <Label>Name</Label>
          <input
            value={templateName}
            onChange={(e) => {
              setTemplateName(e.target.value);
              markDirty();
            }}
            onBlur={() => router.refresh()}
            className="input"
          />

          <Label className="mt-3">Default background color</Label>
          <ColorRow
            value={templateConfig.backgroundColor}
            onChange={(v) =>
              updateConfig((c) => ({ ...c, backgroundColor: v }))
            }
            palette={palette}
          />

          <Label className="mt-3">Bezel color</Label>
          <ColorRow
            value={templateConfig.bezelColor}
            onChange={(v) => updateConfig((c) => ({ ...c, bezelColor: v }))}
            palette={["#1f1f1f", "#3f3f46", "#6b6b6b", "#c4c4c4", "#e8e8e8", "#1e3a8a"]}
          />

          <Label className="mt-3">Bezel corner radius</Label>
          <Slider
            min={0}
            max={200}
            step={2}
            value={Math.round(templateConfig.bezelCornerRadius)}
            onChange={(v) =>
              updateConfig((c) => ({ ...c, bezelCornerRadius: v }))
            }
          />

          <Label className="mt-3">Background image</Label>
          <div className="flex items-center gap-2">
            {bgThumbUrl && (
              <div
                className="w-12 h-12 rounded border border-zinc-300 dark:border-zinc-700 bg-cover bg-center"
                style={{ backgroundImage: `url("${bgThumbUrl}")` }}
              />
            )}
            <input
              ref={bgFileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadBg(file);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => bgFileInput.current?.click()}
              disabled={uploadingBg}
              className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              {uploadingBg ? "Uploading…" : hasBg ? "Replace" : "Upload"}
            </button>
            {hasBg && (
              <button
                onClick={removeBg}
                className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-[11px] text-zinc-500 mt-1 leading-snug">
            Bg image spans all {templateConfig.panelCount} panel
            {templateConfig.panelCount === 1 ? "" : "s"}; each export PNG gets
            its slice.
          </p>

          {hasBg && (
            <>
              <Label className="mt-3">Bg zoom</Label>
              <Slider
                min={1}
                max={3}
                step={0.05}
                value={templateConfig.bgImagePanoZoom}
                onChange={(v) =>
                  updateConfig((c) => ({ ...c, bgImagePanoZoom: v }))
                }
              />

              <Label className="mt-2">Bg blur</Label>
              <Slider
                min={0}
                max={60}
                step={1}
                value={Math.round(templateConfig.bgImagePanoBlur)}
                onChange={(v) =>
                  updateConfig((c) => ({ ...c, bgImagePanoBlur: v }))
                }
              />

              <Label className="mt-2">Bg brightness</Label>
              <Slider
                min={0}
                max={1.5}
                step={0.05}
                value={templateConfig.bgImagePanoBrightness}
                onChange={(v) =>
                  updateConfig((c) => ({ ...c, bgImagePanoBrightness: v }))
                }
              />
            </>
          )}
        </Section>

        <Section title="Screenshots pool">
          <input
            ref={screenshotFileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadScreenshot(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => screenshotFileInput.current?.click()}
            disabled={uploadingScreenshot}
            className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 mb-2"
          >
            {uploadingScreenshot ? "Uploading…" : "+ Upload screenshot"}
          </button>
          {templateConfig.screenshots.length === 0 ? (
            <div className="text-xs text-zinc-500">
              No screenshots yet. Upload one to attach to any device.
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1">
              {templateConfig.screenshots.map((s) => (
                <div key={s.id} className="relative group">
                  <div
                    className="aspect-[1/2] rounded border border-zinc-300 dark:border-zinc-700 bg-cover bg-center bg-zinc-50 dark:bg-zinc-800"
                    style={{ backgroundImage: `url("/api/uploads/${s.path}")` }}
                    title={s.id}
                  />
                  <button
                    onClick={() => deleteScreenshot(s.id)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-zinc-900 text-white text-[9px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Elements">
          {templateConfig.elements.length === 0 ? (
            <div className="text-xs text-zinc-500">
              No elements yet. Use + Text / + Icon / + Device above.
            </div>
          ) : (
            <ul className="space-y-1 mb-3">
              {templateConfig.elements.map((el, i) => {
                const isSel = el.id === selectedElementId;
                const glyph =
                  el.type === "text" ? "T" : el.type === "icon" ? "★" : "⌖";
                const label =
                  el.type === "text"
                    ? el.text || "(empty)"
                    : el.type === "icon"
                    ? el.icon
                    : "device";
                return (
                  <li
                    key={el.id}
                    className={`flex items-center gap-1 rounded px-2 py-1 text-xs border ${
                      isSel
                        ? "bg-blue-50 dark:bg-blue-950 border-blue-300 dark:border-blue-700"
                        : "border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <button
                      onClick={() => setSelectedElementId(el.id)}
                      className="flex-1 text-left truncate"
                    >
                      <span className="font-mono text-zinc-500 mr-1">{glyph}</span>
                      {label}
                    </button>
                    <button
                      onClick={() => moveElement(el.id, -1)}
                      disabled={i === 0}
                      className="px-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30"
                      title="Send back"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => moveElement(el.id, 1)}
                      disabled={i === templateConfig.elements.length - 1}
                      className="px-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30"
                      title="Bring forward"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => removeElement(el.id)}
                      className="px-1 text-zinc-400 hover:text-red-600"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {selectedElement?.type === "text" && (
            <TextElementInspector
              element={selectedElement}
              palette={["#ffffff", "#000000", "#f3f4f6", "#1f2937", "#fef3c7"]}
              onPatch={(patch) => patchTextWithReflow(selectedElement.id, patch)}
            />
          )}
          {selectedElement?.type === "icon" && (
            <IconElementInspector
              element={selectedElement}
              palette={["#ffffff", "#000000", "#1d4ed8", "#f59e0b", "#ef4444"]}
              customIcons={templateConfig.customIcons}
              onUploadCustom={uploadCustomIcon}
              onDeleteCustom={removeCustomIcon}
              onPatch={(patch) => patchElement(selectedElement.id, patch)}
            />
          )}
          {selectedElement?.type === "device" && (
            <DeviceElementInspector
              element={selectedElement}
              screenshots={templateConfig.screenshots}
              panelCount={templateConfig.panelCount}
              onPatch={(patch) => patchElement(selectedElement.id, patch)}
              onUploadAndAttach={async (file) => {
                const id = await uploadScreenshot(file);
                if (id) patchElement(selectedElement.id, { screenshotId: id });
              }}
            />
          )}
          {!selectedElement && templateConfig.elements.length > 0 && (
            <div className="text-[11px] text-zinc-500">
              Click an element above (or on the canvas) to edit it.
            </div>
          )}
        </Section>

        <div className="text-xs text-zinc-500 text-right h-4">
          {saving ? "Saving…" : "All changes saved"}
        </div>
      </aside>

      <style jsx global>{`
        .input {
          width: 100%;
          padding: 0.4rem 0.6rem;
          font-size: 0.875rem;
          border: 1px solid rgb(212 212 216);
          border-radius: 6px;
          background: white;
          color: inherit;
        }
        .dark .input {
          border-color: rgb(63 63 70);
          background: rgb(24 24 27);
        }
      `}</style>
    </div>
  );
}

// ============================================================================
// Element inspectors
// ============================================================================

function TextElementInspector({
  element,
  palette,
  onPatch,
}: {
  element: TextElement;
  palette: string[];
  onPatch: (patch: Partial<TextElement>) => void;
}) {
  return (
    <div className="space-y-2 border-t border-zinc-200 dark:border-zinc-800 pt-3">
      <div className="text-[11px] text-zinc-500 leading-snug mb-1">
        Drag the corners on the canvas to resize, the top handle to rotate, or
        double-click text to edit in place.
      </div>

      <Label>Text</Label>
      <textarea
        value={element.text}
        onChange={(e) => onPatch({ text: e.target.value })}
        className="input"
        rows={2}
      />

      <Label className="mt-2">Font</Label>
      <select
        value={element.fontFamily ?? TEMPLATE_FONT_VALUE}
        onChange={(e) =>
          onPatch({
            fontFamily:
              e.target.value === TEMPLATE_FONT_VALUE ? undefined : e.target.value,
          })
        }
        className="input"
        style={{ fontFamily: element.fontFamily ?? undefined }}
      >
        {FONT_OPTIONS.map((opt) => (
          <option
            key={opt.value}
            value={opt.value}
            style={{ fontFamily: opt.value === TEMPLATE_FONT_VALUE ? undefined : opt.value }}
          >
            {opt.label}
          </option>
        ))}
      </select>

      <Label className="mt-2">Font size</Label>
      <Slider
        min={20}
        max={300}
        value={Math.round(element.fontSize)}
        onChange={(v) => onPatch({ fontSize: v })}
      />

      <Label className="mt-2">Weight</Label>
      <div className="flex items-center gap-1">
        {[400, 500, 600, 700, 800].map((w) => (
          <button
            key={w}
            onClick={() => onPatch({ weight: w })}
            className={`text-xs px-2 py-1 rounded border ${
              element.weight === w
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 border-zinc-900 dark:border-zinc-100"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            {w}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-2">
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={element.weight >= 700}
            onChange={(e) => onPatch({ weight: e.target.checked ? 700 : 400 })}
          />
          <span className="font-bold">Bold</span>
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={element.italic}
            onChange={(e) => onPatch({ italic: e.target.checked })}
          />
          <span className="italic">Italic</span>
        </label>
      </div>

      <Label className="mt-2">Align</Label>
      <div className="flex items-center gap-1">
        {(["left", "center", "right"] as const).map((a) => (
          <button
            key={a}
            onClick={() => onPatch({ align: a })}
            className={`text-xs px-2 py-1 rounded border capitalize ${
              element.align === a
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 border-zinc-900 dark:border-zinc-100"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      <Label className="mt-2">Rotation (°)</Label>
      <Slider
        min={-180}
        max={180}
        value={Math.round(element.rotation)}
        onChange={(v) => onPatch({ rotation: v })}
      />

      <Label className="mt-2">Color</Label>
      <ColorRow
        value={element.color}
        onChange={(v) => onPatch({ color: v })}
        palette={palette}
      />
    </div>
  );
}

function IconElementInspector({
  element,
  palette,
  customIcons,
  onUploadCustom,
  onDeleteCustom,
  onPatch,
}: {
  element: IconElement;
  palette: string[];
  customIcons: CustomIcon[];
  onUploadCustom: (file: File) => void | Promise<void>;
  onDeleteCustom: (iconId: string) => void | Promise<void>;
  onPatch: (patch: Partial<IconElement>) => void;
}) {
  const elementIsCustom = isCustomIcon(element.icon);
  return (
    <div className="space-y-2 border-t border-zinc-200 dark:border-zinc-800 pt-3">
      <Label>Icon</Label>
      <div className="grid grid-cols-6 gap-1">
        {ICON_KEYS.map((key) => {
          const def = ICONS[key];
          const isSel = key === element.icon;
          return (
            <button
              key={key}
              onClick={() => onPatch({ icon: key })}
              title={key}
              className={`aspect-square rounded border flex items-center justify-center ${
                isSel
                  ? "border-blue-500 ring-2 ring-blue-500"
                  : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              <svg viewBox={def.viewBox} className="w-5 h-5">
                <path
                  d={def.path}
                  fill={def.stroke ? "none" : "currentColor"}
                  stroke={def.stroke ? "currentColor" : undefined}
                  strokeWidth={def.stroke ? 2 : 0}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          );
        })}
      </div>

      <Label className="mt-2">Custom SVG</Label>
      <CustomIconGrid
        customIcons={customIcons}
        selectedIconValue={element.icon}
        onPick={(value) => onPatch({ icon: value })}
        onUpload={onUploadCustom}
        onDelete={onDeleteCustom}
      />

      <Label className="mt-2">Size</Label>
      <Slider
        min={40}
        max={600}
        value={Math.round(element.size)}
        onChange={(v) => onPatch({ size: v })}
      />

      <Label className="mt-2">Rotation (°)</Label>
      <Slider
        min={-180}
        max={180}
        value={Math.round(element.rotation)}
        onChange={(v) => onPatch({ rotation: v })}
      />

      <Label className="mt-2">Color</Label>
      <ColorRow
        value={element.color}
        onChange={(v) => onPatch({ color: v })}
        palette={palette}
      />
      {elementIsCustom && (
        <div className="text-[11px] text-zinc-500 leading-snug">
          Color is ignored for uploaded SVGs — the file keeps its own colours.
        </div>
      )}
    </div>
  );
}

function DeviceElementInspector({
  element,
  screenshots,
  panelCount,
  onPatch,
  onUploadAndAttach,
}: {
  element: DeviceElement;
  screenshots: { id: string; path: string }[];
  panelCount: number;
  onPatch: (patch: Partial<DeviceElement>) => void;
  onUploadAndAttach: (file: File) => void | Promise<void>;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const currentPanel = Math.max(
    0,
    Math.min(panelCount - 1, element.panelIndex ?? Math.floor(element.pos.x))
  );
  return (
    <div className="space-y-2 border-t border-zinc-200 dark:border-zinc-800 pt-3">
      <div className="text-[11px] text-zinc-500 leading-snug mb-1">
        Drag the corners on the canvas to resize, the top handle to rotate. To
        place a phone across two tiles, add a second device and assign it to
        the neighbouring tile below.
      </div>

      <Label>Tile</Label>
      <select
        className="input"
        value={currentPanel}
        onChange={(e) => {
          const next = Number(e.target.value);
          const delta = next - currentPanel;
          // Shift pos.x by the tile delta so the device keeps the same
          // relative position within its new tile (e.g. "centred" stays
          // "centred"). panelIndex is the authoritative tile assignment.
          onPatch({
            panelIndex: next,
            pos: { x: element.pos.x + delta, y: element.pos.y },
          });
        }}
      >
        {Array.from({ length: panelCount }, (_, i) => (
          <option key={i} value={i}>
            Tile {i + 1}
          </option>
        ))}
      </select>

      <Label className="mt-2">Screenshot</Label>
      <div className="grid grid-cols-4 gap-1 mb-2">
        {screenshots.map((s) => {
          const isSel = s.id === element.screenshotId;
          return (
            <button
              key={s.id}
              onClick={() => onPatch({ screenshotId: s.id })}
              className={`aspect-[1/2] rounded border bg-cover bg-center bg-zinc-50 dark:bg-zinc-800 ${
                isSel
                  ? "border-blue-500 ring-2 ring-blue-500"
                  : "border-zinc-300 dark:border-zinc-700 hover:border-zinc-400"
              }`}
              style={{ backgroundImage: `url("/api/uploads/${s.path}")` }}
              title={s.id}
            />
          );
        })}
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUploadAndAttach(f);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => uploadRef.current?.click()}
          title="Upload + attach"
          className="aspect-[1/2] rounded border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950 text-zinc-400 hover:text-blue-500 flex items-center justify-center text-lg"
        >
          +
        </button>
      </div>
      {element.screenshotId && (
        <button
          onClick={() => onPatch({ screenshotId: undefined })}
          className="text-[11px] text-zinc-500 hover:text-red-600 mb-2"
        >
          Detach screenshot
        </button>
      )}

      <Label>Size (fraction of panel width)</Label>
      <Slider
        min={0.2}
        max={1.5}
        step={0.05}
        value={element.size}
        onChange={(v) => onPatch({ size: v })}
      />

      <Label className="mt-2">Z-axis rotation (°)</Label>
      <Slider
        min={-90}
        max={90}
        value={Math.round(element.rotation)}
        onChange={(v) => onPatch({ rotation: v })}
      />

      <Label className="mt-2">Side tilt (Y axis)</Label>
      <Slider
        min={-30}
        max={30}
        value={Math.round(element.tiltY)}
        onChange={(v) => onPatch({ tiltY: v })}
      />

      <Label className="mt-2">Top/bottom tilt (X axis)</Label>
      <Slider
        min={-30}
        max={30}
        value={Math.round(element.tiltX)}
        onChange={(v) => onPatch({ tiltX: v })}
      />
    </div>
  );
}

function CustomIconGrid({
  customIcons,
  selectedIconValue,
  onPick,
  onUpload,
  onDelete,
}: {
  customIcons: CustomIcon[];
  selectedIconValue?: string;
  onPick: (iconValue: string) => void;
  onUpload?: (file: File) => void | Promise<void>;
  onDelete?: (iconId: string) => void | Promise<void>;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  return (
    <div className="grid grid-cols-6 gap-1">
      {customIcons.map((ci) => {
        const value = `${CUSTOM_ICON_PREFIX}${ci.path}`;
        const isSel = selectedIconValue === value;
        return (
          <div key={ci.id} className="relative group">
            <button
              onClick={() => onPick(value)}
              title={ci.name}
              className={`aspect-square w-full rounded border flex items-center justify-center bg-zinc-50 dark:bg-zinc-800 ${
                isSel
                  ? "border-blue-500 ring-2 ring-blue-500"
                  : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/uploads/${ci.path}`}
                alt={ci.name}
                className="max-w-[80%] max-h-[80%]"
              />
            </button>
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(ci.id);
                }}
                title="Delete this icon"
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-zinc-900 text-white text-[9px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
      {onUpload && (
        <>
          <input
            ref={uploadRef}
            type="file"
            accept=".svg,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => uploadRef.current?.click()}
            title="Upload SVG"
            className="aspect-square rounded border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950 flex items-center justify-center text-zinc-400 hover:text-blue-500 text-lg"
          >
            +
          </button>
        </>
      )}
    </div>
  );
}

function IconPicker({
  onPick,
  customIcons,
  onUploadCustom,
  onDeleteCustom,
}: {
  onPick: (iconValue: string) => void;
  customIcons: CustomIcon[];
  onUploadCustom: (file: File) => void | Promise<void>;
  onDeleteCustom: (iconId: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        + Icon
      </button>
      {open && (
        <div
          className="absolute z-20 mt-1 left-0 w-64 p-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg space-y-2"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">
            Built-in
          </div>
          <div className="grid grid-cols-6 gap-1">
            {ICON_KEYS.map((key) => {
              const def = ICONS[key];
              return (
                <button
                  key={key}
                  onClick={() => {
                    onPick(key);
                    setOpen(false);
                  }}
                  title={key}
                  className="aspect-square rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center"
                >
                  <svg viewBox={def.viewBox} className="w-5 h-5">
                    <path
                      d={def.path}
                      fill={def.stroke ? "none" : "currentColor"}
                      stroke={def.stroke ? "currentColor" : undefined}
                      strokeWidth={def.stroke ? 2 : 0}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              );
            })}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 pt-1">
            Custom SVG
          </div>
          <CustomIconGrid
            customIcons={customIcons}
            onPick={(value) => {
              onPick(value);
              setOpen(false);
            }}
            onUpload={onUploadCustom}
            onDelete={onDeleteCustom}
          />
        </div>
      )}
    </div>
  );
}

// Suppress unused — used by default factories.
void defaultTextElement;

// ============================================================================
// Small UI helpers (unchanged)
// ============================================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 bg-white dark:bg-zinc-900">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-xs text-zinc-500 mb-1 ${className}`}>{children}</div>
  );
}

function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1"
      />
      <span className="text-xs tabular-nums w-12 text-right">{value}</span>
    </div>
  );
}

function ColorRow({
  value,
  onChange,
  palette,
  allowClear,
  onClear,
}: {
  value: string;
  onChange: (v: string) => void;
  palette: string[];
  allowClear?: boolean;
  onClear?: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {palette.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`w-6 h-6 rounded border ${
            value === c ? "ring-2 ring-zinc-900 dark:ring-zinc-100" : "border-zinc-300 dark:border-zinc-700"
          }`}
          style={{ background: c }}
          aria-label={c}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-6 h-6 rounded border border-zinc-300 dark:border-zinc-700 cursor-pointer"
      />
      {allowClear && onClear && (
        <button
          onClick={onClear}
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 ml-1"
        >
          reset
        </button>
      )}
    </div>
  );
}
