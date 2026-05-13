import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { TemplateEditor } from "@/components/editor/TemplateEditor";

export const dynamic = "force-dynamic";

export default async function TemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const template = await prisma.template.findUnique({
    where: { id },
    include: { slots: { orderBy: { order: "asc" } } },
  });
  if (!template) notFound();

  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-4">
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← Back
        </Link>
        <h1 className="text-lg font-semibold">{template.name}</h1>
        <span className="text-xs text-zinc-500">
          {template.slotCount} slot{template.slotCount === 1 ? "" : "s"}
        </span>
      </div>
      <TemplateEditor
        template={{
          id: template.id,
          name: template.name,
          slotCount: template.slotCount,
          config: template.config,
          slots: template.slots.map((s) => ({
            id: s.id,
            order: s.order,
            config: s.config,
          })),
        }}
      />
    </main>
  );
}
