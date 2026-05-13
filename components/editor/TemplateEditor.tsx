"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import {
  DEFAULT_SLOT_CONFIG,
  parseSlotConfig,
  parseTemplateConfig,
  SlotConfig,
  TemplateConfig,
} from "@/lib/editor-types";

const EditorCanvas = dynamic(
  () => import("./EditorCanvas").then((m) => m.EditorCanvas),
  { ssr: false }
);

export type SlotPayload = {
  id: string;
  order: number;
  headline: string;
  subhead: string | null;
  config: string;
};

export type TemplatePayload = {
  id: string;
  name: string;
  slotCount: number;
  config: string;
  slots: SlotPayload[];
};

type SlotState = {
  id: string;
  order: number;
  headline: string;
  subhead: string;
  config: SlotConfig;
};

export function TemplateEditor({ template: initial }: { template: TemplatePayload }) {
  const router = useRouter();

  const [templateConfig, setTemplateConfig] = useState<TemplateConfig>(() =>
    parseTemplateConfig(initial.config)
  );
  const [templateName, setTemplateName] = useState(initial.name);
  const [slots, setSlots] = useState<SlotState[]>(() =>
    initial.slots.map((s) => ({
      id: s.id,
      order: s.order,
      headline: s.headline,
      subhead: s.subhead ?? "",
      config: parseSlotConfig(s.config),
    }))
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const bgFileInput = useRef<HTMLInputElement>(null);

  const active = slots[activeIdx];

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
          body: JSON.stringify({
            headline: s.headline,
            subhead: s.subhead || null,
            config: s.config,
          }),
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

  function updateSlot(id: string, patch: Partial<SlotState>) {
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
    markSlotDirty(id);
  }

  function updateSlotConfig(id: string, next: SlotConfig) {
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, config: next } : s))
    );
    markSlotDirty(id);
  }

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
        headline: slot.headline,
        subhead: slot.subhead ?? "",
        config: DEFAULT_SLOT_CONFIG,
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

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      {/* ---- Left column ---- */}
      <div className="flex flex-col items-stretch">
        {/* Filmstrip */}
        <div className="mb-4 flex gap-2 overflow-x-auto pb-2 -mx-2 px-2">
          {slots.map((s, i) => {
            const isActive = i === activeIdx;
            return (
              <button
                key={s.id}
                onClick={() => setActiveIdx(i)}
                className={`shrink-0 rounded-lg p-1 border ${
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
                    headline={s.headline}
                    subhead={s.subhead || null}
                    readOnly
                    maxWidthClass=""
                    tiltSubdivisions={12}
                  />
                </div>
                <div className="text-[10px] text-center text-zinc-500 mt-1">
                  {s.order}
                </div>
              </button>
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
            headline={active.headline}
            subhead={active.subhead || null}
            onChange={(next) => updateSlotConfig(active.id, next)}
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

        <Section title={`Slot ${active.order}`}>
          <Label>Headline</Label>
          <input
            value={active.headline}
            onChange={(e) => updateSlot(active.id, { headline: e.target.value })}
            className="input"
          />
          <Label className="mt-3">Subheadline</Label>
          <input
            value={active.subhead}
            onChange={(e) => updateSlot(active.id, { subhead: e.target.value })}
            placeholder="(optional)"
            className="input"
          />
        </Section>

        <Section title="Style">
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

          <Label className="mt-3">Headline size</Label>
          <Slider
            min={40}
            max={180}
            value={active.config.headlineSize}
            onChange={(v) =>
              updateSlotConfig(active.id, { ...active.config, headlineSize: v })
            }
          />

          <Label className="mt-3">Subhead size</Label>
          <Slider
            min={20}
            max={120}
            value={active.config.subheadSize}
            onChange={(v) =>
              updateSlotConfig(active.id, { ...active.config, subheadSize: v })
            }
          />

          <Label className="mt-3">Text color</Label>
          <ColorRow
            value={active.config.headlineColor}
            onChange={(v) =>
              updateSlotConfig(active.id, {
                ...active.config,
                headlineColor: v,
                subheadColor: v,
              })
            }
            palette={["#ffffff", "#000000", "#f3f4f6", "#1f2937", "#fef3c7"]}
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
