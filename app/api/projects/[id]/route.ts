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
  // UI collapse: Template:Project is 1:1, so deleting a project also deletes
  // the underlying template + its slots + any other projects sharing it
  // (the latter shouldn't exist in practice).
  const project = await prisma.project.findUnique({
    where: { id },
    select: { templateId: true },
  });
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.template.delete({ where: { id: project.templateId } });
  return NextResponse.json({ ok: true });
}
