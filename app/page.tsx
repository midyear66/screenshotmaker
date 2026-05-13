import Link from "next/link";
import { prisma } from "@/lib/db";
import { NewProjectButton } from "@/components/NewProjectButton";
import { NewTemplateButton } from "@/components/NewTemplateButton";
import { DeleteButton } from "@/components/DeleteButton";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [projects, templates] = await Promise.all([
    prisma.project.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        template: { select: { id: true, name: true, slotCount: true } },
        _count: { select: { screens: true } },
      },
    }),
    prisma.template.findMany({
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { slots: true, projects: true } } },
    }),
  ]);

  return (
    <main className="flex-1 w-full max-w-5xl mx-auto px-6 py-10">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">ScreenshotMaker</h1>
        <p className="text-zinc-500 mt-1">
          Drop new screenshots into a template, export App Store–ready PNGs.
        </p>
      </header>

      <section className="mb-12">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-medium">Templates</h2>
          <NewTemplateButton />
        </div>
        {templates.length === 0 ? (
          <p className="text-sm text-zinc-500 border border-dashed border-zinc-300 dark:border-zinc-800 rounded-lg p-6 text-center">
            No templates yet. Create one to define your layout, copy, and styling.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <li
                key={t.id}
                className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 bg-white dark:bg-zinc-900 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/templates/${t.id}`}
                    className="font-medium hover:underline truncate"
                  >
                    {t.name}
                  </Link>
                  <DeleteButton kind="template" id={t.id} name={t.name} />
                </div>
                <div className="text-xs text-zinc-500">
                  {t.slotCount} slots · {t._count.projects} project(s)
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-medium">Projects</h2>
          <NewProjectButton templates={templates.map((t) => ({ id: t.id, name: t.name }))} />
        </div>
        {projects.length === 0 ? (
          <p className="text-sm text-zinc-500 border border-dashed border-zinc-300 dark:border-zinc-800 rounded-lg p-6 text-center">
            No projects yet. Create a template first, then start a project to drop screenshots in.
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
                    {p.name}
                  </Link>
                  <DeleteButton kind="project" id={p.id} name={p.name} />
                </div>
                <div className="text-xs text-zinc-500">
                  Template: {p.template.name} · {p._count.screens}/{p.template.slotCount} screens
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
