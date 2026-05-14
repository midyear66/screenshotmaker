import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteUpload } from "@/lib/uploads";
import {
  CanvasElement,
  parseTemplateConfig,
} from "@/lib/editor-types";

/**
 * Remove a screenshot from the pool. Deletes the file and nulls out any
 * DeviceElement.screenshotId references so devices fall back to the
 * placeholder rather than pointing at a missing file.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; screenshotId: string }> }
) {
  const { id: projectId, screenshotId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { template: true },
  });
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const config = parseTemplateConfig(project.template.config);
  const asset = config.screenshots.find((s) => s.id === screenshotId);
  if (!asset) {
    return NextResponse.json({ error: "screenshot not found" }, { status: 404 });
  }

  await deleteUpload(asset.path);

  const newScreenshots = config.screenshots.filter((s) => s.id !== screenshotId);
  const newElements: CanvasElement[] = config.elements.map((el) => {
    if (el.type === "device" && el.screenshotId === screenshotId) {
      const { screenshotId: _drop, ...rest } = el;
      void _drop;
      return rest;
    }
    return el;
  });

  await prisma.template.update({
    where: { id: project.template.id },
    data: {
      config: JSON.stringify({
        ...config,
        screenshots: newScreenshots,
        elements: newElements,
      }),
    },
  });

  return NextResponse.json({ ok: true });
}
