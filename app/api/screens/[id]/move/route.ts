import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Swap this screen's slotOrder with the screen at the neighbouring slot.
 * If the neighbour slot is empty, just move this one into it.
 * body: { direction: "up" | "down" }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { direction } = await req.json();
  if (direction !== "up" && direction !== "down") {
    return NextResponse.json({ error: "invalid direction" }, { status: 400 });
  }

  const screen = await prisma.screen.findUnique({ where: { id } });
  if (!screen) return NextResponse.json({ error: "not found" }, { status: 404 });

  const project = await prisma.project.findUnique({
    where: { id: screen.projectId },
    include: { template: { select: { slotCount: true } } },
  });
  if (!project) return NextResponse.json({ error: "project gone" }, { status: 404 });

  const targetOrder =
    direction === "up" ? screen.slotOrder - 1 : screen.slotOrder + 1;
  if (targetOrder < 1 || targetOrder > project.template.slotCount) {
    return NextResponse.json({ error: "out of range" }, { status: 400 });
  }

  const neighbour = await prisma.screen.findUnique({
    where: {
      projectId_slotOrder: { projectId: screen.projectId, slotOrder: targetOrder },
    },
  });

  if (neighbour) {
    // Swap via a temporary out-of-range slot to dodge the unique constraint.
    // SQLite checks uniqueness per statement, so we need an intermediate value.
    const PARK = -screen.slotOrder - 1000;
    await prisma.$transaction([
      prisma.screen.update({ where: { id: neighbour.id }, data: { slotOrder: PARK } }),
      prisma.screen.update({ where: { id: screen.id }, data: { slotOrder: targetOrder } }),
      prisma.screen.update({ where: { id: neighbour.id }, data: { slotOrder: screen.slotOrder } }),
    ]);
  } else {
    await prisma.screen.update({
      where: { id: screen.id },
      data: { slotOrder: targetOrder },
    });
  }
  return NextResponse.json({ ok: true });
}
