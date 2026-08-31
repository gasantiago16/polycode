import type { Sandbox, ToolSpec } from "./types.js";

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionEnd"
  | "Stop"
  | "SubagentStart"
  | "SubagentStop";

export const HOOK_EVENTS: readonly HookEvent[] = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "SessionEnd",
] as const;

const BLOCKING = new Set<HookEvent>(["PreToolUse", "UserPromptSubmit"]);

export interface HookSpec {
  /** Regex matched against the tool name (or subagent type). Empty = every call. */
  matcher?: string;
  /** Shell command, run through the sandbox. Nonzero blocking-event exit denies. */
  command: string;
}

export type HookSet = Partial<Record<HookEvent, HookSpec[]>>;

export interface HookContext {
  tool?: ToolSpec;
  input?: unknown;
  output?: string;
  prompt?: string;
  subagentType?: string;
}

function expand(command: string, ctx: HookContext): string {
  const rec = (ctx.input ?? {}) as Record<string, unknown>;
  const file = typeof rec.path === "string" ? rec.path : "";
  return command
    .replaceAll("$TOOL_NAME", ctx.tool?.name ?? "")
    .replaceAll("$FILE", file)
    .replaceAll("$TOOL_INPUT", JSON.stringify(ctx.input ?? {}))
    .replaceAll("$PROMPT", (ctx.prompt ?? "").slice(0, 2000))
    .replaceAll("$OUTPUT", (ctx.output ?? "").slice(0, 2000))
    .replaceAll("$SUBAGENT_TYPE", ctx.subagentType ?? "");
}

function matches(spec: HookSpec, value?: string): boolean {
  if (!spec.matcher) return true;
  if (!value) return false;
  try {
    return new RegExp(spec.matcher, "i").test(value);
  } catch {
    return spec.matcher.toLowerCase() === value.toLowerCase();
  }
}

export interface HookResult {
  blocked: boolean;
  reason?: string;
}

export async function runHooks(
  set: HookSet | undefined,
  event: HookEvent,
  sandbox: Sandbox,
  ctx: HookContext,
): Promise<HookResult> {
  const list = set?.[event] ?? [];
  for (const spec of list) {
    if (event === "PreToolUse" || event === "PostToolUse") {
      if (!matches(spec, ctx.tool?.name)) continue;
    } else if (event === "SubagentStart" || event === "SubagentStop") {
      if (!matches(spec, ctx.subagentType)) continue;
    }
    const cmd = expand(spec.command, ctx);
    const r = await sandbox.exec(cmd);
    if (BLOCKING.has(event) && r.code !== 0) {
      const err = (r.stderr || r.stdout || `exit ${r.code}`).trim().slice(0, 400);
      return { blocked: true, reason: `hook ${spec.matcher ?? "*"}: ${err}` };
    }
  }
  return { blocked: false };
}

export function mergeHookSets(...sets: Array<HookSet | undefined>): HookSet {
  const out: HookSet = {};
  for (const set of sets) {
    if (!set) continue;
    for (const ev of HOOK_EVENTS) {
      const list = set[ev];
      if (list?.length) out[ev] = [...(out[ev] ?? []), ...list];
    }
  }
  return out;
}

export function formatHookSet(set: HookSet | undefined): string {
  if (!set) return "no hooks configured";
  const lines: string[] = [];
  for (const ev of HOOK_EVENTS) {
    for (const s of set[ev] ?? []) {
      lines.push(`${ev}  ${s.matcher ?? "*"}  ${s.command}`);
    }
  }
  return lines.length ? lines.join("\n") : "no hooks configured";
}
