"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewProjectButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slotCount, setSlotCount] = useState(5);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, slotCount }),
    });
    setBusy(false);
    if (res.ok) {
      const p = await res.json();
      router.push(`/projects/${p.id}`);
    }
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
      <input
        type="number"
        min={1}
        max={10}
        value={slotCount}
        onChange={(e) => setSlotCount(parseInt(e.target.value) || 1)}
        title="Slot count"
        className="text-sm w-16 px-2 py-1 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900"
      />
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
