import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Legacy URL. Templates are no longer surface area in the UI — they're a
 * 1:1 sidecar of a Project. Redirect to the matching project page (creating
 * one if the template was orphaned, so the URL keeps working).
 */
export default async function TemplateLegacyRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const template = await prisma.template.findUnique({
    where: { id },
    include: { projects: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!template) notFound();

  let projectId = template.projects[0]?.id;
  if (!projectId) {
    const project = await prisma.project.create({
      data: { name: template.name, templateId: template.id },
    });
    projectId = project.id;
  }

  redirect(`/projects/${projectId}`);
}
