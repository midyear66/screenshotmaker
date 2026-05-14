import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { writeUpload, extFromMime } from "@/lib/uploads";
import { parseTemplateConfig, ScreenshotAsset } from "@/lib/editor-types";

/**
 * Upload a screenshot to the project's pool. The file is stored under
 * `data/uploads/projects/<projectId>/screenshots/<screenshotId>.<ext>` and
 * appended to `template.config.screenshots`. DeviceElements reference
 * screenshots by id, so a single upload can be attached to multiple devices.
 *
 * NOTE: pool lives on the template (1:1 with project via the UI collapse),
 * but the file path is namespaced by projectId for clarity in the volume.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { template: true },
  });
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }

  const screenshotId = randomUUID();
  const ext = extFromMime(file.type);
  const rel = `projects/${projectId}/screenshots/${screenshotId}-${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  await writeUpload(rel, buf);

  const config = parseTemplateConfig(project.template.config);
  const asset: ScreenshotAsset = {
    id: screenshotId,
    path: rel,
    uploadedAt: new Date().toISOString(),
  };
  const newConfig = { ...config, screenshots: [...config.screenshots, asset] };
  await prisma.template.update({
    where: { id: project.template.id },
    data: { config: JSON.stringify(newConfig) },
  });

  return NextResponse.json(asset, { status: 201 });
}
