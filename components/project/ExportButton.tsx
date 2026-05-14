"use client";

import JSZip from "jszip";
import { useState } from "react";
import { parseTemplateConfig } from "@/lib/editor-types";
import { DEVICE_SIZES, renderPanelToBlob } from "@/lib/render";

export type ProjectPayload = {
  id: string;
  name: string;
  template: {
    id: string;
    name: string;
    /** Legacy field kept for ExportButton's old type; unused in panel-mode. */
    slotCount: number;
    config: string;
    /** Legacy; the new model reads everything from config. */
    slots: { id: string; order: number; config: string }[];
  };
  /** Legacy; the new model reads screenshots from config.screenshots. */
  screens: { id: string; slotOrder: number; screenshotPath: string }[];
};

function sanitizeFilename(name: string) {
  return name.replace(/[^a-z0-9_\-]+/gi, "-").replace(/^-+|-+$/g, "") || "export";
}

export function ExportButton({
  project,
  ready,
}: {
  project: ProjectPayload;
  ready: boolean;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function exportAll() {
    setBusy(true);
    try {
      const templateConfig = parseTemplateConfig(project.template.config);
      const panelCount = Math.max(1, templateConfig.panelCount);
      const total = panelCount * DEVICE_SIZES.length;
      let done = 0;
      const zip = new JSZip();
      const root = zip.folder(sanitizeFilename(project.name))!;

      for (const device of DEVICE_SIZES) {
        const folder = root.folder(device.folder)!;
        for (let panelIndex = 0; panelIndex < panelCount; panelIndex++) {
          setStatus(
            `Rendering ${device.label} · panel ${panelIndex + 1} (${done + 1}/${total})`
          );
          const blob = await renderPanelToBlob({
            template: templateConfig,
            panelIndex,
            device,
          });
          const name = `${String(panelIndex + 1).padStart(2, "0")}.png`;
          folder.file(name, blob);
          done++;
        }
      }

      setStatus("Bundling ZIP…");
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFilename(project.name)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatus(`Exported ${total} PNGs`);
    } catch (err) {
      console.error(err);
      setStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {status && (
        <span className="text-xs text-zinc-500" aria-live="polite">
          {status}
        </span>
      )}
      <button
        onClick={exportAll}
        disabled={!ready || busy}
        className="text-sm px-4 py-2 rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-40 hover:opacity-90"
        title={!ready ? "Fill every panel first" : "Export App Store–ready PNGs"}
      >
        {busy ? "Exporting…" : "Export ZIP"}
      </button>
    </div>
  );
}
