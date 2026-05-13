"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import {
  DEFAULT_SLOT_CONFIG,
  DEFAULT_TEMPLATE_CONFIG,
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

  const active = slots[activeIdx];

  // ---- Autosave ----

  // Track which slots/template are dirty since last save.
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
      // re-number locally so order matches what server did
      return next.map((s, i) => ({ ...s, order: i + 1 }));
    });
    setActiveIdx((idx) => Math.max(0, idx - 1));
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

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      {/* ---- Canvas ---- */}
      <div className="flex flex-col items-center">
        <EditorCanvas
          template={templateConfig}
          slot={active.config}
          slotNumber={active.order}
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

      {/* ---- Inspector ---- */}
      <aside className="space-y-6">
        {/* Template name */}
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
          <Label className="mt-3">Default background</Label>
          <ColorRow
            value={templateConfig.backgroundColor}
            onChange={(v) => {
              setTemplateConfig((c) => ({ ...c, backgroundColor: v }));
              markTemplateDirty();
            }}
            palette={palette}
          />
        </Section>

        {/* Slot copy */}
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

        {/* Slot style */}
        <Section title="Style">
          <Label>Background override</Label>
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

          <Label className="mt-3">Device tilt</Label>
          <Slider
            min={-30}
            max={30}
            value={active.config.deviceRotation}
            onChange={(v) =>
              updateSlotConfig(active.id, { ...active.config, deviceRotation: v })
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
