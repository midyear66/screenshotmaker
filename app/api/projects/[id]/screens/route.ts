import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { writeUpload, deleteUpload, extFromMime } from "@/lib/uploads";

/**
 * Upload one or more screenshots into a project.
 *
 * Each file is assigned to the next empty slot (slotOrder), in upload order.
 * If `slotOrder` is provided in the form, that single file replaces (or fills)
 * exactly that slot, regardless of other empty slots.
 *
 * Files are written to <UPLOAD_DIR>/<projectId>/<screenId>.<ext> and the
 * relative path is stored in Screen.screenshotPath.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      template: { select: { slotCount: true } },
      screens: true,
    },
  });
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "no files" }, { status: 400 });
  }

  // Single-slot replace mode
  const slotOrderRaw = form.get("slotOrder");
  if (typeof slotOrderRaw === "string" && slotOrderRaw.length > 0) {
    const slotOrder = parseInt(slotOrderRaw, 10);
    if (!Number.isFinite(slotOrder) || slotOrder < 1 || slotOrder > project.template.slotCount) {
      return NextResponse.json({ error: "invalid slotOrder" }, { status: 400 });
    }
    if (files.length !== 1) {
      return NextResponse.json(
        { error: "exactly one file allowed when slotOrder is set" },
        { status: 400 }
      );
    }
    const created = await storeScreenshot(projectId, slotOrder, files[0]);
    return NextResponse.json([created], { status: 201 });
  }

  // Bulk mode: fill next empty slots in order
  const taken = new Set(project.screens.map((s) => s.slotOrder));
  const emptySlots: number[] = [];
  for (let i = 1; i <= project.template.slotCount; i++) {
    if (!taken.has(i)) emptySlots.push(i);
  }

  const toUpload = files.slice(0, emptySlots.length);
  const results = [];
  for (let i = 0; i < toUpload.length; i++) {
    results.push(await storeScreenshot(projectId, emptySlots[i], toUpload[i]));
  }

  return NextResponse.json(results, { status: 201 });
}

async function storeScreenshot(projectId: string, slotOrder: number, file: File) {
  const screenId = randomUUID();
  const ext = extFromMime(file.type);
  const rel = `${projectId}/${screenId}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  await writeUpload(rel, buf);

  // Remove any existing screen at this slot, deleting its file too
  const existing = await prisma.screen.findUnique({
    where: { projectId_slotOrder: { projectId, slotOrder } },
  });
  if (existing) {
    await prisma.screen.delete({ where: { id: existing.id } });
    await deleteUpload(existing.screenshotPath);
  }

  const screen = await prisma.screen.create({
    data: {
      id: screenId,
      projectId,
      slotOrder,
      screenshotPath: rel,
    },
  });
  await prisma.project.update({
    where: { id: projectId },
    data: { updatedAt: new Date() },
  });
  return screen;
}
