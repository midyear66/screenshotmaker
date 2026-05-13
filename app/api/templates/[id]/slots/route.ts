import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DEFAULT_SLOT_CONFIG, defaultHeadlineElement } from "@/lib/editor-types";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await prisma.template.findUnique({
    where: { id },
    include: { slots: { orderBy: { order: "desc" }, take: 1 } },
  });
  if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });

  const nextOrder = (template.slots[0]?.order ?? 0) + 1;

  // New slots start with a single headline-style text element so the canvas
  // isn't empty. Users can add/remove/customise from there.
  const initialConfig = {
    ...DEFAULT_SLOT_CONFIG,
    elements: [defaultHeadlineElement(`Slot ${nextOrder}`)],
  };

  const [, slot] = await prisma.$transaction([
    prisma.template.update({
      where: { id },
      data: { slotCount: { increment: 1 } },
    }),
    prisma.slot.create({
      data: {
        templateId: id,
        order: nextOrder,
        // headline column kept in DB schema for now but no longer used by the editor.
        headline: "",
        config: JSON.stringify(initialConfig),
      },
    }),
  ]);

  return NextResponse.json(slot, { status: 201 });
}
