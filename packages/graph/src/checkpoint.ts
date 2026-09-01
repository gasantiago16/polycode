import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GraphCheckpoint } from "./types.js";

const MAX_BYTES = 256_000;

export function assertThreadId(id: string): string {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id) || id.includes("..")) {
    throw new Error(`invalid graph thread id "${id}"`);
  }
  return id;
}

export class FileCheckpointStore {
  constructor(private dir: string) {}

  private path(id: string): string {
    return join(this.dir, `${assertThreadId(id)}.json`);
  }

  load(id: string): GraphCheckpoint | null {
    const f = this.path(id);
    if (!existsSync(f)) return null;
    try {
      const raw = JSON.parse(readFileSync(f, "utf8")) as GraphCheckpoint;
      if (raw?.version !== 1 || raw.threadId !== id) return null;
      return raw;
    } catch {
      return null;
    }
  }

  save(cp: GraphCheckpoint): void {
    mkdirSync(this.dir, { recursive: true });
    let body = JSON.stringify(cp, null, 2);
    if (body.length > MAX_BYTES) {
      const clipped = {
        ...cp,
        history: cp.history.slice(-8).map((h) => ({
          ...h,
          output: h.output.length > 4_000 ? h.output.slice(0, 4_000) + "\n…[truncated]" : h.output,
        })),
      };
      body = JSON.stringify(clipped, null, 2);
    }
    writeFileSync(this.path(cp.threadId), body, "utf8");
  }

  list(): GraphCheckpoint[] {
    if (!existsSync(this.dir)) return [];
    let names: string[] = [];
    try {
      names = readdirSync(this.dir);
    } catch {
      return [];
    }
    const out: GraphCheckpoint[] = [];
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      const id = n.slice(0, -5);
      const cp = this.load(id);
      if (cp) out.push(cp);
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
