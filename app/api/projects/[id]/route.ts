import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      template: { include: { slots: { orderBy: { order: "asc" } } } },
      screens: { orderBy: { slotOrder: "asc" } },
    },
  });
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(project);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // UI collapse: Template:Project is 1:1 in practice. Project.template has no
  // onDelete: Cascade, so we must delete the Project first (its Screens
  // cascade via the Project relation), then the Template (its Slots cascade).
  // If another Project still references the same Template, leave the Template
  // intact.
  const project = await prisma.project.findUnique({
    where: { id },
    select: { templateId: true },
  });
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.project.delete({ where: { id } });
  const remaining = await prisma.project.count({
    where: { templateId: project.templateId },
  });
  if (remaining === 0) {
    await prisma.template.delete({ where: { id: project.templateId } });
  }
  return NextResponse.json({ ok: true });
}
