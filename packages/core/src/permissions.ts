import type { PermissionClass, ToolSpec } from "./types.js";
import { commandTouchesProtected, isProtectedProjectPath } from "./paths.js";
import { isReadOnlyTask } from "./subagent.js";

export interface PermissionRule {
  /** Canonical tool name (read, write, bash, …) or `*` */
  tool: string;
  /** Optional glob matched against path/command/JSON input. */
  pattern?: string;
  action: "allow" | "deny";
}

export interface PermissionRuleSet {
  allow?: string[];
  deny?: string[];
}

export type PermissionMode = "plan" | "ask" | "acceptEdits" | "yolo";

export interface PermissionDecision {
  allow: boolean;
  reason?: string;
}

/** The user's answer to a prompt: allow once, allow for the session, or deny. */
export type PermissionChoice = "once" | "always" | "deny";

/** The UI implements this to prompt the user. */
export type PermissionPrompt = (req: {
  tool: ToolSpec;
  input: unknown;
}) => Promise<PermissionChoice>;

/**
 * Provider-agnostic safety gate, modeled on Claude Code's permission modes:
 *   plan        — read-only; refuse anything that mutates
 *   ask         — auto-allow safe; prompt for mutating/dangerous
 *   acceptEdits — auto-allow safe + mutating; prompt for dangerous
 *   yolo        — allow everything (use in sandboxes / CI only)
 */
const TOOL_ALIAS: Record<string, string> = {
  bash: "bash",
  edit: "edit",
  write: "write",
  read: "read",
  grep: "grep",
  glob: "glob",
  ls: "ls",
  multiedit: "multi_edit",
  multi_edit: "multi_edit",
  web_fetch: "web_fetch",
  webfetch: "web_fetch",
  web_search: "web_search",
  task: "task",
  memory: "memory",
  mcp_search: "mcp_search",
  lsp: "lsp",
};

/** Parse `Bash(npm test:*)` / `Edit(src/**)` / `Write` into a rule. */
export function parsePermissionPattern(raw: string, action: "allow" | "deny"): PermissionRule {
  const s = raw.trim();
  const m = s.match(/^([A-Za-z0-9_]+)\((.*)\)$/);
  if (m) {
    const tool = TOOL_ALIAS[m[1].toLowerCase()] ?? m[1].toLowerCase();
    return { tool, pattern: m[2], action };
  }
  const tool = TOOL_ALIAS[s.toLowerCase()] ?? s.toLowerCase();
  return { tool, action };
}

export function compileRules(set: PermissionRuleSet | undefined): PermissionRule[] {
  if (!set) return [];
  return [
    ...(set.deny ?? []).map((p) => parsePermissionPattern(p, "deny")),
    ...(set.allow ?? []).map((p) => parsePermissionPattern(p, "allow")),
  ];
}

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") i++;
      re += ".*";
    } else if (c === "?") re += ".";
    else if (/[.+^${}()|[\]\\]/.test(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

export function ruleMatches(rule: PermissionRule, tool: string, input: unknown): boolean {
  if (rule.tool !== "*" && rule.tool !== tool) return false;
  if (!rule.pattern) return true;
  const rec = (input ?? {}) as Record<string, unknown>;
  const candidates = [rec.path, rec.command, rec.query, rec.url]
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.replace(/\\/g, "/"));
  const rx = globToRegExp(rule.pattern.replace(/\\/g, "/"));
  if (candidates.some((c) => rx.test(c))) return true;
  return rx.test(JSON.stringify(input ?? {}));
}

/** Paths / bash snippets that must never be auto-approved (still prompt, or deny in plan). */
export function isProtectedInput(input: unknown): boolean {
  const rec = (input ?? {}) as Record<string, unknown>;
  const path = typeof rec.path === "string" ? rec.path : "";
  if (path && isProtectedProjectPath(path)) return true;
  const command = typeof rec.command === "string" ? rec.command : "";
  if (command && commandTouchesProtected(command)) return true;
  return false;
}

export class PermissionEngine {
  /** Tools the user chose to allow for the rest of the session ("always"). */
  private sessionAllowed = new Set<string>();

  constructor(
    private mode: PermissionMode,
    private prompt: PermissionPrompt,
    private rules: PermissionRule[] = [],
  ) {}

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }
  getMode(): PermissionMode {
    return this.mode;
  }

  /**
   * Silent engine for background children (cannot pop the TUI prompt).
   * yolo/acceptEdits stay writable; ask/plan become plan (read-only).
   */
  forkSilent(): PermissionEngine {
    const mode: PermissionMode =
      this.mode === "yolo" || this.mode === "acceptEdits" ? this.mode : "plan";
    return new PermissionEngine(mode, async () => "deny", this.rules);
  }

  /** Tool names granted "always allow" this session (for UI display). */
  sessionGrants(): string[] {
    return [...this.sessionAllowed];
  }

  async check(tool: ToolSpec, input: unknown): Promise<PermissionDecision> {
    const cls: PermissionClass =
      tool.name === "task" && isReadOnlyTask(input) ? "safe" : tool.permission;

    const deny = this.rules.find((r) => r.action === "deny" && ruleMatches(r, tool.name, input));
    if (deny) return { allow: false, reason: `denied by rule ${deny.tool}(${deny.pattern ?? ""})` };

    if (isProtectedInput(input) && this.mode !== "yolo") {
      return { allow: false, reason: "protected path (.env / .git / .polycode)" };
    }

    if (cls === "safe") return { allow: true };

    if (this.mode === "yolo") return { allow: true };

    const allow = this.rules.find((r) => r.action === "allow" && ruleMatches(r, tool.name, input));
    if (allow) return { allow: true };

    // plan is a hard read-only guarantee — it overrides prior "always" grants.
    if (this.mode === "plan") {
      return { allow: false, reason: "plan mode: read-only tools only" };
    }

    if (this.sessionAllowed.has(tool.name)) return { allow: true };
    if (this.mode === "acceptEdits" && cls === "mutating") {
      return { allow: true };
    }

    // ask mode (or a dangerous tool in any non-yolo mode): defer to the user.
    const choice = await this.prompt({ tool, input });
    if (choice === "always") {
      this.sessionAllowed.add(tool.name);
      return { allow: true };
    }
    if (choice === "once") return { allow: true };
    return { allow: false, reason: "denied by user" };
  }
}
