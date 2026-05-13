import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./data/uploads";

export function uploadRoot(): string {
  return path.resolve(UPLOAD_DIR);
}

/**
 * Resolve a relative path under the upload root, refusing anything that
 * escapes via "..". Returns the absolute path or throws.
 */
export function safeUploadPath(rel: string): string {
  const root = uploadRoot();
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("path traversal blocked");
  }
  return abs;
}

export async function ensureDir(rel: string): Promise<string> {
  const abs = safeUploadPath(rel);
  await mkdir(abs, { recursive: true });
  return abs;
}

export async function writeUpload(rel: string, data: Buffer): Promise<void> {
  const abs = safeUploadPath(rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
}

export async function deleteUpload(rel: string): Promise<void> {
  try {
    const abs = safeUploadPath(rel);
    await unlink(abs);
  } catch {
    // already gone — fine
  }
}

export function extFromMime(mime: string | null | undefined): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return "png";
  }
}
