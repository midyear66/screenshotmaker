"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import {
  CUSTOM_ICON_PREFIX,
  CustomIcon,
  DEFAULT_SLOT_CONFIG,
  defaultIconElement,
  defaultTextElement,
  IconElement,
  isCustomIcon,
  parseSlotConfig,
  parseTemplateConfig,
  SlotConfig,
  SlotElement,
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

export type SlotPayload = {
  id: string;
  order: number;
  config: string;
};

export type TemplatePayload = {
  id: string;
  name: string;
  slotCount: number;
  config: string;
  slots: SlotPayload[];
};

export type ScreenPayload = {
  id: string;
  slotOrder: number;
  screenshotPath: string;
};

export type ProjectContext = {
  projectId: string;
  projectName: string;
  screens: ScreenPayload[];
};

type SlotState = {
  id: string;
  order: number;
  config: SlotConfig;
};

export function TemplateEditor({
  template: initial,
  project,
}: {
  template: TemplatePayload;
  /**
   * When supplied, the editor also renders screenshot management UI
   * (drop zone, per-slot upload, export). When omitted, it's a pure
   * template editor with placeholder canvases.
   */
  project?: ProjectContext;
}) {
  const router = useRouter();

  const [templateConfig, setTemplateConfig] = useState<TemplateConfig>(() =>
    parseTemplateConfig(initial.config)
  );
  const [templateName, setTemplateName] = useState(initial.name);
  const [slots, setSlots] = useState<SlotState[]>(() =>
    initial.slots.map((s) => ({
      id: s.id,
      order: s.order,
      config: parseSlotConfig(s.config),
    }))
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const bgFileInput = useRef<HTMLInputElement>(null);

  const active = slots[activeIdx];
  const selectedElement =
    active?.config.elements.find((el) => el.id === selectedElementId) ?? null;

  // Clear selection when switching slots so we don't reference a stale id.
  useEffect(() => {
    setSelectedElementId(null);
  }, [activeIdx]);

  // ---- Autosave ----

  const dirtySlotIds = useRef<Set<string>>(new Set());
  const templateDirty = useRef(false);

  const flushSaves = useDebouncedCallback(async () => {
    setSaving(true);
    const slotIds = Array.from(dirtySlotIds.current);
    dirtySlotIds.current.clear();
    const wasTemplateDirty = templateDirty.current;
    templateDirty.current = false;

    const tasks: Promise<unknown>[] = [];
    if (wasTemplateDirty) {
      tasks.push(
        fetch(`/api/templates/${initial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: templateName, config: templateConfig }),
        })
      );
    }
    for (const id of slotIds) {
      const s = slots.find((x) => x.id === id);
      if (!s) continue;
      tasks.push(
        fetch(`/api/slots/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: s.config }),
        })
      );
    }
    await Promise.all(tasks);
    setSaving(false);
  }, 600);

  function markSlotDirty(id: string) {
    dirtySlotIds.current.add(id);
    flushSaves();
  }
  function markTemplateDirty() {
    templateDirty.current = true;
    flushSaves();
  }

  // ---- Slot mutators ----

  function updateSlotConfig(id: string, next: SlotConfig) {
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, config: next } : s))
    );
    markSlotDirty(id);
  }

  // ---- Element mutators (operate on the active slot) ----

  function patchElement(elementId: string, patch: Partial<SlotElement>) {
    if (!active) return;
    const elements = active.config.elements.map((el) =>
      el.id === elementId ? ({ ...el, ...patch } as SlotElement) : el
    );
    updateSlotConfig(active.id, { ...active.config, elements });
  }

  /**
   * Patch a TextElement and recompute `width` so the block continues to hug
   * its content. Used for inspector edits that affect rendered text width
   * (text content / font size / weight / italic / fontFamily).
   */
  function patchTextWithReflow(elementId: string, patch: Partial<TextElement>) {
    if (!active) return;
    const current = active.config.elements.find((el) => el.id === elementId);
    if (!current || current.type !== "text") return;
    const next: TextElement = { ...current, ...patch };
    const width = autoWidth(next.text, {
      fontSize: next.fontSize,
      fontFamily: next.fontFamily ?? templateConfig.fontFamily,
      weight: next.weight,
      italic: next.italic,
    });
    patchElement(elementId, { ...patch, width });
  }

  function addTextElement() {
    if (!active) return;
    const el = defaultTextElement("Text");
    updateSlotConfig(active.id, {
      ...active.config,
      elements: [...active.config.elements, el],
    });
    setSelectedElementId(el.id);
  }

  function addIconElement(iconKey: string) {
    if (!active) return;
    const el = defaultIconElement(iconKey);
    updateSlotConfig(active.id, {
      ...active.config,
      elements: [...active.config.elements, el],
    });
    setSelectedElementId(el.id);
  }

  function removeElement(elementId: string) {
    if (!active) return;
    updateSlotConfig(active.id, {
      ...active.config,
      elements: active.config.elements.filter((el) => el.id !== elementId),
    });
    if (selectedElementId === elementId) setSelectedElementId(null);
  }

  function moveElement(elementId: string, direction: -1 | 1) {
    if (!active) return;
    const idx = active.config.elements.findIndex((el) => el.id === elementId);
    if (idx < 0) return;
    const target = idx + direction;
    if (target < 0 || target >= active.config.elements.length) return;
    const next = active.config.elements.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    updateSlotConfig(active.id, { ...active.config, elements: next });
  }

  // ---- Slot CRUD ----

  async function addSlot() {
    const res = await fetch(`/api/templates/${initial.id}/slots`, {
      method: "POST",
    });
    if (!res.ok) return;
    const slot = await res.json();
    setSlots((prev) => [
      ...prev,
      {
        id: slot.id,
        order: slot.order,
        config: parseSlotConfig(slot.config),
      },
    ]);
    setActiveIdx(slots.length);
  }

  async function removeSlot() {
    if (slots.length <= 1) return;
    if (!confirm(`Delete slot ${active.order}? This can't be undone.`)) return;
    const res = await fetch(`/api/slots/${active.id}`, { method: "DELETE" });
    if (!res.ok) return;
    setSlots((prev) => {
      const next = prev.filter((s) => s.id !== active.id);
      return next.map((s, i) => ({ ...s, order: i + 1 }));
    });
    setActiveIdx((idx) => Math.max(0, idx - 1));
  }

  // ---- Background image upload / remove ----

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
    } else {
      alert("Upload failed");
    }
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

  // ---- Custom SVG icon upload / remove ----

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
    setTemplateConfig((c) => ({
      ...c,
      customIcons: [...c.customIcons, icon],
    }));
  }

  async function removeCustomIcon(iconId: string) {
    if (!confirm("Delete this custom icon? It will be removed from any slots using it.")) {
      return;
    }
    const res = await fetch(`/api/templates/${initial.id}/icons/${iconId}`, {
      method: "DELETE",
    });
    if (!res.ok) return;
    // Remove from local templateConfig + scrub any slot elements that referenced it.
    setTemplateConfig((c) => ({
      ...c,
      customIcons: c.customIcons.filter((i) => i.id !== iconId),
    }));
    // We don't auto-scrub slot.elements that referenced this icon — the
    // canvas will simply render nothing for them (image fails to load). The
    // user can delete those elements via the inspector list.
  }

  // ---- Screenshot upload / remove / move (only when project context exists) ----

  const screensByOrder = useMemo(() => {
    const m = new Map<number, ScreenPayload>();
    if (project) {
      for (const s of project.screens) m.set(s.slotOrder, s);
    }
    return m;
  }, [project]);

  const filledScreenCount = project?.screens.length ?? 0;
  const isReady = !!project && filledScreenCount === slots.length;

  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const slotFileInput = useRef<HTMLInputElement>(null);
  const replaceTargetSlot = useRef<number | null>(null);

  async function uploadFiles(files: FileList | File[]) {
    if (!project) return;
    if (files.length === 0) return;
    setUploading(true);
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("file", f);
    const res = await fetch(`/api/projects/${project.projectId}/screens`, {
      method: "POST",
      body: fd,
    });
    setUploading(false);
    if (res.ok) router.refresh();
    else alert("Upload failed");
  }

  async function replaceSlotScreenshot(slotOrder: number, file: File) {
    if (!project) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("slotOrder", String(slotOrder));
    const res = await fetch(`/api/projects/${project.projectId}/screens`, {
      method: "POST",
      body: fd,
    });
    setUploading(false);
    if (res.ok) router.refresh();
    else alert("Upload failed");
  }

  async function deleteScreen(screenId: string) {
    if (!confirm("Remove this screenshot?")) return;
    const res = await fetch(`/api/screens/${screenId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  function onDropZoneDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  }

  // ---- Flush on unmount / nav away ----
  useEffect(() => {
    const onBeforeUnload = () => {
      flushSaves.flush();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
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

  // Project export payload for ExportButton (when in project context).
  const exportPayload = project
    ? {
        id: project.projectId,
        name: project.projectName,
        template: {
          id: initial.id,
          name: templateName,
          slotCount: slots.length,
          config: JSON.stringify(templateConfig),
          slots: slots.map((s) => ({
            id: s.id,
            order: s.order,
            config: JSON.stringify(s.config),
          })),
        },
        screens: project.screens,
      }
    : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      {/* ---- Left column ---- */}
      <div className="flex flex-col items-stretch">
        {/* Screenshot toolbar (only in project context) */}
        {project && (
          <>
            <input
              ref={slotFileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                const slot = replaceTargetSlot.current;
                if (file && slot != null) replaceSlotScreenshot(slot, file);
                e.target.value = "";
              }}
            />
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDropZoneDrop}
              className={`rounded-lg border-2 border-dashed p-3 text-center mb-4 transition-colors ${
                dragging
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                  : "border-zinc-300 dark:border-zinc-700"
              }`}
            >
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                Drop screenshots to fill empty slots, or{" "}
                <label className="underline cursor-pointer">
                  choose files
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => e.target.files && uploadFiles(e.target.files)}
                  />
                </label>
                .
              </p>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                {uploading ? "Uploading…" : `${filledScreenCount} / ${slots.length} screens filled`}
                {isReady && " · ready to export"}
              </p>
            </div>
            <div className="mb-4 flex items-center justify-end">
              {exportPayload && <ExportButton project={exportPayload} ready={isReady} />}
            </div>
          </>
        )}

        {/* Filmstrip */}
        <div className="mb-4 flex gap-2 overflow-x-auto pb-2 -mx-2 px-2">
          {slots.map((s, i) => {
            const isActive = i === activeIdx;
            const screen = screensByOrder.get(s.order);
            const screenshotUrl = screen ? `/api/uploads/${screen.screenshotPath}` : undefined;
            return (
              <div key={s.id} className="shrink-0 flex flex-col items-center gap-1">
                <button
                  onClick={() => setActiveIdx(i)}
                  className={`rounded-lg p-1 border ${
                    isActive
                      ? "border-blue-500 ring-2 ring-blue-500"
                      : "border-zinc-300 dark:border-zinc-700 hover:border-zinc-400"
                  }`}
                  title={`Slot ${s.order}`}
                >
                  <div style={{ width: 110 }}>
                    <EditorCanvas
                      template={templateConfig}
                      slot={s.config}
                      slotNumber={s.order}
                      totalSlots={slots.length}
                      screenshotUrl={screenshotUrl}
                      readOnly
                      maxWidthClass=""
                      tiltSubdivisions={12}
                    />
                  </div>
                </button>
                <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                  <span>{s.order}</span>
                  {project && (
                    <>
                      <button
                        onClick={() => {
                          replaceTargetSlot.current = s.order;
                          slotFileInput.current?.click();
                        }}
                        title={screen ? "Replace screenshot" : "Upload screenshot"}
                        className="px-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        {screen ? "⟳" : "↑"}
                      </button>
                      {screen && (
                        <button
                          onClick={() => deleteScreen(screen.id)}
                          title="Remove screenshot"
                          className="px-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-red-600"
                        >
                          ✕
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Main editable canvas */}
        <div className="flex flex-col items-center">
          <EditorCanvas
            template={templateConfig}
            slot={active.config}
            slotNumber={active.order}
            totalSlots={slots.length}
            screenshotUrl={
              project
                ? (() => {
                    const screen = screensByOrder.get(active.order);
                    return screen ? `/api/uploads/${screen.screenshotPath}` : undefined;
                  })()
                : undefined
            }
            selectedElementId={selectedElementId}
            onChange={(next) => updateSlotConfig(active.id, next)}
            onSelectElement={setSelectedElementId}
          />

          {/* Slot nav */}
          <div className="mt-6 flex items-center gap-2">
            <button
              onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
              disabled={activeIdx === 0}
              className="px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 disabled:opacity-30"
            >
              ←
            </button>
            <span className="text-sm tabular-nums px-2">
              Slot {active.order} of {slots.length}
            </span>
            <button
              onClick={() => setActiveIdx((i) => Math.min(slots.length - 1, i + 1))}
              disabled={activeIdx === slots.length - 1}
              className="px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 disabled:opacity-30"
            >
              →
            </button>
            <button
              onClick={addSlot}
              className="ml-2 px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              + Add
            </button>
            <button
              onClick={removeSlot}
              disabled={slots.length <= 1}
              className="px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              − Remove
            </button>
          </div>
        </div>
      </div>

      {/* ---- Inspector ---- */}
      <aside className="space-y-6">
        <Section title="Template">
          <Label>Name</Label>
          <input
            value={templateName}
            onChange={(e) => {
              setTemplateName(e.target.value);
              markTemplateDirty();
            }}
            onBlur={() => router.refresh()}
            className="input"
          />

          <Label className="mt-3">Default background color</Label>
          <ColorRow
            value={templateConfig.backgroundColor}
            onChange={(v) => {
              setTemplateConfig((c) => ({ ...c, backgroundColor: v }));
              markTemplateDirty();
            }}
            palette={palette}
          />

          <Label className="mt-3">Bezel color</Label>
          <ColorRow
            value={templateConfig.bezelColor}
            onChange={(v) => {
              setTemplateConfig((c) => ({ ...c, bezelColor: v }));
              markTemplateDirty();
            }}
            palette={["#1f1f1f", "#3f3f46", "#6b6b6b", "#c4c4c4", "#e8e8e8", "#1e3a8a"]}
          />

          <Label className="mt-3">Bezel corner radius</Label>
          <Slider
            min={0}
            max={200}
            step={2}
            value={Math.round(templateConfig.bezelCornerRadius)}
            onChange={(v) => {
              setTemplateConfig((c) => ({ ...c, bezelCornerRadius: v }));
              markTemplateDirty();
            }}
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

          <Label className="mt-3">Background mode</Label>
          <select
            value={templateConfig.bgImageMode}
            onChange={(e) => {
              setTemplateConfig((c) => ({
                ...c,
                bgImageMode: e.target.value as "single" | "panorama",
              }));
              markTemplateDirty();
            }}
            className="input"
          >
            <option value="single">Single — same image on every slot</option>
            <option value="panorama">Panorama — image spans all slots</option>
          </select>
          {templateConfig.bgImageMode === "panorama" && (
            <>
              <p className="text-[11px] text-zinc-500 mt-1 leading-snug">
                Image is split into {slots.length} equal vertical bands; slot N gets band N.
                Per-slot pan is ignored — recommended source width ≈{" "}
                {1290 * slots.length}px (≈ 1290 × slot count) for crisp output.
              </p>
              <Label className="mt-3">Panorama zoom (whole image)</Label>
              <Slider
                min={1}
                max={3}
                step={0.05}
                value={templateConfig.bgImagePanoZoom}
                onChange={(v) => {
                  setTemplateConfig((c) => ({ ...c, bgImagePanoZoom: v }));
                  markTemplateDirty();
                }}
              />
              <Label className="mt-3">Panorama blur (whole image)</Label>
              <Slider
                min={0}
                max={60}
                value={templateConfig.bgImagePanoBlur}
                onChange={(v) => {
                  setTemplateConfig((c) => ({ ...c, bgImagePanoBlur: v }));
                  markTemplateDirty();
                }}
              />
              <Label className="mt-3">Panorama brightness (whole image)</Label>
              <Slider
                min={0}
                max={1.5}
                step={0.05}
                value={templateConfig.bgImagePanoBrightness}
                onChange={(v) => {
                  setTemplateConfig((c) => ({ ...c, bgImagePanoBrightness: v }));
                  markTemplateDirty();
                }}
              />
            </>
          )}
        </Section>

        {/* ---- Elements (text + icons) ---- */}
        <Section title={`Slot ${active.order} elements`}>
          {active.config.elements.length === 0 ? (
            <div className="text-xs text-zinc-500 mb-3">
              No elements yet. Add text or an icon below.
            </div>
          ) : (
            <ul className="space-y-1 mb-3">
              {active.config.elements.map((el, i) => {
                const isSel = el.id === selectedElementId;
                const label =
                  el.type === "text"
                    ? `T  ${el.text || "(empty)"}`
                    : `★  ${el.icon}`;
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
                      <span className="font-mono text-zinc-500 mr-1">
                        {el.type === "text" ? "T" : "★"}
                      </span>
                      {el.type === "text"
                        ? el.text || "(empty text)"
                        : el.icon}
                    </button>
                    <button
                      onClick={() => moveElement(el.id, -1)}
                      disabled={i === 0}
                      title="Move down (back)"
                      className="px-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => moveElement(el.id, 1)}
                      disabled={i === active.config.elements.length - 1}
                      title="Move up (front)"
                      className="px-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => removeElement(el.id)}
                      title="Delete"
                      className="px-1 text-zinc-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={addTextElement}
              className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              + Add text
            </button>
            <IconPicker
              onPick={addIconElement}
              customIcons={templateConfig.customIcons}
              onUploadCustom={uploadCustomIcon}
              onDeleteCustom={removeCustomIcon}
            />
          </div>

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
          {!selectedElement && active.config.elements.length > 0 && (
            <div className="text-[11px] text-zinc-500">
              Click an element above (or on the canvas) to edit it.
            </div>
          )}
        </Section>

        <Section title="Device">
          <Label>Background override (color)</Label>
          <ColorRow
            value={active.config.backgroundColor ?? templateConfig.backgroundColor}
            onChange={(v) =>
              updateSlotConfig(active.id, { ...active.config, backgroundColor: v })
            }
            palette={palette}
            allowClear
            onClear={() =>
              updateSlotConfig(active.id, {
                ...active.config,
                backgroundColor: undefined,
              })
            }
          />

          <Label className="mt-3">Device rotation (Z-axis spin)</Label>
          <Slider
            min={-30}
            max={30}
            value={active.config.deviceRotation}
            onChange={(v) =>
              updateSlotConfig(active.id, { ...active.config, deviceRotation: v })
            }
          />

          <Label className="mt-3">Device tilt — show side edge (Y axis)</Label>
          <Slider
            min={-30}
            max={30}
            value={active.config.deviceTiltY}
            onChange={(v) =>
              updateSlotConfig(active.id, { ...active.config, deviceTiltY: v })
            }
          />

          <Label className="mt-3">Device tilt — show top/bottom edge (X axis)</Label>
          <Slider
            min={-30}
            max={30}
            value={active.config.deviceTiltX}
            onChange={(v) =>
              updateSlotConfig(active.id, { ...active.config, deviceTiltX: v })
            }
          />

          <Label className="mt-3">Device scale</Label>
          <Slider
            min={0.3}
            max={1.2}
            step={0.05}
            value={active.config.deviceScale}
            onChange={(v) =>
              updateSlotConfig(active.id, { ...active.config, deviceScale: v })
            }
          />
        </Section>

        <Section title="Background image framing">
          {!hasBg && (
            <div className="text-xs text-zinc-500 mb-2">
              Upload a background image (Template section above) to enable these controls.
            </div>
          )}
          <div className={hasBg ? "" : "opacity-40 pointer-events-none"}>
            {templateConfig.bgImageMode === "panorama" ? (
              <div className="text-[11px] text-zinc-500 leading-snug">
                Per-slot framing is locked in panorama mode so adjacent slots stay continuous.
                Use the <span className="font-medium">Panorama zoom / blur / brightness</span>{" "}
                sliders in the Template section to adjust the whole panorama uniformly.
              </div>
            ) : (
              <>
                <Label>Pan X</Label>
                <Slider
                  min={-1}
                  max={1}
                  step={0.05}
                  value={active.config.bgImagePan.x}
                  onChange={(v) =>
                    updateSlotConfig(active.id, {
                      ...active.config,
                      bgImagePan: { ...active.config.bgImagePan, x: v },
                    })
                  }
                />
                <Label className="mt-3">Pan Y</Label>
                <Slider
                  min={-1}
                  max={1}
                  step={0.05}
                  value={active.config.bgImagePan.y}
                  onChange={(v) =>
                    updateSlotConfig(active.id, {
                      ...active.config,
                      bgImagePan: { ...active.config.bgImagePan, y: v },
                    })
                  }
                />
                <Label className="mt-3">Zoom</Label>
                <Slider
                  min={1}
                  max={3}
                  step={0.1}
                  value={active.config.bgImageZoom}
                  onChange={(v) =>
                    updateSlotConfig(active.id, { ...active.config, bgImageZoom: v })
                  }
                />
                <Label className="mt-3">Blur (focus)</Label>
                <Slider
                  min={0}
                  max={60}
                  value={active.config.bgImageBlur}
                  onChange={(v) =>
                    updateSlotConfig(active.id, { ...active.config, bgImageBlur: v })
                  }
                />
                <Label className="mt-3">Brightness</Label>
                <Slider
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={active.config.bgImageBrightness}
                  onChange={(v) =>
                    updateSlotConfig(active.id, { ...active.config, bgImageBrightness: v })
                  }
                />
              </>
            )}
          </div>
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
        Drag the corners to resize, the side handles to change wrap width, the
        top handle to rotate, or double-click on the canvas to edit text in place.
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
        + Add icon
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

// ============================================================================
// Small UI helpers (unchanged from before)
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
