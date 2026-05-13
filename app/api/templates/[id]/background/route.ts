import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteUpload, extFromMime, writeUpload } from "@/lib/uploads";
import { parseTemplateConfig } from "@/lib/editor-types";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await prisma.template.findUnique({ where: { id } });
  if (!template) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }

  const config = parseTemplateConfig(template.config);

  // Remove any prior background file before writing the new one
  if (config.bgImagePath) {
    await deleteUpload(config.bgImagePath);
  }

  const ext = extFromMime(file.type);
  const rel = `templates/${id}/bg.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  await writeUpload(rel, buf);

  const newConfig = { ...config, bgImagePath: rel };
  await prisma.template.update({
    where: { id },
    data: { config: JSON.stringify(newConfig) },
  });

  return NextResponse.json({ bgImagePath: rel }, { status: 201 });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await prisma.template.findUnique({ where: { id } });
  if (!template) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const config = parseTemplateConfig(template.config);
  if (config.bgImagePath) {
    await deleteUpload(config.bgImagePath);
  }

  const { bgImagePath: _drop, ...rest } = config;
  void _drop;
  await prisma.template.update({
    where: { id },
    data: { config: JSON.stringify(rest) },
  });

  return NextResponse.json({ ok: true });
}
