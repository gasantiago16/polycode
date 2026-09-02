import {
  isProtectedProjectPath,
  type ToolSpec,
  type ToolContext,
  type ToolRunResult,
  type Sandbox,
} from "@polycode/core";
import { task } from "./task.js";
import { taskKill, taskWait } from "./task-ctl.js";
import { graphTool } from "./graph.js";
import { webFetch } from "./web.js";
import { webSearch } from "./search.js";
import { todoWrite } from "./todo.js";
import { memory } from "./memory.js";

const MAX_OUTPUT = 60_000;

function clamp(s: string): string {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + "\n…[truncated]" : s;
}

// Tools are thin: they validate intent and delegate all I/O to ctx.sandbox,
// which is either host-local or an isolated container. See @polycode/sandbox.

const DEFAULT_READ_LIMIT = 2000;

const read: ToolSpec = {
  name: "read",
  description:
    "Read a UTF-8 text file relative to the project root. Returns cat -n style numbered lines so you can reference and edit by line. Use offset/limit for large files.",
  permission: "safe",
  parallelSafe: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to project root" },
      offset: { type: "number", description: "1-based line to start from (default 1)" },
      limit: {
        type: "number",
        description: `Max lines to return (default ${DEFAULT_READ_LIMIT})`,
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async run(input: { path: string; offset?: number; limit?: number }, ctx: ToolContext) {
    const raw = await ctx.sandbox.readFile(input.path);
    const lines = raw.split("\n");
    const total = lines.length;
    const start = Math.max(1, Math.floor(input.offset ?? 1));
    if (start > total) {
      return { output: `(file has ${total} lines; offset ${start} is past end)`, isError: true };
    }
    const limit = Math.max(1, Math.floor(input.limit ?? DEFAULT_READ_LIMIT));
    const end = Math.min(total, start - 1 + limit);
    const width = String(end).length;
    const body = lines
      .slice(start - 1, end)
      .map((line, i) => `${String(start + i).padStart(width)}\t${line}`)
      .join("\n");
    const header = `// ${input.path} (lines ${start}-${end} of ${total})\n`;
    const more = end < total ? `\n…[${total - end} more lines; read with offset ${end + 1}]` : "";
    return { output: clamp(header + body + more) };
  },
};

const write: ToolSpec = {
  name: "write",
  description: "Create or overwrite a text file with the given contents.",
  permission: "mutating",
  parallelSafe: false,
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async run(input: { path: string; content: string }, ctx: ToolContext) {
    let before: string | undefined;
    try {
      before = await ctx.sandbox.readFile(input.path);
    } catch {
      before = undefined; // new file
    }
    await ctx.sandbox.writeFile(input.path, input.content);
    const verb = before === undefined ? "created" : "wrote";
    return {
      output: `${verb} ${input.content.length} bytes to ${input.path}`,
      display: diffBlock(input.path, before ?? "", input.content, before === undefined),
    };
  },
};

const edit: ToolSpec = {
  name: "edit",
  description:
    "Replace an exact string in a file. Errors if old_string is absent or not unique (add surrounding context, or set replace_all to change every occurrence).",
  permission: "mutating",
  parallelSafe: false,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
      replace_all: { type: "boolean", description: "Replace every occurrence (default false)" },
    },
    required: ["path", "old_string", "new_string"],
    additionalProperties: false,
  },
  async run(
    input: { path: string; old_string: string; new_string: string; replace_all?: boolean },
    ctx: ToolContext,
  ) {
    const before = await ctx.sandbox.readFile(input.path);
    const res = applyEdit(before, input.old_string, input.new_string, input.replace_all);
    if (!res.ok) return { output: `${res.error} (${input.path})`, isError: true };
    await ctx.sandbox.writeFile(input.path, res.text);
    const suffix = input.replace_all ? ` (${res.count} occurrences)` : "";
    return {
      output: `edited ${input.path}${suffix}`,
      display: diffBlock(input.path, before, res.text),
    };
  },
};

const multiEdit: ToolSpec = {
  name: "multi_edit",
  description:
    "Apply a sequence of exact-string edits to ONE file atomically (all-or-nothing). Each edit follows the same uniqueness rules as `edit`; if any fails, nothing is written.",
  permission: "mutating",
  parallelSafe: false,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      edits: {
        type: "array",
        description: "Edits applied in order to the in-memory file before a single write.",
        items: {
          type: "object",
          properties: {
            old_string: { type: "string" },
            new_string: { type: "string" },
            replace_all: { type: "boolean" },
          },
          required: ["old_string", "new_string"],
          additionalProperties: false,
        },
      },
    },
    required: ["path", "edits"],
    additionalProperties: false,
  },
  async run(
    input: {
      path: string;
      edits: Array<{ old_string: string; new_string: string; replace_all?: boolean }>;
    },
    ctx: ToolContext,
  ) {
    if (!input.edits?.length) return { output: "no edits provided", isError: true };
    const before = await ctx.sandbox.readFile(input.path);
    let text = before;
    for (let i = 0; i < input.edits.length; i++) {
      const e = input.edits[i];
      const res = applyEdit(text, e.old_string, e.new_string, e.replace_all);
      if (!res.ok) return { output: `edit #${i + 1}: ${res.error} (${input.path})`, isError: true };
      text = res.text;
    }
    await ctx.sandbox.writeFile(input.path, text);
    return {
      output: `applied ${input.edits.length} edits to ${input.path}`,
      display: diffBlock(input.path, before, text),
    };
  },
};

const bash: ToolSpec = {
  name: "bash",
  description:
    "Run a shell command in the project root (sandboxed). Do NOT use bash to list, find, or count files — use glob (returns a count), grep, ls, or read. Prefer bash for tests, builds, and git. Host is often Windows: no wc/rg unless installed.",
  permission: "dangerous",
  parallelSafe: false,
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
      timeout_ms: { type: "number", description: "Default 120000" },
    },
    required: ["command"],
    additionalProperties: false,
  },
  async run(input: { command: string; timeout_ms?: number }, ctx: ToolContext) {
    const r = await ctx.sandbox.exec(input.command, {
      timeoutMs: input.timeout_ms ?? 120_000,
      signal: ctx.signal,
    });
    const out = [r.stdout, r.stderr].filter(Boolean).join("\n").trim() || "(no output)";
    return { output: clamp(out), isError: r.code !== 0 };
  },
};

interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  ignore_case?: boolean;
  context?: number;
  max_results?: number;
}

const grep: ToolSpec = {
  name: "grep",
  description:
    "Search file contents for a regex. Uses ripgrep when available, else a JS scan. Match lines are 'file:line: text'; context lines are 'file-line- text'.",
  permission: "safe",
  parallelSafe: true,
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regular expression to search for" },
      path: { type: "string", description: "File or directory to limit the search to" },
      glob: { type: "string", description: "Only search files matching this glob, e.g. **/*.ts" },
      ignore_case: { type: "boolean", description: "Case-insensitive search" },
      context: { type: "number", description: "Lines of context before & after each match" },
      max_results: { type: "number", description: "Max matches to return (default 200)" },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async run(input: GrepInput, ctx: ToolContext) {
    if (input.path && isProtectedProjectPath(input.path)) {
      return { output: "path is not accessible", isError: true };
    }
    if (await hasRipgrep(ctx)) return runRipgrep(input, ctx);
    return runJsGrep(input, ctx);
  },
};

const ls: ToolSpec = {
  name: "ls",
  description:
    "List files and directories directly under a path (project root if omitted). Ignores node_modules/.git/dist.",
  permission: "safe",
  parallelSafe: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory relative to project root (default '.')" },
    },
    required: [],
    additionalProperties: false,
  },
  async run(input: { path?: string }, ctx: ToolContext) {
    const prefix = normalizeDir(input.path);
    const dirs = new Set<string>();
    const files: string[] = [];
    for await (const f of ctx.sandbox.walk()) {
      if (prefix && !f.startsWith(prefix)) continue;
      const rest = prefix ? f.slice(prefix.length) : f;
      const slash = rest.indexOf("/");
      if (slash === -1) files.push(rest);
      else dirs.add(rest.slice(0, slash));
    }
    if (!dirs.size && !files.length) {
      return { output: `(empty or not found: ${input.path ?? "."})` };
    }
    const out = [...[...dirs].sort().map((d) => `${d}/`), ...files.sort()];
    return { output: clamp(out.join("\n")) };
  },
};

const glob: ToolSpec = {
  name: "glob",
  description:
    "List files matching a glob (* and **). First line is the match count — use this instead of bash/find/wc to count files (e.g. **/*.py).",
  permission: "safe",
  parallelSafe: true,
  parameters: {
    type: "object",
    properties: { pattern: { type: "string" } },
    required: ["pattern"],
    additionalProperties: false,
  },
  async run(input: { pattern: string }, ctx: ToolContext) {
    const re = globToRegExp(input.pattern);
    const out: string[] = [];
    for await (const file of ctx.sandbox.walk()) {
      if (re.test(file)) out.push(file);
      if (out.length > 1000) break;
    }
    if (!out.length) return { output: "(no matches)" };
    const n = out.length;
    const noun = n === 1 ? "file" : "files";
    return { output: clamp(`${n} ${noun}\n${out.join("\n")}`) };
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EditOk {
  ok: true;
  text: string;
  count: number;
}
interface EditErr {
  ok: false;
  error: string;
}

/** Shared edit logic with a uniqueness guard, used by `edit` and `multi_edit`. */
function applyEdit(
  text: string,
  oldS: string,
  newS: string,
  replaceAll?: boolean,
): EditOk | EditErr {
  if (oldS === newS) return { ok: false, error: "old_string and new_string are identical" };
  const count = countOccurrences(text, oldS);
  if (count === 0) return { ok: false, error: "old_string not found" };
  if (count > 1 && !replaceAll) {
    return {
      ok: false,
      error: `old_string is not unique (${count} matches) — add surrounding context or set replace_all`,
    };
  }
  const out = replaceAll ? text.split(oldS).join(newS) : replaceFirst(text, oldS, newS);
  return { ok: true, text: out, count };
}

/** A path header + a unified line diff, for the UI's `display` channel. */
function diffBlock(path: string, before: string, after: string, isNew = false): string {
  const header = isNew ? `${path} (new file)` : path;
  return `${header}\n${unifiedDiff(before, after)}`;
}

/** Line-level LCS diff rendered with limited context. UI-only — never the model. */
function unifiedDiff(before: string, after: string, context = 3, maxLines = 80): string {
  const a = before.length ? before.split("\n") : [];
  const b = after.length ? after.split("\n") : [];
  // Drop the trailing "" a final newline produces, else a normal file shows a
  // spurious blank context line (or a bogus +/- line on a newline-only change).
  if (a[a.length - 1] === "") a.pop();
  if (b[b.length - 1] === "") b.pop();
  if (a.length + b.length > 4_000) return `(diff too large: ${a.length} → ${b.length} lines)`;

  const ops = diffOps(a, b);
  if (!ops.some((o) => o.t !== " ")) return "(no textual change)";

  // Keep changed lines plus `context` lines of surrounding context; collapse the rest.
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((o, i) => {
    if (o.t === " ") return;
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) {
      keep[k] = true;
    }
  });

  const out: string[] = [];
  let collapsed = false;
  for (let i = 0; i < ops.length; i++) {
    if (!keep[i]) {
      if (!collapsed) out.push("…");
      collapsed = true;
      continue;
    }
    collapsed = false;
    out.push(`${ops[i].t} ${ops[i].s}`);
  }
  if (out.length > maxLines) {
    return out.slice(0, maxLines).join("\n") + `\n… (+${out.length - maxLines} more diff lines)`;
  }
  return out.join("\n");
}

/** Classic LCS backtrack into a ' '/'-'/'+' op list. */
function diffOps(a: string[], b: string[]): Array<{ t: " " | "-" | "+"; s: string }> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Array<{ t: " " | "-" | "+"; s: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: " ", s: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: "-", s: a[i] });
      i++;
    } else {
      ops.push({ t: "+", s: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ t: "-", s: a[i++] });
  while (j < m) ops.push({ t: "+", s: b[j++] });
  return ops;
}

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

/** Literal first-occurrence replace (avoids String.replace's `$` substitutions). */
function replaceFirst(text: string, oldS: string, newS: string): string {
  const i = text.indexOf(oldS);
  return i === -1 ? text : text.slice(0, i) + newS + text.slice(i + oldS.length);
}

function normalizePrefix(p?: string): string {
  if (!p) return "";
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function normalizeDir(p?: string): string {
  if (!p || p === "." || p === "./") return "";
  const s = p
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  return s ? s + "/" : "";
}

// Probe ripgrep once per sandbox (the model calls grep constantly, often in
// parallel batches — re-probing every call would spawn N extra processes).
const rgProbe = new WeakMap<Sandbox, Promise<boolean>>();

async function hasRipgrep(ctx: ToolContext): Promise<boolean> {
  let probe = rgProbe.get(ctx.sandbox);
  if (!probe) {
    probe = (async () => {
      try {
        const r = await ctx.sandbox.execFile("rg", ["--version"], { timeoutMs: 5_000 });
        return r.code === 0 && /ripgrep/i.test(r.stdout);
      } catch {
        return false;
      }
    })();
    rgProbe.set(ctx.sandbox, probe);
  }
  return probe;
}

async function runRipgrep(input: GrepInput, ctx: ToolContext): Promise<ToolRunResult> {
  const cap = Math.max(1, Math.floor(input.max_results ?? 200));
  const ctxN = input.context && input.context > 0 ? Math.floor(input.context) : 0;

  // Built as an explicit argv (no shell): nothing here is shell-parsed, so a
  // model-supplied pattern/glob/path can't inject a command.
  const args = ["--line-number", "--no-heading", "--color", "never", "--max-count", String(cap)];
  if (input.ignore_case) args.push("-i");
  if (ctxN > 0) args.push("-C", String(ctxN));
  if (input.glob) args.push("-g", input.glob);
  for (const g of ["!.env", "!.env.*", "!.git/**", "!.ssh/**", "!.polycode/**"]) {
    args.push("-g", g);
  }
  args.push("-e", input.pattern);
  // `--` ends options so a path beginning with `-` can't be read as a flag
  // (rg has flags like --pre that execute programs).
  if (input.path) args.push("--", input.path);

  const r = await ctx.sandbox.execFile("rg", args, { signal: ctx.signal });
  // rg exit codes: 0 = matches, 1 = no matches, 2 = error.
  if (r.code !== 0 && r.code !== 1) {
    return { output: clamp((r.stderr || r.stdout).trim() || "grep failed"), isError: true };
  }
  let text = r.stdout.replace(/\s+$/, "");
  // --max-count caps per-file; also bound the total output (context inflates it).
  const lineBudget = cap * (1 + 2 * ctxN) + cap;
  const lines = text ? text.split("\n") : [];
  if (lines.length > lineBudget) {
    text = lines.slice(0, lineBudget).join("\n") + `\n…[output truncated]`;
  }
  return { output: clamp(text || "(no matches)") };
}

async function runJsGrep(input: GrepInput, ctx: ToolContext): Promise<ToolRunResult> {
  let re: RegExp;
  try {
    re = new RegExp(input.pattern, input.ignore_case ? "i" : "");
  } catch (e) {
    return { output: `invalid regex: ${String(e)}`, isError: true };
  }
  const prefix = normalizePrefix(input.path);
  const globRe = input.glob ? globToRegExp(input.glob) : null;
  const ctxN = Math.max(0, Math.floor(input.context ?? 0));
  const cap = Math.max(1, Math.floor(input.max_results ?? 200));
  const out: string[] = [];
  let matches = 0;

  outer: for await (const file of ctx.sandbox.walk()) {
    if (prefix && !file.startsWith(prefix)) continue;
    if (globRe && !globRe.test(file)) continue;
    let text: string;
    try {
      text = await ctx.sandbox.readFile(file);
    } catch {
      continue; // binary / unreadable
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      if (ctxN > 0 && out.length) out.push("--");
      const start = Math.max(0, i - ctxN);
      const end = Math.min(lines.length - 1, i + ctxN);
      for (let j = start; j <= end; j++) {
        const sep = j === i ? ":" : "-";
        out.push(`${file}${sep}${j + 1}${sep} ${lines[j].trim()}`);
      }
      if (++matches >= cap) {
        out.push(`…[truncated at ${cap} matches]`);
        break outer;
      }
    }
  }
  return { output: clamp(out.join("\n") || "(no matches)") };
}

function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          i++;
          re += "(?:.*/)?"; // **/ matches zero or more leading path segments
        } else {
          re += ".*"; // ** matches across separators
        }
      } else {
        re += "[^/]*"; // * matches within a single segment
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

export const tools: ToolSpec[] = [
  read,
  write,
  edit,
  multiEdit,
  bash,
  grep,
  ls,
  glob,
  task,
  taskWait,
  taskKill,
  graphTool,
  webFetch,
  webSearch,
  todoWrite,
  memory,
];
export {
  read,
  write,
  edit,
  multiEdit,
  bash,
  grep,
  ls,
  glob,
  task,
  taskWait,
  taskKill,
  graphTool,
  webFetch,
  webSearch,
  todoWrite,
  memory,
};
