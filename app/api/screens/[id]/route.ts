import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteUpload } from "@/lib/uploads";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const screen = await prisma.screen.findUnique({ where: { id } });
  if (!screen) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.screen.delete({ where: { id } });
  await deleteUpload(screen.screenshotPath);
  return NextResponse.json({ ok: true });
}
