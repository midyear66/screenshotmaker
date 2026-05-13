import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { TemplateEditor } from "@/components/editor/TemplateEditor";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      template: { include: { slots: { orderBy: { order: "asc" } } } },
      screens: { orderBy: { slotOrder: "asc" } },
    },
  });
  if (!project) notFound();

  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-4">
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← Back
        </Link>
        <h1 className="text-lg font-semibold">{project.template.name}</h1>
        <span className="text-xs text-zinc-500 tabular-nums">
          {project.screens.length} / {project.template.slotCount} screens
        </span>
      </div>
      <TemplateEditor
        template={{
          id: project.template.id,
          name: project.template.name,
          slotCount: project.template.slotCount,
          config: project.template.config,
          slots: project.template.slots.map((s) => ({
            id: s.id,
            order: s.order,
            config: s.config,
          })),
        }}
        project={{
          projectId: project.id,
          projectName: project.name,
          screens: project.screens.map((s) => ({
            id: s.id,
            slotOrder: s.slotOrder,
            screenshotPath: s.screenshotPath,
          })),
        }}
      />
    </main>
  );
}
