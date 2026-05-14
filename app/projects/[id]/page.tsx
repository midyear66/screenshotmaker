import Link from "next/link";
import { notFound } from "next/navigation";
import { TemplateEditor } from "@/components/editor/TemplateEditor";
import { migrateProjectIfNeeded } from "@/lib/projectMigration";
import { parseTemplateConfig } from "@/lib/editor-types";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let project;
  try {
    // One-shot migration: if the project's template still uses the old per-slot
    // shape, transform to the continuous-canvas model and persist.
    project = await migrateProjectIfNeeded(id);
  } catch {
    notFound();
  }

  const config = parseTemplateConfig(project.template.config);

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
          {config.panelCount} panel{config.panelCount === 1 ? "" : "s"}
        </span>
      </div>
      <TemplateEditor
        template={{
          id: project.template.id,
          name: project.template.name,
          config: project.template.config,
        }}
        project={{
          projectId: project.id,
          projectName: project.name,
        }}
      />
    </main>
  );
}
