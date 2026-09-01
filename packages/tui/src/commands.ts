export type SlashGroup = "chat" | "context" | "project" | "extend";

export interface SlashCommand {
  name: string;
  summary: string;
  usage?: string;
  group: SlashGroup;
  aliases?: string[];
}

export const SLASH_GROUPS: Array<{ id: SlashGroup; title: string }> = [
  { id: "chat", title: "Chat" },
  { id: "context", title: "Context" },
  { id: "project", title: "Project" },
  { id: "extend", title: "Extend" },
];

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "help", group: "chat", summary: "Command list" },
  { name: "model", usage: "<provider:model>", group: "chat", summary: "Switch model" },
  { name: "mode", usage: "<plan|ask|acceptEdits|yolo>", group: "chat", summary: "Permission mode" },
  { name: "route", usage: "<auto|off|status>", group: "chat", summary: "Per-turn routing" },
  { name: "settings", group: "chat", summary: "API keys", aliases: ["login"] },
  { name: "keys", group: "chat", summary: "Open /settings" },
  { name: "clear", group: "chat", summary: "Clear this conversation" },
  { name: "exit", group: "chat", summary: "Quit", aliases: ["quit"] },
  { name: "compact", usage: "[focus]", group: "context", summary: "Compact context now" },
  { name: "context", group: "context", summary: "Token breakdown" },
  { name: "cost", group: "context", summary: "Session cost" },
  { name: "statusline", usage: "[template|default]", group: "context", summary: "Status line" },
  { name: "rewind", group: "context", summary: "Undo last mutating turn", aliases: ["undo"] },
  { name: "todo", group: "context", summary: "Show todos" },
  { name: "memory", usage: "[add|clear|show] [note]", group: "project", summary: "Project memory" },
  { name: "image", usage: "<path> [caption]", group: "project", summary: "Attach an image" },
  { name: "review", group: "project", summary: "Review the git diff", aliases: ["cranky"] },
  { name: "explore", usage: "<question>", group: "project", summary: "Read-only explore child" },
  { name: "team", usage: "<task>", group: "project", summary: "Parallel explore + worktree implement + review" },
  { name: "dashboard", group: "project", summary: "Child agents (Ctrl+\\) · enter peek · a attach", aliases: ["agents"] },
  { name: "loop", usage: "[5m] <prompt>|stop [id]", group: "project", summary: "Recurring prompt (min 15s)" },
  { name: "personas", group: "project", summary: "Loaded persona overlays" },
  { name: "worktree", usage: "list|apply|remove", group: "project", summary: "Detached git worktrees" },
  { name: "hooks", group: "project", summary: "Lifecycle hooks" },
  { name: "skills", group: "extend", summary: "Loaded skills" },
  { name: "plugins", group: "extend", summary: "Loaded plugins" },
  { name: "mcp", group: "extend", summary: "MCP servers" },
  { name: "workflows", group: "extend", summary: "List workflows" },
  { name: "workflow", usage: "<name> [query]", group: "extend", summary: "Run a workflow" },
  { name: "graphs", group: "extend", summary: "List LangGraph-shaped agent graphs" },
  { name: "graph", usage: "<name> [query]|resume <id>", group: "extend", summary: "Run or resume a checkpointed graph" },
  { name: "deep-research", usage: "<question>", group: "extend", summary: "Budgeted research workflow" },
  { name: "deep-research-review", usage: "[path]", group: "extend", summary: "Claim/fidelity review" },
];

const BY_NAME = new Map<string, SlashCommand>();
for (const c of SLASH_COMMANDS) {
  BY_NAME.set(c.name, c);
  for (const a of c.aliases ?? []) BY_NAME.set(a, c);
}

export function slashName(line: string): string {
  const t = line.trim();
  if (!t.startsWith("/")) return "";
  return (t.slice(1).split(/\s+/)[0] ?? "").toLowerCase();
}

export function lookupSlash(name: string): SlashCommand | undefined {
  return BY_NAME.get(name.toLowerCase());
}

export function matchSlash(input: string): SlashCommand[] {
  const raw = input.startsWith("/") ? input.slice(1) : input;
  const prefix = raw.split(/\s+/)[0]?.toLowerCase() ?? "";
  const seen = new Set<string>();
  const out: SlashCommand[] = [];
  for (const c of SLASH_COMMANDS) {
    const hit = !prefix || c.name.startsWith(prefix) || (c.aliases ?? []).some((a) => a.startsWith(prefix));
    if (!hit || seen.has(c.name)) continue;
    seen.add(c.name);
    out.push(c);
  }
  return out;
}

export function completeSlash(input: string): string | null {
  if (!input.startsWith("/") || /\s/.test(input)) return null;
  const matches = matchSlash(input);
  if (!matches.length) return null;
  if (matches.length === 1) return `/${matches[0].name} `;
  const names = matches.map((m) => m.name);
  const common = commonPrefix(names);
  const typed = input.slice(1).toLowerCase();
  if (common.length > typed.length) return `/${common}`;
  return null;
}

export function isKnownSlash(line: string, extra: string[] = []): boolean {
  const name = slashName(line);
  if (!name) return false;
  if (BY_NAME.has(name)) return true;
  return extra.some((s) => s.toLowerCase() === name);
}

/** User-facing copy for a slash the catalog does not know. Never sent to the model. */
export function unknownSlashMessage(line: string, extra: string[] = []): string {
  const name = slashName(line);
  const hint = didYouMean(name, extra);
  if (hint) return `/${name} isn't a command — not sent to the model. Did you mean /${hint}?`;
  return `/${name} isn't a command — not sent to the model. Type /help.`;
}

export function didYouMean(name: string, extra: string[] = []): string | null {
  const n = name.toLowerCase();
  if (!n) return null;
  const pool = [...new Set([...BY_NAME.keys(), ...extra.map((s) => s.toLowerCase())])];
  let best: string | null = null;
  let bestD = 3;
  for (const cand of pool) {
    if (cand.startsWith(n) || n.startsWith(cand)) {
      const canonical = BY_NAME.get(cand)?.name ?? cand;
      return canonical;
    }
    const d = editDistance(n, cand);
    if (d < bestD) {
      bestD = d;
      best = BY_NAME.get(cand)?.name ?? cand;
    }
  }
  return best;
}

export function formatSlashLine(c: SlashCommand): string {
  const left = `/${c.name}${c.usage ? " " + c.usage : ""}`;
  return `${left.padEnd(32)} ${c.summary}`;
}

function commonPrefix(items: string[]): string {
  if (!items.length) return "";
  let p = items[0];
  for (const s of items.slice(1)) {
    let i = 0;
    while (i < p.length && i < s.length && p[i] === s[i]) i++;
    p = p.slice(0, i);
  }
  return p;
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

export function composerPlaceholder(mode: string): string {
  if (mode === "plan") return "plan mode (read-only) · /mode ask to edit";
  if (mode === "yolo") return "yolo · tools auto-allowed · /mode ask to prompt";
  return "ask anything · / for commands · tab completes";
}

export function composerBorder(mode: string): "accent" | "tool" | "success" | "error" {
  if (mode === "plan") return "tool";
  if (mode === "acceptEdits") return "success";
  if (mode === "yolo") return "error";
  return "accent";
}
