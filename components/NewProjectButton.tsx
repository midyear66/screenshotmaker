"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewProjectButton({ templates }: { templates: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim() || !templateId) return;
    setBusy(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, templateId }),
    });
    setBusy(false);
    if (res.ok) {
      const p = await res.json();
      router.push(`/projects/${p.id}`);
    }
  }

  if (templates.length === 0) {
    return (
      <span className="text-xs text-zinc-500">Create a template first</span>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm px-3 py-1.5 rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90"
      >
        + New Project
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name"
        className="text-sm px-2 py-1 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900"
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <select
        value={templateId}
        onChange={(e) => setTemplateId(e.target.value)}
        className="text-sm px-2 py-1 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900"
      >
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <button
        onClick={submit}
        disabled={busy || !name.trim()}
        className="text-sm px-3 py-1 rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
      >
        Create
      </button>
      <button
        onClick={() => setOpen(false)}
        className="text-sm px-2 py-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        Cancel
      </button>
    </div>
  );
}
