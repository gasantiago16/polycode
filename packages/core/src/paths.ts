import { homedir } from "node:os";
import { join } from "node:path";

/** Project-relative path with `/` separators, no leading `./`. */
export function normalizeRelPath(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** User config dir: POLYCODE_CONFIG_DIR, else %APPDATA%/polycode, else ~/.config/polycode. */
export function polycodeConfigDir(): string {
  if (process.env.POLYCODE_CONFIG_DIR) return process.env.POLYCODE_CONFIG_DIR;
  if (process.env.APPDATA) return join(process.env.APPDATA, "polycode");
  return join(homedir(), ".config", "polycode");
}

/**
 * `.polycode/` is jailed (sessions, worktrees, audit) except these tool-visible
 * files the agent is allowed to read/write through the sandbox.
 */
export function isPolycodeToolPathAllowed(rel: string): boolean {
  const n = normalizeRelPath(rel).toLowerCase();
  if (n === ".polycode/memory.md") return true;
  if (n === ".polycode/reviews" || n.startsWith(".polycode/reviews/")) return true;
  return false;
}

/** `.env` / `.git` / `.ssh` / `.polycode` (except allowed tool paths) stay protected. */
export function isProtectedProjectPath(rel: string): boolean {
  const n = normalizeRelPath(rel).toLowerCase();
  if (!n) return false;
  if (n === ".env" || n.endsWith("/.env") || n.startsWith(".env.") || n.includes("/.env.") || n.includes("/.env/")) {
    return true;
  }
  if (n === ".git" || n.startsWith(".git/") || n.endsWith("/.git") || n.includes("/.git/")) return true;
  if (n === ".ssh" || n.startsWith(".ssh/") || n.endsWith("/.ssh") || n.includes("/.ssh/")) return true;
  if (n === ".polycode" || (n.startsWith(".polycode/") && !isPolycodeToolPathAllowed(n))) return true;
  return false;
}

/**
 * Shell snippets that name a protected path. Used by the permission engine and
 * as a second jail on `sandbox.exec` so `python -c "open('.env')"` is refused.
 */
export function commandTouchesProtected(command: string): boolean {
  const c = command.replace(/\\/g, "/");
  return /(^|[^A-Za-z0-9])(\.env(?:\.|\/|\b)|\.git(?:\/|\b)|\.ssh(?:\/|\b)|\.polycode(?:\/|\b))/i.test(c);
}
