import type { Sandbox } from "./types.js";

export const MEMORY_PATH = ".polycode/memory.md";
export const MEMORY_MAX_BYTES = 32_000;
export const MEMORY_MAX_APPEND = 2_000;

export async function readMemory(sandbox: Sandbox): Promise<string> {
  try {
    return await sandbox.readFile(MEMORY_PATH);
  } catch {
    return "";
  }
}

export function formatMemoryAppend(content: string, now = new Date()): string {
  const body = content.trim();
  const date = now.toISOString().slice(0, 10);
  return `\n\n## ${date}\n${body}\n`;
}

export async function appendMemory(
  sandbox: Sandbox,
  content: string,
  now = new Date(),
): Promise<{ bytes: number; path: string }> {
  const note = content.trim();
  if (!note) throw new Error("memory append is empty");
  if (note.length > MEMORY_MAX_APPEND) {
    throw new Error(`memory append too long (${note.length} chars, max ${MEMORY_MAX_APPEND})`);
  }
  const prev = await readMemory(sandbox);
  const next = (prev.trimEnd() + formatMemoryAppend(note, now)).replace(/^\n+/, "");
  if (next.length > MEMORY_MAX_BYTES) {
    throw new Error(`memory file would exceed ${MEMORY_MAX_BYTES} bytes — replace or trim first`);
  }
  await sandbox.writeFile(MEMORY_PATH, next);
  return { bytes: next.length, path: MEMORY_PATH };
}

export async function replaceMemory(
  sandbox: Sandbox,
  content: string,
): Promise<{ bytes: number; path: string }> {
  const next = content.trim();
  if (next.length > MEMORY_MAX_BYTES) {
    throw new Error(`memory file too long (${next.length} chars, max ${MEMORY_MAX_BYTES})`);
  }
  await sandbox.writeFile(MEMORY_PATH, next ? `${next}\n` : "");
  return { bytes: next.length, path: MEMORY_PATH };
}
