"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import {
  CanvasElement,
  CUSTOM_ICON_PREFIX,
  CustomIcon,
  DEFAULT_TEXT_SHADOW,
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
  TextShadow,
} from "@/lib/editor-types";
import { ICON_KEYS, ICONS } from "@/lib/icons";
import { FONT_OPTIONS, TEMPLATE_FONT_VALUE } from "@/lib/fonts";
import { autoWidth } from "@/lib/textMeasure";
import { ExportButton } from "@/components/project/ExportButton";
import { Popover } from "./Popover";

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

  function updateConfig(updater: (c: TemplateConfig) => TemplateConfig) {
    setTemplateConfig((c) => updater(c));
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
    const el = defaultHeadlineElement("Text");
    el.pos = { x: 0.5, y: 0.12 };
    addElement(el);
  }

  function addIconElement(iconKey: string) {
    const el = defaultIconElement(iconKey);
    addElement(el);
  }

  function addDeviceElement() {
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

  const devicesWithScreenshots = useMemo(
    () =>
      templateConfig.elements.filter(
        (el) => el.type === "device" && el.screenshotId
      ).length,
    [templateConfig.elements]
  );
  const isReady = templateConfig.panelCount > 0;

  const exportPayload = useMemo(
    () => ({
      id: project.projectId,
      name: project.projectName,
      template: {
        id: initial.id,
        name: templateName,
        slotCount: templateConfig.panelCount,
        config: JSON.stringify(templateConfig),
        slots: [],
      },
      screens: [],
    }),
    [project.projectId, project.projectName, initial.id, templateName, templateConfig]
  );

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* ---- Top toolbar ---- */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={addTextElement}
          className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          + Text
        </button>
        <IconAddPopover
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

        <span className="mx-1 h-5 w-px bg-zinc-300 dark:bg-zinc-700" />

        <Popover
          label={<>Layers <Caret /></>}
          panelClassName="w-72"
        >
          <LayersPanel
            elements={templateConfig.elements}
            selectedId={selectedElementId}
            onSelect={setSelectedElementId}
            onMove={moveElement}
            onRemove={removeElement}
          />
        </Popover>

        <Popover
          label={<>Project <Caret /></>}
          panelClassName="w-80"
        >
          <ProjectPanel
            templateName={templateName}
            onTemplateName={(v) => {
              setTemplateName(v);
              markDirty();
            }}
            onTemplateNameCommit={() => router.refresh()}
            backgroundColor={templateConfig.backgroundColor}
            onBackgroundColor={(v) =>
              updateConfig((c) => ({ ...c, backgroundColor: v }))
            }
            bezelColor={templateConfig.bezelColor}
            onBezelColor={(v) =>
              updateConfig((c) => ({ ...c, bezelColor: v }))
            }
            bezelCornerRadius={templateConfig.bezelCornerRadius}
            onBezelCornerRadius={(v) =>
              updateConfig((c) => ({ ...c, bezelCornerRadius: v }))
            }
            palette={palette}
          />
        </Popover>

        <Popover
          label={<>Background <Caret /></>}
          panelClassName="w-80"
        >
          <BackgroundPanel
            hasBg={hasBg}
            bgThumbUrl={bgThumbUrl}
            uploadingBg={uploadingBg}
            fileInputRef={bgFileInput}
            onUploadBg={uploadBg}
            onRemoveBg={removeBg}
            panelCount={templateConfig.panelCount}
            zoom={templateConfig.bgImagePanoZoom}
            blur={templateConfig.bgImagePanoBlur}
            brightness={templateConfig.bgImagePanoBrightness}
            onZoom={(v) =>
              updateConfig((c) => ({ ...c, bgImagePanoZoom: v }))
            }
            onBlur={(v) =>
              updateConfig((c) => ({ ...c, bgImagePanoBlur: v }))
            }
            onBrightness={(v) =>
              updateConfig((c) => ({ ...c, bgImagePanoBrightness: v }))
            }
          />
        </Popover>

        <Popover
          label={<>Screenshots <Caret /></>}
          panelClassName="w-80"
        >
          <ScreenshotsPanel
            screenshots={templateConfig.screenshots}
            uploading={uploadingScreenshot}
            fileInputRef={screenshotFileInput}
            onUpload={uploadScreenshot}
            onDelete={deleteScreenshot}
          />
        </Popover>

        <span className="ml-2 text-xs text-zinc-500">
          {templateConfig.panelCount} panel{templateConfig.panelCount === 1 ? "" : "s"}
          {devicesWithScreenshots > 0 &&
            ` · ${devicesWithScreenshots} device${devicesWithScreenshots === 1 ? "" : "s"} with screenshot`}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-zinc-500 tabular-nums">
            {saving ? "Saving…" : "Saved"}
          </span>
          <ExportButton project={exportPayload} ready={isReady} />
        </div>
      </div>

      {/* ---- Contextual element bar (only when something is selected) ---- */}
      {selectedElement && (
        <div className="flex items-center gap-3 flex-wrap rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 px-3 py-2">
          {selectedElement.type === "text" && (
            <TextElementBar
              element={selectedElement}
              onPatch={(patch) => patchTextWithReflow(selectedElement.id, patch)}
              onDelete={() => removeElement(selectedElement.id)}
              onMove={(dir) => moveElement(selectedElement.id, dir)}
            />
          )}
          {selectedElement.type === "icon" && (
            <IconElementBar
              element={selectedElement}
              customIcons={templateConfig.customIcons}
              onUploadCustom={uploadCustomIcon}
              onDeleteCustom={removeCustomIcon}
              onPatch={(patch) => patchElement(selectedElement.id, patch)}
              onDelete={() => removeElement(selectedElement.id)}
              onMove={(dir) => moveElement(selectedElement.id, dir)}
            />
          )}
          {selectedElement.type === "device" && (
            <DeviceElementBar
              element={selectedElement}
              screenshots={templateConfig.screenshots}
              panelCount={templateConfig.panelCount}
              onPatch={(patch) => patchElement(selectedElement.id, patch)}
              onUploadAndAttach={async (file) => {
                const id = await uploadScreenshot(file);
                if (id) patchElement(selectedElement.id, { screenshotId: id });
              }}
              onDelete={() => removeElement(selectedElement.id)}
              onMove={(dir) => moveElement(selectedElement.id, dir)}
            />
          )}
        </div>
      )}

      {/* ---- Canvas ---- */}
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

      {/* ---- Panel count stepper ---- */}
      <div className="flex items-center gap-2">
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
// Toolbar popover panels
// ============================================================================

function LayersPanel({
  elements,
  selectedId,
  onSelect,
  onMove,
  onRemove,
}: {
  elements: CanvasElement[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
}) {
  if (elements.length === 0) {
    return (
      <div className="text-xs text-zinc-500">
        No elements yet. Use + Text / + Icon / + Device.
      </div>
    );
  }
  return (
    <ul className="space-y-1 max-h-72 overflow-y-auto">
      {elements.map((el, i) => {
        const isSel = el.id === selectedId;
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
              onClick={() => onSelect(el.id)}
              className="flex-1 text-left truncate"
            >
              <span className="font-mono text-zinc-500 mr-1">{glyph}</span>
              {label}
            </button>
            <button
              onClick={() => onMove(el.id, -1)}
              disabled={i === 0}
              className="px-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30"
              title="Send back"
            >
              ↓
            </button>
            <button
              onClick={() => onMove(el.id, 1)}
              disabled={i === elements.length - 1}
              className="px-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30"
              title="Bring forward"
            >
              ↑
            </button>
            <button
              onClick={() => onRemove(el.id)}
              className="px-1 text-zinc-400 hover:text-red-600"
              title="Delete"
            >
              ✕
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ProjectPanel({
  templateName,
  onTemplateName,
  onTemplateNameCommit,
  backgroundColor,
  onBackgroundColor,
  bezelColor,
  onBezelColor,
  bezelCornerRadius,
  onBezelCornerRadius,
  palette,
}: {
  templateName: string;
  onTemplateName: (v: string) => void;
  onTemplateNameCommit: () => void;
  backgroundColor: string;
  onBackgroundColor: (v: string) => void;
  bezelColor: string;
  onBezelColor: (v: string) => void;
  bezelCornerRadius: number;
  onBezelCornerRadius: (v: number) => void;
  palette: string[];
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Name</Label>
        <input
          value={templateName}
          onChange={(e) => onTemplateName(e.target.value)}
          onBlur={onTemplateNameCommit}
          className="input"
        />
      </div>
      <div>
        <Label>Default background color</Label>
        <ColorRow
          value={backgroundColor}
          onChange={onBackgroundColor}
          palette={palette}
        />
      </div>
      <div>
        <Label>Bezel color</Label>
        <ColorRow
          value={bezelColor}
          onChange={onBezelColor}
          palette={["#1f1f1f", "#3f3f46", "#6b6b6b", "#c4c4c4", "#e8e8e8", "#1e3a8a"]}
        />
      </div>
      <div>
        <Label>Bezel corner radius</Label>
        <Slider
          min={0}
          max={200}
          step={2}
          value={Math.round(bezelCornerRadius)}
          onChange={onBezelCornerRadius}
        />
      </div>
    </div>
  );
}

function BackgroundPanel({
  hasBg,
  bgThumbUrl,
  uploadingBg,
  fileInputRef,
  onUploadBg,
  onRemoveBg,
  panelCount,
  zoom,
  blur,
  brightness,
  onZoom,
  onBlur,
  onBrightness,
}: {
  hasBg: boolean;
  bgThumbUrl: string | null;
  uploadingBg: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onUploadBg: (file: File) => void | Promise<void>;
  onRemoveBg: () => void | Promise<void>;
  panelCount: number;
  zoom: number;
  blur: number;
  brightness: number;
  onZoom: (v: number) => void;
  onBlur: (v: number) => void;
  onBrightness: (v: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Background image</Label>
        <div className="flex items-center gap-2">
          {bgThumbUrl && (
            <div
              className="w-12 h-12 rounded border border-zinc-300 dark:border-zinc-700 bg-cover bg-center"
              style={{ backgroundImage: `url("${bgThumbUrl}")` }}
            />
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUploadBg(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingBg}
            className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            {uploadingBg ? "Uploading…" : hasBg ? "Replace" : "Upload"}
          </button>
          {hasBg && (
            <button
              onClick={onRemoveBg}
              className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Remove
            </button>
          )}
        </div>
        <p className="text-[11px] text-zinc-500 mt-1 leading-snug">
          Bg image spans all {panelCount} panel{panelCount === 1 ? "" : "s"};
          each export PNG gets its slice.
        </p>
      </div>
      {hasBg && (
        <>
          <div>
            <Label>Bg zoom</Label>
            <Slider min={1} max={3} step={0.05} value={zoom} onChange={onZoom} />
          </div>
          <div>
            <Label>Bg blur</Label>
            <Slider
              min={0}
              max={60}
              step={1}
              value={Math.round(blur)}
              onChange={onBlur}
            />
          </div>
          <div>
            <Label>Bg brightness</Label>
            <Slider
              min={0}
              max={1.5}
              step={0.05}
              value={brightness}
              onChange={onBrightness}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ScreenshotsPanel({
  screenshots,
  uploading,
  fileInputRef,
  onUpload,
  onDelete,
}: {
  screenshots: { id: string; path: string }[];
  uploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (file: File) => void | Promise<unknown>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 mb-2"
      >
        {uploading ? "Uploading…" : "+ Upload screenshot"}
      </button>
      {screenshots.length === 0 ? (
        <div className="text-xs text-zinc-500">
          No screenshots yet. Upload one to attach to any device.
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-1">
          {screenshots.map((s) => (
            <div key={s.id} className="relative group">
              <div
                className="aspect-[1/2] rounded border border-zinc-300 dark:border-zinc-700 bg-cover bg-center bg-zinc-50 dark:bg-zinc-800"
                style={{ backgroundImage: `url("/api/uploads/${s.path}")` }}
                title={s.id}
              />
              <button
                onClick={() => onDelete(s.id)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-zinc-900 text-white text-[9px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Contextual element bars (selected element)
// ============================================================================

function TextElementBar({
  element,
  onPatch,
  onDelete,
  onMove,
}: {
  element: TextElement;
  onPatch: (patch: Partial<TextElement>) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <>
      <Badge>Text</Badge>
      <Popover label={<>Edit text <Caret /></>} panelClassName="w-72">
        <textarea
          value={element.text}
          onChange={(e) => onPatch({ text: e.target.value })}
          className="input"
          rows={3}
          autoFocus
        />
      </Popover>
      <Field label="Font" width="w-36">
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
      </Field>
      <Field label="Size">
        <CompactSlider
          min={20}
          max={300}
          value={Math.round(element.fontSize)}
          onChange={(v) => onPatch({ fontSize: v })}
        />
      </Field>
      <Field label="Weight" width="w-20">
        <select
          value={element.weight}
          onChange={(e) => onPatch({ weight: Number(e.target.value) })}
          className="input"
        >
          {[400, 500, 600, 700, 800].map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </Field>
      <ToggleButton
        active={element.weight >= 700}
        onClick={() =>
          onPatch({ weight: element.weight >= 700 ? 400 : 700 })
        }
        title="Bold"
      >
        <span className="font-bold">B</span>
      </ToggleButton>
      <ToggleButton
        active={element.italic}
        onClick={() => onPatch({ italic: !element.italic })}
        title="Italic"
      >
        <span className="italic">I</span>
      </ToggleButton>
      <div className="flex items-center gap-0.5">
        {(["left", "center", "right"] as const).map((a) => (
          <ToggleButton
            key={a}
            active={element.align === a}
            onClick={() => onPatch({ align: a })}
            title={`Align ${a}`}
          >
            <AlignGlyph align={a} />
          </ToggleButton>
        ))}
      </div>
      <Popover
        label={
          <span className="inline-flex items-center gap-1">
            Color
            <span
              className="w-3 h-3 rounded-sm border border-zinc-400"
              style={{ background: element.color }}
            />
          </span>
        }
        panelClassName="w-56"
      >
        <ColorRow
          value={element.color}
          onChange={(v) => onPatch({ color: v })}
          palette={["#ffffff", "#000000", "#f3f4f6", "#1f2937", "#fef3c7"]}
        />
      </Popover>
      <Field label="Rotation">
        <CompactSlider
          min={-180}
          max={180}
          value={Math.round(element.rotation)}
          onChange={(v) => onPatch({ rotation: v })}
        />
      </Field>
      <ShadowPopover
        shadow={element.shadow}
        onChange={(shadow) => onPatch({ shadow })}
      />
      <OverflowMenu onDelete={onDelete} onMove={onMove} />
    </>
  );
}

function ShadowPopover({
  shadow,
  onChange,
}: {
  shadow: TextShadow | undefined;
  onChange: (shadow: TextShadow | undefined) => void;
}) {
  const enabled = !!shadow;
  return (
    <Popover
      label={
        <span className="inline-flex items-center gap-1">
          Shadow
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              enabled ? "bg-blue-500" : "bg-zinc-400/40"
            }`}
          />
          <Caret />
        </span>
      }
      panelClassName="w-64 space-y-3"
    >
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            onChange(e.target.checked ? { ...DEFAULT_TEXT_SHADOW } : undefined)
          }
        />
        Enable drop shadow
      </label>
      {enabled && shadow && (
        <div className="space-y-2">
          <div>
            <Label>Color</Label>
            <ColorRow
              value={shadow.color}
              onChange={(v) => onChange({ ...shadow, color: v })}
              palette={["#000000", "#1f2937", "#ffffff", "#dc2626", "#1d4ed8"]}
            />
          </div>
          <div>
            <Label>Blur</Label>
            <Slider
              min={0}
              max={60}
              step={1}
              value={Math.round(shadow.blur)}
              onChange={(v) => onChange({ ...shadow, blur: v })}
            />
          </div>
          <div>
            <Label>Offset X</Label>
            <Slider
              min={-40}
              max={40}
              step={1}
              value={Math.round(shadow.offsetX)}
              onChange={(v) => onChange({ ...shadow, offsetX: v })}
            />
          </div>
          <div>
            <Label>Offset Y</Label>
            <Slider
              min={-40}
              max={40}
              step={1}
              value={Math.round(shadow.offsetY)}
              onChange={(v) => onChange({ ...shadow, offsetY: v })}
            />
          </div>
          <div>
            <Label>Opacity</Label>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={shadow.opacity}
              onChange={(v) => onChange({ ...shadow, opacity: v })}
            />
          </div>
        </div>
      )}
    </Popover>
  );
}

function IconElementBar({
  element,
  customIcons,
  onUploadCustom,
  onDeleteCustom,
  onPatch,
  onDelete,
  onMove,
}: {
  element: IconElement;
  customIcons: CustomIcon[];
  onUploadCustom: (file: File) => void | Promise<void>;
  onDeleteCustom: (iconId: string) => void | Promise<void>;
  onPatch: (patch: Partial<IconElement>) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const elementIsCustom = isCustomIcon(element.icon);
  return (
    <>
      <Badge>Icon</Badge>
      <Popover label={<>Icon <Caret /></>} panelClassName="w-64 space-y-2">
        {({ close }) => (
          <>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
              Built-in
            </div>
            <div className="grid grid-cols-6 gap-1">
              {ICON_KEYS.map((key) => {
                const def = ICONS[key];
                const isSel = key === element.icon;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      onPatch({ icon: key });
                      close();
                    }}
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
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 pt-1">
              Custom SVG
            </div>
            <CustomIconGrid
              customIcons={customIcons}
              selectedIconValue={element.icon}
              onPick={(value) => {
                onPatch({ icon: value });
                close();
              }}
              onUpload={onUploadCustom}
              onDelete={onDeleteCustom}
            />
          </>
        )}
      </Popover>
      <Field label="Size">
        <CompactSlider
          min={40}
          max={600}
          value={Math.round(element.size)}
          onChange={(v) => onPatch({ size: v })}
        />
      </Field>
      <Field label="Rotation">
        <CompactSlider
          min={-180}
          max={180}
          value={Math.round(element.rotation)}
          onChange={(v) => onPatch({ rotation: v })}
        />
      </Field>
      <Popover
        label={
          <span className="inline-flex items-center gap-1">
            Color
            <span
              className="w-3 h-3 rounded-sm border border-zinc-400"
              style={{ background: element.color }}
            />
          </span>
        }
        panelClassName="w-56"
        disabled={elementIsCustom}
        title={elementIsCustom ? "Custom SVGs keep their own colours" : undefined}
      >
        <ColorRow
          value={element.color}
          onChange={(v) => onPatch({ color: v })}
          palette={["#ffffff", "#000000", "#1d4ed8", "#f59e0b", "#ef4444"]}
        />
      </Popover>
      <OverflowMenu onDelete={onDelete} onMove={onMove} />
    </>
  );
}

function DeviceElementBar({
  element,
  screenshots,
  panelCount,
  onPatch,
  onUploadAndAttach,
  onDelete,
  onMove,
}: {
  element: DeviceElement;
  screenshots: { id: string; path: string }[];
  panelCount: number;
  onPatch: (patch: Partial<DeviceElement>) => void;
  onUploadAndAttach: (file: File) => void | Promise<void>;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const currentPanel = Math.max(
    0,
    Math.min(panelCount - 1, element.panelIndex ?? Math.floor(element.pos.x))
  );
  const currentScreenshot = element.screenshotId
    ? screenshots.find((s) => s.id === element.screenshotId)
    : null;
  return (
    <>
      <Badge>Device</Badge>
      <Field label="Size">
        <CompactSlider
          min={0.2}
          max={1.5}
          step={0.05}
          value={element.size}
          onChange={(v) => onPatch({ size: v })}
          decimals={2}
        />
      </Field>
      <Field label="Rotation">
        <CompactSlider
          min={-90}
          max={90}
          value={Math.round(element.rotation)}
          onChange={(v) => onPatch({ rotation: v })}
        />
      </Field>
      <Field label="Tilt X">
        <CompactSlider
          min={-30}
          max={30}
          value={Math.round(element.tiltX)}
          onChange={(v) => onPatch({ tiltX: v })}
        />
      </Field>
      <Field label="Tilt Y">
        <CompactSlider
          min={-30}
          max={30}
          value={Math.round(element.tiltY)}
          onChange={(v) => onPatch({ tiltY: v })}
        />
      </Field>
      <Field label="Tile" width="w-20">
        <select
          className="input"
          value={currentPanel}
          onChange={(e) => {
            const next = Number(e.target.value);
            const delta = next - currentPanel;
            onPatch({
              panelIndex: next,
              pos: { x: element.pos.x + delta, y: element.pos.y },
            });
          }}
        >
          {Array.from({ length: panelCount }, (_, i) => (
            <option key={i} value={i}>
              {i + 1}
            </option>
          ))}
        </select>
      </Field>
      <Popover
        label={
          <span className="inline-flex items-center gap-1">
            Screenshot
            {currentScreenshot ? (
              <span
                className="inline-block w-4 h-4 rounded-sm border border-zinc-400 bg-cover bg-center"
                style={{
                  backgroundImage: `url("/api/uploads/${currentScreenshot.path}")`,
                }}
              />
            ) : null}
            <Caret />
          </span>
        }
        panelClassName="w-80"
      >
        {({ close }) => (
          <div>
            <div className="grid grid-cols-4 gap-1 mb-2">
              {screenshots.map((s) => {
                const isSel = s.id === element.screenshotId;
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      onPatch({ screenshotId: s.id });
                      close();
                    }}
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
                className="text-[11px] text-zinc-500 hover:text-red-600"
              >
                Detach screenshot
              </button>
            )}
          </div>
        )}
      </Popover>
      <OverflowMenu onDelete={onDelete} onMove={onMove} />
    </>
  );
}

// ============================================================================
// Bar primitives
// ============================================================================

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-200/60 dark:bg-zinc-800/60">
      {children}
    </span>
  );
}

function Field({
  label,
  width = "w-32",
  children,
}: {
  label: string;
  width?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-0.5 ${width}`}>
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      {children}
    </div>
  );
}

function CompactSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  decimals = 0,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  decimals?: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 min-w-0"
      />
      <span className="text-[10px] tabular-nums w-10 text-right text-zinc-600 dark:text-zinc-400">
        {decimals > 0 ? value.toFixed(decimals) : Math.round(value)}
      </span>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`text-xs w-7 h-7 inline-flex items-center justify-center rounded border ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 border-zinc-900 dark:border-zinc-100"
          : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

function AlignGlyph({ align }: { align: "left" | "center" | "right" }) {
  const bars =
    align === "left"
      ? ["w-3.5", "w-2.5", "w-3.5"]
      : align === "center"
      ? ["w-3.5", "w-2.5", "w-3.5"]
      : ["w-3.5", "w-2.5", "w-3.5"];
  const justify =
    align === "left"
      ? "items-start"
      : align === "center"
      ? "items-center"
      : "items-end";
  return (
    <div className={`flex flex-col gap-0.5 ${justify}`}>
      {bars.map((w, i) => (
        <span key={i} className={`h-0.5 ${w} bg-current rounded`} />
      ))}
    </div>
  );
}

function Caret() {
  return <span className="text-[10px] text-zinc-500">▾</span>;
}

function OverflowMenu({
  onDelete,
  onMove,
}: {
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <Popover label={<span aria-label="More">⋮</span>} align="right" panelClassName="w-44">
      {({ close }) => (
        <div className="flex flex-col text-xs">
          <button
            onClick={() => {
              onMove(1);
              close();
            }}
            className="text-left px-2 py-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Bring forward ↑
          </button>
          <button
            onClick={() => {
              onMove(-1);
              close();
            }}
            className="text-left px-2 py-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Send back ↓
          </button>
          <button
            onClick={() => {
              onDelete();
              close();
            }}
            className="text-left px-2 py-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950 text-red-600"
          >
            Delete
          </button>
        </div>
      )}
    </Popover>
  );
}

// ============================================================================
// Misc UI helpers
// ============================================================================

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

function IconAddPopover({
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
  return (
    <Popover label="+ Icon" panelClassName="w-64 space-y-2">
      {({ close }) => (
        <>
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
                    close();
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
              close();
            }}
            onUpload={onUploadCustom}
            onDelete={onDeleteCustom}
          />
        </>
      )}
    </Popover>
  );
}

void defaultTextElement;

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
}: {
  value: string;
  onChange: (v: string) => void;
  palette: string[];
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
    </div>
  );
}
