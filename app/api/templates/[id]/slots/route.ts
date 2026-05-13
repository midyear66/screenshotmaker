import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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

  const [, slot] = await prisma.$transaction([
    prisma.template.update({
      where: { id },
      data: { slotCount: { increment: 1 } },
    }),
    prisma.slot.create({
      data: {
        templateId: id,
        order: nextOrder,
        headline: `Slot ${nextOrder}`,
      },
    }),
  ]);

  return NextResponse.json(slot, { status: 201 });
}
