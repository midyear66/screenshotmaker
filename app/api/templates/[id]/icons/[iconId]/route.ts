import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteUpload } from "@/lib/uploads";
import { parseTemplateConfig } from "@/lib/editor-types";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; iconId: string }> }
) {
  const { id: templateId, iconId } = await params;
  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) {
    return NextResponse.json({ error: "template not found" }, { status: 404 });
  }

  const config = parseTemplateConfig(template.config);
  const icon = config.customIcons.find((i) => i.id === iconId);
  if (!icon) {
    return NextResponse.json({ error: "icon not found" }, { status: 404 });
  }

  await deleteUpload(icon.path);
  const newConfig = {
    ...config,
    customIcons: config.customIcons.filter((i) => i.id !== iconId),
  };
  await prisma.template.update({
    where: { id: templateId },
    data: { config: JSON.stringify(newConfig) },
  });

  return NextResponse.json({ ok: true });
}
