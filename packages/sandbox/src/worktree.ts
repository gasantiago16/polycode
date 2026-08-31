import { mkdirSync, existsSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { childProcessEnv } from "@polycode/core";

const execFile = promisify(execFileCb);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", cwd, ...args], {
    timeout: 60_000,
    env: childProcessEnv(),
  });
  return stdout.trim();
}

/** Detached worktree under `<repo>/.polycode/worktrees/<id>`. Not merged back. */
export async function addGitWorktree(projectPath: string): Promise<string> {
  await git(projectPath, ["rev-parse", "--is-inside-work-tree"]);
  const id = randomBytes(4).toString("hex");
  const dir = join(projectPath, ".polycode", "worktrees");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, id);
  await git(projectPath, ["worktree", "add", "--detach", path]);
  return path;
}

export async function removeGitWorktree(projectPath: string, path: string): Promise<void> {
  try {
    await git(projectPath, ["worktree", "remove", "--force", path]);
  } catch {
    /* leftover dir is inspectable */
  }
}

export function worktreeRoot(projectPath: string): string {
  return resolve(join(projectPath, ".polycode", "worktrees"));
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function listGitWorktrees(projectPath: string): string[] {
  const dir = worktreeRoot(projectPath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((n) => join(dir, n))
    .filter((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
}

/** Resolve a worktree id, relative path, or absolute path under `.polycode/worktrees/`. */
export function resolveGitWorktree(projectPath: string, idOrPath: string): string | null {
  const base = worktreeRoot(projectPath);
  const trimmed = idOrPath.trim();
  if (!trimmed) return null;
  const candidates = [resolve(trimmed), resolve(projectPath, trimmed), resolve(base, trimmed)];
  for (const c of candidates) {
    if (!isInside(base, c) || !existsSync(c)) continue;
    try {
      if (statSync(c).isDirectory()) return c;
    } catch {
      /* skip */
    }
  }
  return null;
}

/** Copy changed + untracked files from a child worktree onto the parent tree. */
export async function applyGitWorktree(
  projectPath: string,
  worktreePath: string,
): Promise<{ files: string[] }> {
  const resolved = resolve(worktreePath);
  if (!isInside(worktreeRoot(projectPath), resolved)) {
    throw new Error("worktree path is outside .polycode/worktrees");
  }
  const changed = (await git(worktreePath, ["diff", "--name-only", "HEAD"]))
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  let extra: string[] = [];
  try {
    extra = (await git(worktreePath, ["ls-files", "--others", "--exclude-standard"]))
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    extra = [];
  }
  const files = [...new Set([...changed, ...extra])];
  const applied: string[] = [];
  const parent = resolve(projectPath);
  for (const rel of files) {
    if (!rel || isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) continue;
    const from = join(worktreePath, rel);
    const to = resolve(join(projectPath, rel));
    if (!isInside(parent, to) && to !== parent) continue;
    if (!existsSync(from)) continue;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    applied.push(rel);
  }
  return { files: applied };
}
