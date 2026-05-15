import Link from "next/link";
import { prisma } from "@/lib/db";
import { NewProjectButton } from "@/components/NewProjectButton";
import { DeleteButton } from "@/components/DeleteButton";
import { parseTemplateConfig } from "@/lib/editor-types";

export const dynamic = "force-dynamic";

/**
 * The DB keeps a Template:Project split for historical reasons, but the UI
 * presents one entity per template+project pair. Templates that don't yet
 * have an associated project get auto-promoted on home load so legacy data
 * isn't orphaned after the UI collapse.
 */
async function ensureProjectsForOrphanTemplates() {
  const orphanTemplates = await prisma.template.findMany({
    where: { projects: { none: {} } },
    select: { id: true, name: true },
  });
  if (orphanTemplates.length === 0) return;
  await prisma.$transaction(
    orphanTemplates.map((t) =>
      prisma.project.create({
        data: { name: t.name, templateId: t.id },
      })
    )
  );
}

export default async function Home() {
  await ensureProjectsForOrphanTemplates();

  const projectsRaw = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      template: { select: { id: true, name: true, config: true } },
    },
  });
  // Pull panel count + screenshot pool size out of the canvas-model JSON
  // blob; the legacy `slotCount` column and `Screen` table aren't written by
  // the editor any more.
  const projects = projectsRaw.map((p) => {
    const cfg = parseTemplateConfig(p.template.config);
    return {
      id: p.id,
      template: { id: p.template.id, name: p.template.name },
      panelCount: cfg.panelCount,
      screenshotCount: cfg.screenshots.length,
    };
  });

  return (
    <main className="flex-1 w-full max-w-5xl mx-auto px-6 py-10">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">ScreenshotMaker</h1>
        <p className="text-zinc-500 mt-1">
          Design a screenshot set once, drop in new screenshots per release, export App Store–ready PNGs.
        </p>
      </header>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-medium">Projects</h2>
          <NewProjectButton />
        </div>
        {projects.length === 0 ? (
          <p className="text-sm text-zinc-500 border border-dashed border-zinc-300 dark:border-zinc-800 rounded-lg p-6 text-center">
            No projects yet. Click <span className="font-medium">+ New Project</span> to create one.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <li
                key={p.id}
                className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 bg-white dark:bg-zinc-900 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/projects/${p.id}`}
                    className="font-medium hover:underline truncate"
                  >
                    {p.template.name}
                  </Link>
                  <DeleteButton kind="project" id={p.id} name={p.template.name} />
                </div>
                <div className="text-xs text-zinc-500">
                  {p.panelCount} panel{p.panelCount === 1 ? "" : "s"} ·{" "}
                  {p.screenshotCount} screenshot
                  {p.screenshotCount === 1 ? "" : "s"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
