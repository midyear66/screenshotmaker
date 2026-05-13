import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DEFAULT_SLOT_CONFIG, defaultHeadlineElement } from "@/lib/editor-types";

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

/**
 * Create a project. The DB still keeps a Template:Project split but the UI
 * presents them as one entity — so if no `templateId` is supplied we
 * silently create a matching template + initial slot first. Existing
 * `{ name, templateId }` callers still work.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const name: string | undefined = body.name;
  if (!name?.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  let templateId: string | undefined = body.templateId;

  if (!templateId) {
    const slotCount: number = Math.max(1, Math.min(10, body.slotCount ?? 5));
    const template = await prisma.template.create({
      data: {
        name: name.trim(),
        slotCount,
        slots: {
          create: Array.from({ length: slotCount }, (_, i) => ({
            order: i + 1,
            headline: "",
            config: JSON.stringify({
              ...DEFAULT_SLOT_CONFIG,
              elements: [defaultHeadlineElement(`Slot ${i + 1}`)],
            }),
          })),
        },
      },
    });
    templateId = template.id;
  }

  const project = await prisma.project.create({
    data: { name: name.trim(), templateId },
  });
  return NextResponse.json(project, { status: 201 });
}
