"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import {
  parseSlotConfig,
  parseTemplateConfig,
  SlotConfig,
  TemplateConfig,
} from "@/lib/editor-types";
import { ExportButton } from "./ExportButton";

const EditorCanvas = dynamic(
  () => import("@/components/editor/EditorCanvas").then((m) => m.EditorCanvas),
  { ssr: false }
);

export type ProjectPayload = {
  id: string;
  name: string;
  template: {
    id: string;
    name: string;
    slotCount: number;
    config: string;
    slots: { id: string; order: number; headline: string; subhead: string | null; config: string }[];
  };
  screens: { id: string; slotOrder: number; screenshotPath: string }[];
};

type SlotView = {
  order: number;
  headline: string;
  subhead: string | null;
  config: SlotConfig;
  screen?: { id: string; screenshotPath: string };
};

export function ProjectEditor({ project }: { project: ProjectPayload }) {
  const router = useRouter();
  const templateConfig: TemplateConfig = parseTemplateConfig(project.template.config);

  const slotViews: SlotView[] = project.template.slots.map((s) => {
    const screen = project.screens.find((sc) => sc.slotOrder === s.order);
    return {
      order: s.order,
      headline: s.headline,
      subhead: s.subhead,
      config: parseSlotConfig(s.config),
      screen,
    };
  });

  const filledCount = slotViews.filter((s) => s.screen).length;
  const totalCount = slotViews.length;
  const isReady = filledCount === totalCount;

  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const slotFileInput = useRef<HTMLInputElement>(null);
  const replaceTargetSlot = useRef<number | null>(null);

  // ---- Bulk upload (fills next empty slots in order) ----
  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("file", f);
      const res = await fetch(`/api/projects/${project.id}/screens`, {
        method: "POST",
        body: fd,
      });
      setUploading(false);
      if (res.ok) router.refresh();
      else alert("Upload failed");
    },
    [project.id, router]
  );

  // ---- Single-slot replace ----
  const replaceSlot = useCallback(
    async (slotOrder: number, file: File) => {
      setUploading(true);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("slotOrder", String(slotOrder));
      const res = await fetch(`/api/projects/${project.id}/screens`, {
        method: "POST",
        body: fd,
      });
      setUploading(false);
      if (res.ok) router.refresh();
      else alert("Upload failed");
    },
    [project.id, router]
  );

  async function deleteScreen(screenId: string) {
    if (!confirm("Remove this screenshot?")) return;
    const res = await fetch(`/api/screens/${screenId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  async function moveScreen(screenId: string, direction: "up" | "down") {
    const res = await fetch(`/api/screens/${screenId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction }),
    });
    if (res.ok) router.refresh();
  }

  function onDropZoneDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  }

  return (
    <div>
      {/* Top bar with export */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-zinc-500">
          {filledCount} / {totalCount} slots filled
          {isReady && " · ready to export"}
        </span>
        <ExportButton project={project} ready={isReady} />
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDropZoneDrop}
        className={`rounded-lg border-2 border-dashed p-6 text-center mb-6 transition-colors ${
          dragging
            ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
            : "border-zinc-300 dark:border-zinc-700"
        }`}
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Drop screenshots here, or{" "}
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
          . They&apos;ll fill empty slots in upload order.
        </p>
        <p className="text-xs text-zinc-500 mt-1">
          {uploading ? "Uploading…" : `${filledCount} / ${totalCount} slots filled`}
          {isReady && " · ready to export"}
        </p>
      </div>

      {/* Hidden input for single-slot replace */}
      <input
        ref={slotFileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const slot = replaceTargetSlot.current;
          if (file && slot != null) replaceSlot(slot, file);
          e.target.value = "";
        }}
      />

      {/* Slot grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {slotViews.map((s) => (
          <SlotCard
            key={s.order}
            slot={s}
            templateConfig={templateConfig}
            screenshotUrl={
              s.screen ? `/api/uploads/${s.screen.screenshotPath}` : null
            }
            isFirst={s.order === 1}
            isLast={s.order === totalCount}
            onReplace={() => {
              replaceTargetSlot.current = s.order;
              slotFileInput.current?.click();
            }}
            onRemove={() => s.screen && deleteScreen(s.screen.id)}
            onMoveUp={() => s.screen && moveScreen(s.screen.id, "up")}
            onMoveDown={() => s.screen && moveScreen(s.screen.id, "down")}
          />
        ))}
      </div>
    </div>
  );
}

function SlotCard({
  slot,
  templateConfig,
  screenshotUrl,
  isFirst,
  isLast,
  onReplace,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  slot: SlotView;
  templateConfig: TemplateConfig;
  screenshotUrl: string | null;
  isFirst: boolean;
  isLast: boolean;
  onReplace: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 bg-white dark:bg-zinc-900 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-500">
          Slot {slot.order}
        </span>
        {slot.screen && (
          <div className="flex items-center gap-1">
            <button
              onClick={onMoveUp}
              disabled={isFirst}
              title="Move up"
              className="text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30 px-1"
            >
              ↑
            </button>
            <button
              onClick={onMoveDown}
              disabled={isLast}
              title="Move down"
              className="text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30 px-1"
            >
              ↓
            </button>
            <button
              onClick={onRemove}
              title="Remove"
              className="text-xs text-zinc-400 hover:text-red-600 px-1"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      <EditorCanvas
        template={templateConfig}
        slot={slot.config}
        slotNumber={slot.order}
        headline={slot.headline}
        subhead={slot.subhead}
        screenshotUrl={screenshotUrl}
        readOnly
        maxWidthClass="max-w-full"
      />

      <div className="text-xs">
        <div className="font-medium truncate">{slot.headline}</div>
        {slot.subhead && (
          <div className="text-zinc-500 truncate">{slot.subhead}</div>
        )}
      </div>

      <button
        onClick={onReplace}
        className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        {slot.screen ? "Replace screenshot" : "Upload screenshot"}
      </button>
    </div>
  );
}
