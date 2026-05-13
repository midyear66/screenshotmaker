import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const data: { headline?: string; subhead?: string | null; config?: string } = {};
  if (typeof body.headline === "string") data.headline = body.headline;
  if (typeof body.subhead === "string" || body.subhead === null) data.subhead = body.subhead;
  if (body.config !== undefined) data.config = JSON.stringify(body.config);
  const slot = await prisma.slot.update({ where: { id }, data });
  return NextResponse.json(slot);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const slot = await prisma.slot.findUnique({ where: { id } });
  if (!slot) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.$transaction([
    prisma.slot.delete({ where: { id } }),
    prisma.slot.updateMany({
      where: { templateId: slot.templateId, order: { gt: slot.order } },
      data: { order: { decrement: 1 } },
    }),
    prisma.template.update({
      where: { id: slot.templateId },
      data: { slotCount: { decrement: 1 } },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
