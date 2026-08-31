import type { Sandbox } from "./types.js";
import { MEMORY_PATH, readMemory } from "./memory.js";

/**
 * Builds the "what world am I in" preamble that gets appended to the system
 * prompt, so the agent starts grounded the way Claude Code does instead of
 * groping blind on turn one. Everything goes through the Sandbox contract, so
 * it works the same for the local and docker backends.
 */
export interface ContextOptions {
  /** Absolute working directory, shown verbatim to the model. */
  cwd: string;
  sandbox: Sandbox;
  /** Files read verbatim as project conventions; first one that exists wins. */
  conventionFiles?: string[];
  /** Max number of file paths to include in the directory snapshot. */
  maxTreeEntries?: number;
  /** Max bytes of a convention file to inline before truncating. */
  maxConventionBytes?: number;
  /** Override platform string (defaults to the host process). */
  platform?: string;
  /** Override the clock (mainly for tests). */
  now?: Date;
}

const DEFAULT_CONVENTIONS = [
  "CLAUDE.md",
  "AGENTS.md",
  "POLYCODE.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
];

export async function gatherContext(opts: ContextOptions): Promise<string> {
  const {
    cwd,
    sandbox,
    conventionFiles = DEFAULT_CONVENTIONS,
    maxTreeEntries = 200,
    maxConventionBytes = 8_000,
    now = new Date(),
  } = opts;
  const platform = opts.platform ?? (globalThis as any).process?.platform ?? "unknown";

  const sections: string[] = [];

  // --- environment ---
  const git = await gitInfo(sandbox);
  const env = [
    `Working directory: ${cwd}`,
    `Platform: ${platform}`,
    `Date: ${now.toISOString().slice(0, 10)}`,
    `Git repo: ${git.isRepo ? "yes" : "no"}${git.branch ? ` (branch ${git.branch})` : ""}`,
  ].join("\n");
  sections.push(`<environment>\n${env}\n</environment>`);

  // --- git status (short, capped) ---
  if (git.isRepo && git.status) {
    sections.push(`<git_status>\n${git.status}\n</git_status>`);
  }

  // --- directory snapshot ---
  const tree = await dirSnapshot(sandbox, maxTreeEntries);
  if (tree) {
    sections.push(`<directory truncated="${tree.truncated}">\n${tree.text}\n</directory>`);
  }

  // --- project conventions (first match wins) ---
  for (const name of conventionFiles) {
    let raw: string;
    try {
      raw = await sandbox.readFile(name);
    } catch {
      continue; // not present / unreadable
    }
    if (!raw || !raw.trim()) continue;
    const body =
      raw.length > maxConventionBytes ? raw.slice(0, maxConventionBytes) + "\n…[truncated]" : raw;
    sections.push(`<project_conventions source="${name}">\n${body.trim()}\n</project_conventions>`);
    break;
  }

  // --- curated project memory (agent-written, not a transcript) ---
  const mem = await readMemory(sandbox);
  if (mem.trim()) {
    const body =
      mem.length > maxConventionBytes ? mem.slice(0, maxConventionBytes) + "\n…[truncated]" : mem;
    sections.push(`<memory path="${MEMORY_PATH}">\n${body.trim()}\n</memory>`);
  }

  return sections.join("\n\n");
}

interface GitInfo {
  isRepo: boolean;
  branch?: string;
  status?: string;
}

async function gitInfo(sandbox: Sandbox): Promise<GitInfo> {
  const probe = await sandbox.exec("git rev-parse --is-inside-work-tree");
  if (probe.code !== 0 || probe.stdout.trim() !== "true") return { isRepo: false };

  const branch = (await sandbox.exec("git rev-parse --abbrev-ref HEAD")).stdout.trim() || undefined;

  const st = await sandbox.exec("git status --porcelain=v1");
  let status = st.code === 0 ? st.stdout.trim() : "";
  const lines = status ? status.split("\n") : [];
  if (lines.length > 40) {
    status = lines.slice(0, 40).join("\n") + `\n… and ${lines.length - 40} more changed paths`;
  }
  return { isRepo: true, branch, status: status || "(clean)" };
}

async function dirSnapshot(
  sandbox: Sandbox,
  max: number,
): Promise<{ text: string; truncated: boolean } | null> {
  const HARD_CAP = 5_000;
  const files: string[] = [];
  let overflow = false;
  try {
    for await (const f of sandbox.walk()) {
      files.push(f);
      if (files.length >= HARD_CAP) {
        overflow = true;
        break;
      }
    }
  } catch {
    return null;
  }
  if (!files.length) return null;
  files.sort();
  const truncated = overflow || files.length > max;
  return { text: files.slice(0, max).join("\n"), truncated };
}
