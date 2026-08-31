import type { Sandbox, ToolRunResult, ToolSpec } from "./types.js";

export type ChildType = "general" | "explore" | "review" | "researcher";

export const CHILD_TYPES: ChildType[] = ["general", "explore", "review", "researcher"];

/** Plugin-defined child (registered at session start). */
export interface ExtraChildDef {
  name: string;
  description: string;
  system: string;
  /** Allowlist of parent tool names. Omit = all except `task`. */
  tools?: string[];
}

const extraChildren = new Map<string, ExtraChildDef>();

export function registerExtraChildren(defs: ExtraChildDef[]): void {
  extraChildren.clear();
  for (const d of defs) {
    const name = d.name.trim().toLowerCase();
    if (!name || CHILD_TYPES.includes(name as ChildType)) continue;
    extraChildren.set(name, { ...d, name });
  }
}

export function listExtraChildren(): ExtraChildDef[] {
  return [...extraChildren.values()];
}

/** Explore / researcher children only read; they can run in parallel on the parent tree. */
export function isReadOnlyTask(input: unknown): boolean {
  const rec = (input ?? {}) as Record<string, unknown>;
  const type = String(rec.subagent_type ?? "general").toLowerCase();
  return type === "explore" || type === "researcher";
}

export function taskWantsWorktree(input: unknown): boolean {
  const rec = (input ?? {}) as Record<string, unknown>;
  return rec.isolation === "worktree";
}

export function parseChildType(raw?: string): string {
  const t = (raw ?? "general").trim().toLowerCase();
  if (t === "explore" || t === "review" || t === "general" || t === "researcher") return t;
  if (extraChildren.has(t)) return t;
  const extras = [...extraChildren.keys()];
  const hint = extras.length ? `|${extras.join("|")}` : "";
  throw new Error(`unknown subagent_type "${raw}" (expected general|explore|review|researcher${hint})`);
}

const EXPLORE_TOOLS = new Set(["read", "grep", "ls", "glob", "lsp"]);
const REVIEW_TOOLS = new Set(["read", "grep", "ls", "glob", "write", "lsp"]);
const RESEARCHER_TOOLS = new Set(["read", "grep", "ls", "glob", "web_fetch", "web_search"]);

const PARENT_ONLY = new Set(["task", "task_wait", "task_kill"]);

export function toolsForChild(type: string, parentTools: ToolSpec[]): ToolSpec[] {
  const withoutTask = parentTools.filter((t) => !PARENT_ONLY.has(t.name));
  const extra = extraChildren.get(type);
  if (extra) {
    if (!extra.tools?.length) return withoutTask;
    const allow = new Set(extra.tools);
    return withoutTask.filter((t) => allow.has(t.name));
  }
  if (type === "general") return withoutTask;
  const allow =
    type === "explore" ? EXPLORE_TOOLS : type === "researcher" ? RESEARCHER_TOOLS : REVIEW_TOOLS;
  const picked = withoutTask.filter((t) => allow.has(t.name));
  if (type === "review") return picked.map((t) => (t.name === "write" ? jailWrite(t) : t));
  return picked;
}

/** Review children may only write under `.polycode/reviews/`. */
function jailWrite(write: ToolSpec): ToolSpec {
  return {
    ...write,
    async run(input: { path?: string; content?: string }, ctx) {
      const path = String(input?.path ?? "").replace(/\\/g, "/");
      if (!path.startsWith(".polycode/reviews/")) {
        return {
          output: `review child cannot write ${path} — only .polycode/reviews/* is allowed`,
          isError: true,
        };
      }
      return write.run(input, ctx);
    },
  };
}

export function systemForChild(type: string, parentSystem?: string, persona?: string): string {
  const base = parentSystem ? `Project context:\n${parentSystem}\n\n` : "";
  const overlay = persona?.trim() ? `\n\n<persona>\n${persona.trim()}\n</persona>` : "";
  const extra = extraChildren.get(type);
  if (extra) return base + extra.system + overlay;
  if (type === "explore") {
    return (
      base +
      "You are an explore subagent. Read-only. Use read/grep/ls/glob to answer the prompt. " +
      "Do not suggest edits as if you made them. Return a concise summary of what you found." +
      overlay
    );
  }
  if (type === "researcher") {
    return (
      base +
      "You are a research subagent. Use web_search then web_fetch on primary sources (papers, official docs, mailing lists). " +
      "Do not answer from memory. Cite URLs. If you cannot fetch a primary, say unknown — not holds. " +
      "Return: verdict, 3-8 URLs, best attack on the claim, what would change the verdict." +
      overlay
    );
  }
  if (type === "review") {
    return (
      base +
      REVIEW_PERSONA +
      "\n\nWrite findings to the review file path given in the user prompt. " +
      "That file is the only write you may perform. Do not edit project source." +
      overlay
    );
  }
  return (
    base +
    "You are a delegated coding subagent. Solve the prompt. You cannot spawn further subagents. " +
    "Return a short final summary of what you did." +
    overlay
  );
}

export const REVIEW_PERSONA = `You are a meticulous code reviewer (cranky). Review the diff and produce structured notes.

Process:
1. Read the diff and the surrounding source files.
2. Write findings to the specified review file.
3. Use this format exactly:

## Summary
<2-4 sentences>

## Verdict
APPROVE | REJECT

## Issues

### Issue 1 -- Severity: bug
- File: path/to/file.ext:LINE
- Description: <what is wrong>
- Suggestion: <how to fix>
- Status: open

Severity must be one of: bug, suggestion, nit.
REJECT if any bug is Status: open. APPROVE if zero bugs (nits/suggestions may remain).
Do not inflate severity. A bug is a correctness/security/breakage defect.
Do not edit project source. Cite file:line for every issue.`;

export const MAX_CHILD_OUTPUT = 8_000;

export function clipChildOutput(text: string): string {
  if (text.length <= MAX_CHILD_OUTPUT) return text;
  return text.slice(0, MAX_CHILD_OUTPUT) + "\n…[child output truncated]";
}

export async function collectGitDiff(sandbox: Sandbox): Promise<string> {
  const status = await sandbox.exec("git status --porcelain");
  const diff = await sandbox.exec("git diff HEAD");
  const untracked = await sandbox.exec("git ls-files --others --exclude-standard");
  const parts = [
    status.stdout.trim() && `## status\n${status.stdout.trim()}`,
    diff.stdout.trim() && `## diff HEAD\n${diff.stdout.trim()}`,
    untracked.stdout.trim() && `## untracked\n${untracked.stdout.trim()}`,
  ].filter(Boolean);
  if (!parts.length) return "";
  return parts.join("\n\n").slice(0, 400_000);
}

export function parseReviewVerdict(markdown: string): { bugs: number; suggestions: number; nits: number; verdict: "APPROVE" | "REJECT" | "UNKNOWN" } {
  const bugs = countIssues(markdown, "bug");
  const suggestions = countIssues(markdown, "suggestion");
  const nits = countIssues(markdown, "nit");
  const m = markdown.match(/^## Verdict\s*\n\s*(APPROVE|REJECT)\s*$/im);
  const verdict = (m?.[1] as "APPROVE" | "REJECT" | undefined) ?? (bugs > 0 ? "REJECT" : "UNKNOWN");
  return { bugs, suggestions, nits, verdict: bugs > 0 ? "REJECT" : verdict };
}

function countIssues(md: string, sev: string): number {
  const re = new RegExp(`^### Issue \\d+ -- Severity: ${sev}\\s*$`, "gim");
  return md.match(re)?.length ?? 0;
}

export function childFinalText(events: Array<{ type: string; text?: string }>): string {
  let text = "";
  for (const e of events) {
    if (e.type === "text_delta" && e.text) text += e.text;
  }
  return text.trim();
}

export function okChild(output: string): ToolRunResult {
  return { output: clipChildOutput(output || "(child produced no text)") };
}
