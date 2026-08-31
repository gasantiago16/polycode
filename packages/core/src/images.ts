import type { ContentPart, ImagePart, Sandbox } from "./types.js";

export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function isImagePath(rel: string): boolean {
  const base = rel.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXTS.has(base.slice(dot + 1).toLowerCase());
}

export function mediaTypeForImage(rel: string): string {
  const ext = (rel.split(".").pop() ?? "").toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

export async function loadImagePart(rel: string, sandbox: Sandbox): Promise<ImagePart> {
  const path = rel.replace(/\\/g, "/");
  if (!isImagePath(path)) throw new Error(`not an image path: ${path}`);
  if (!sandbox.readFileBytes) throw new Error("sandbox cannot read binary files");
  const bytes = await sandbox.readFileBytes(path);
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`image too large (${bytes.byteLength} bytes, max ${MAX_IMAGE_BYTES})`);
  }
  if (bytes.byteLength === 0) throw new Error(`empty image: ${path}`);
  let data: string;
  if (typeof Buffer !== "undefined") data = Buffer.from(bytes).toString("base64");
  else {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    data = btoa(bin);
  }
  return { type: "image", mediaType: mediaTypeForImage(path), data, path };
}

/** Expand `@path` tokens: images become ImageParts, other files inline as text. */
export async function expandUserMessage(
  text: string,
  sandbox: Sandbox,
): Promise<{ text: string; extras: ContentPart[] }> {
  const re = /@([\w./\\-]+\.[\w]+|[\w./\\-]+\/[\w./\\-]+)/g;
  const hits = [...text.matchAll(re)];
  if (!hits.length) return { text, extras: [] };
  let out = text;
  const extras: ContentPart[] = [];
  for (const m of hits) {
    const rel = m[1].replace(/\\/g, "/");
    if (isImagePath(rel)) {
      try {
        extras.push(await loadImagePart(rel, sandbox));
        out = out.replaceAll(m[0], `[image ${rel}]`);
      } catch {
        /* leave the @mention */
      }
      continue;
    }
    try {
      const body = await sandbox.readFile(rel);
      const clipped = body.length > 40_000 ? body.slice(0, 40_000) + "\n…[truncated]" : body;
      out = out.replaceAll(m[0], `\n<file path="${rel}">\n${clipped}\n</file>\n`);
    } catch {
      /* leave the @mention; the model can still try read() */
    }
  }
  return { text: out, extras };
}
