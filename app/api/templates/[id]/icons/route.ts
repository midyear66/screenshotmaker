import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { writeUpload } from "@/lib/uploads";
import { parseTemplateConfig } from "@/lib/editor-types";

/**
 * Upload a custom SVG icon to a template. Only `image/svg+xml` files are
 * accepted; we don't transform the SVG, just store it and reference it from
 * `template.config.customIcons[]`.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: templateId } = await params;
  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) {
    return NextResponse.json({ error: "template not found" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }

  // Allow file.type to be empty (some browsers omit it for SVG) — fall back
  // to the .svg extension check.
  const lower = (file.name || "").toLowerCase();
  if (file.type && file.type !== "image/svg+xml" && !lower.endsWith(".svg")) {
    return NextResponse.json({ error: "only SVG files are accepted" }, { status: 400 });
  }

  const iconId = randomUUID();
  const rel = `templates/${templateId}/icons/${iconId}.svg`;
  const buf = Buffer.from(await file.arrayBuffer());
  await writeUpload(rel, buf);

  const config = parseTemplateConfig(template.config);
  const newIcon = {
    id: iconId,
    name: file.name || "icon.svg",
    path: rel,
  };
  const newConfig = {
    ...config,
    customIcons: [...config.customIcons, newIcon],
  };
  await prisma.template.update({
    where: { id: templateId },
    data: { config: JSON.stringify(newConfig) },
  });

  return NextResponse.json(newIcon, { status: 201 });
}
