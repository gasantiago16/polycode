import type { ToolSpec, ToolContext } from "@polycode/core";

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
    await ctx.sandbox.writeFile(input.path, input.content);
    return { output: `wrote ${input.content.length} bytes to ${input.path}` };
  },
};

const edit: ToolSpec = {
  name: "edit",
  description: "Replace an exact string in a file. Errors if the string is absent.",
  permission: "mutating",
  parallelSafe: false,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
      replace_all: { type: "boolean" },
    },
    required: ["path", "old_string", "new_string"],
    additionalProperties: false,
  },
  async run(
    input: { path: string; old_string: string; new_string: string; replace_all?: boolean },
    ctx: ToolContext,
  ) {
    const before = await ctx.sandbox.readFile(input.path);
    if (!before.includes(input.old_string)) {
      return { output: `old_string not found in ${input.path}`, isError: true };
    }
    const after = input.replace_all
      ? before.split(input.old_string).join(input.new_string)
      : before.replace(input.old_string, input.new_string);
    await ctx.sandbox.writeFile(input.path, after);
    return { output: `edited ${input.path}` };
  },
};

const bash: ToolSpec = {
  name: "bash",
  description: "Run a shell command in the project root (sandboxed). Use sparingly.",
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

const grep: ToolSpec = {
  name: "grep",
  description: "Search file contents for a regex. Returns matching lines with paths.",
  permission: "safe",
  parallelSafe: true,
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string", description: "Path prefix to limit the search" },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async run(input: { pattern: string; path?: string }, ctx: ToolContext) {
    const re = new RegExp(input.pattern);
    const prefix = input.path ? input.path.replace(/^\.\/?/, "").replace(/\\/g, "/") : "";
    const hits: string[] = [];
    for await (const file of ctx.sandbox.walk()) {
      if (prefix && !file.startsWith(prefix)) continue;
      let text: string;
      try {
        text = await ctx.sandbox.readFile(file);
      } catch {
        continue; // binary / unreadable
      }
      text.split("\n").forEach((line, i) => {
        if (re.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
      if (hits.length > 500) break;
    }
    return { output: clamp(hits.join("\n") || "(no matches)") };
  },
};

const glob: ToolSpec = {
  name: "glob",
  description: "List files matching a simple glob (supports * and **).",
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
    return { output: clamp(out.join("\n") || "(no matches)") };
  },
};

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, " ")
    .replace(/\*/g, "[^/]*")
    .replace(/ /g, ".*");
  return new RegExp(`^${escaped}$`);
}

export const tools: ToolSpec[] = [read, write, edit, bash, grep, glob];
export { read, write, edit, bash, grep, glob };
