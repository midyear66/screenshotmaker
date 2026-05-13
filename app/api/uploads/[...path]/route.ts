import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { safeUploadPath } from "@/lib/uploads";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: parts } = await params;
  const rel = parts.join("/");

  let abs: string;
  try {
    abs = safeUploadPath(rel);
  } catch {
    return NextResponse.json({ error: "bad path" }, { status: 400 });
  }

  try {
    const st = await stat(abs);
    if (!st.isFile()) return NextResponse.json({ error: "not found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  const data = await readFile(abs);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
