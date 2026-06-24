import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { randomBytes } from "node:crypto";
import type { CanonicalMessage } from "@polycode/core";

/**
 * Session transcripts: the conversation (canonical messages) is persisted to
 * `<cwd>/.polycode/sessions/<id>.json` after each turn, so it can be resumed
 * (`--continue` / `--resume <id>`) and inspected (`--sessions`). This is also
 * polycode's first on-disk log surface. `.polycode/` is gitignored and ignored
 * by the sandbox walk, so transcripts never pollute search/context.
 */
const VERSION = 1;

export interface SessionMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  model: string;
  title: string;
}

export interface SessionData extends SessionMeta {
  messages: CanonicalMessage[];
}

export class SessionStore {
  constructor(private cwd: string) {}

  private dir(): string {
    return join(this.cwd, ".polycode", "sessions");
  }
  private file(id: string): string {
    // `id` can come from --resume <argv>; never let it escape the store dir.
    if (!/^[A-Za-z0-9._-]+$/.test(id) || id.includes("..")) {
      throw new Error(`invalid session id: ${id}`);
    }
    const f = join(this.dir(), `${id}.json`);
    if (relative(this.dir(), f).startsWith("..")) {
      throw new Error(`session id escapes store: ${id}`);
    }
    return f;
  }

  /** A fresh, chronologically-sortable session id. */
  newId(now: Date): string {
    const ts = now.toISOString().replace(/[:.]/g, "-");
    return `${ts}-${randomBytes(3).toString("hex")}`;
  }

  save(data: SessionData): void {
    const dir = this.dir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const f = this.file(data.id);
    // Write-then-rename so a crash mid-write can't leave a truncated transcript.
    const tmp = `${f}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: VERSION, ...data }, null, 2), "utf8");
    renameSync(tmp, f);
  }

  load(id: string): SessionData | null {
    let f: string;
    try {
      f = this.file(id); // rejects path-traversal ids
    } catch {
      return null;
    }
    if (!existsSync(f)) return null;
    try {
      const j = JSON.parse(readFileSync(f, "utf8"));
      if (!Array.isArray(j.messages)) return null;
      return j as SessionData;
    } catch {
      return null;
    }
  }

  /** Session metadata, newest first. */
  list(): SessionMeta[] {
    const dir = this.dir();
    if (!existsSync(dir)) return [];
    const metas: SessionMeta[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const d = this.load(name.slice(0, -5));
      if (d) {
        metas.push({
          id: d.id,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          cwd: d.cwd,
          model: d.model,
          title: d.title,
        });
      }
    }
    metas.sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
      return a.id < b.id ? 1 : -1; // deterministic tiebreak within the same ms
    });
    return metas;
  }

  latest(): SessionData | null {
    const metas = this.list();
    return metas.length ? this.load(metas[0].id) : null;
  }
}

/** Short title from the first user message. */
export function deriveTitle(messages: CanonicalMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const text =
    firstUser?.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ") ?? "";
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? t.slice(0, 60) + "…" : t || "(untitled)";
}
