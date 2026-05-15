"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteButton({
  kind,
  id,
  name,
}: {
  kind: "template" | "project";
  id: string;
  name: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!confirm(`Delete ${kind} "${name}"? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/${kind}s/${id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      router.refresh();
    } else {
      alert(`Delete failed (${res.status})`);
    }
  }

  return (
    <button
      onClick={del}
      disabled={busy}
      title={`Delete ${kind}`}
      className="text-xs text-zinc-400 hover:text-red-600 disabled:opacity-50 shrink-0"
    >
      ✕
    </button>
  );
}
