import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const templates = await prisma.template.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { slots: true, projects: true } } },
  });
  return NextResponse.json(templates);
}

export async function POST(req: Request) {
  const { name, slotCount = 5 } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const template = await prisma.template.create({
    data: {
      name: name.trim(),
      slotCount,
      slots: {
        create: Array.from({ length: slotCount }, (_, i) => ({
          order: i + 1,
          headline: `Slot ${i + 1}`,
        })),
      },
    },
  });
  return NextResponse.json(template, { status: 201 });
}
