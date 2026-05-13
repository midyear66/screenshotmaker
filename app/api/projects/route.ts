import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      template: { select: { id: true, name: true, slotCount: true } },
      _count: { select: { screens: true } },
    },
  });
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const { name, templateId } = await req.json();
  if (!name?.trim() || !templateId) {
    return NextResponse.json(
      { error: "name and templateId required" },
      { status: 400 }
    );
  }
  const project = await prisma.project.create({
    data: { name: name.trim(), templateId },
  });
  return NextResponse.json(project, { status: 201 });
}
