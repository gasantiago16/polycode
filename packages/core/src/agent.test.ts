import { describe, expect, it, vi } from "vitest";
import { Agent } from "./agent.js";
import { PermissionEngine } from "./permissions.js";
import type { CanonicalEvent, CanonicalMessage, GenerateRequest, Provider, Sandbox, ToolSpec } from "./types.js";

const capabilities = {
  contextWindow: 10_000, maxOutput: 1_000, supportsTools: true,
  supportsReasoning: false, supportsCaching: false, supportsVision: false, parallelTools: true,
};

class ScriptedProvider implements Provider {
  id = "test";
  model = "scripted";
  calls = 0;
  constructor(private scripts: Array<CanonicalEvent[] | Error>) {}
  capabilities() { return capabilities; }
  async *stream(_req: GenerateRequest) {
    const script = this.scripts[Math.min(this.calls++, this.scripts.length - 1)];
    if (script instanceof Error) throw script;
    for (const event of script) yield event;
  }
}

const sandbox: Sandbox = {
  root: "test",
  async readFile() { return ""; },
  async writeFile() {},
  async exec() { return { stdout: "", stderr: "", code: 0 }; },
  async execFile() { return { stdout: "", stderr: "", code: 0 }; },
  async *walk() {},
  async dispose() {},
};

async function collect(agent: Agent) {
  const events = [];
  for await (const event of agent.run()) events.push(event);
  return events;
}

describe("Agent", () => {
  it("records a completed text turn once", async () => {
    const provider = new ScriptedProvider([[
      { type: "text_delta", text: "hello" },
      { type: "stop", reason: "end_turn", usage: { inputTokens: 2, outputTokens: 1 } },
    ]]);
    const agent = new Agent(provider, [], new PermissionEngine("ask", async () => "deny"), { sandbox });
    agent.pushUser("hi");
    const events = await collect(agent);
    expect(events.filter((e) => e.type === "turn_complete")).toHaveLength(1);
    expect(agent.history()).toHaveLength(2);
    expect(agent.history()[1].content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("retries a transient failure before output without duplication", async () => {
    const provider = new ScriptedProvider([
      new Error("503 temporarily unavailable"),
      [{ type: "text_delta", text: "recovered" }, { type: "stop", reason: "end_turn" }],
    ]);
    const agent = new Agent(provider, [], new PermissionEngine("ask", async () => "deny"), {
      sandbox, maxRetries: 1,
    });
    agent.pushUser("go");
    const events = await collect(agent);
    expect(provider.calls).toBe(2);
    expect(events.filter((e) => e.type === "text_delta")).toEqual([{ type: "text_delta", text: "recovered" }]);
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("does not retry after streamed output", async () => {
    const provider: Provider = {
      id: "test", model: "partial", capabilities: () => capabilities,
      async *stream() { yield { type: "text_delta", text: "partial" } as const; throw new Error("503"); },
    };
    const agent = new Agent(provider, [], new PermissionEngine("ask", async () => "deny"), { sandbox, maxRetries: 2 });
    agent.pushUser("go");
    const events = await collect(agent);
    expect(events.filter((e) => e.type === "text_delta")).toHaveLength(1);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("runs consecutive safe parallel tools concurrently and preserves result order", async () => {
    let active = 0;
    let maxActive = 0;
    const makeTool = (name: string, delay: number): ToolSpec => ({
      name, description: name, parameters: {}, permission: "safe", parallelSafe: true,
      async run() {
        active++; maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, delay));
        active--; return { output: name };
      },
    });
    const provider = new ScriptedProvider([[
      { type: "tool_call", call: { type: "tool_call", id: "1", name: "slow", input: {} } },
      { type: "tool_call", call: { type: "tool_call", id: "2", name: "fast", input: {} } },
      { type: "stop", reason: "tool_use" },
    ], [{ type: "stop", reason: "end_turn" }]]);
    const agent = new Agent(provider, [makeTool("slow", 30), makeTool("fast", 5)], new PermissionEngine("ask", async () => "deny"), { sandbox });
    agent.pushUser("go");
    await collect(agent);
    expect(maxActive).toBe(2);
    const toolMessage = agent.history().find((m) => m.role === "tool");
    expect(toolMessage?.content.map((p) => "name" in p ? p.name : "")).toEqual(["slow", "fast"]);
  });

  it("runs consecutive explore task children concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const task: ToolSpec = {
      name: "task",
      description: "task",
      parameters: {},
      permission: "mutating",
      parallelSafe: true,
      async run() {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 25));
        active--;
        return { output: "ok" };
      },
    };
    const call = (id: string, type: string) =>
      ({
        type: "tool_call" as const,
        call: {
          type: "tool_call" as const,
          id,
          name: "task",
          input: { description: id, prompt: "p", subagent_type: type },
        },
      });
    const provider = new ScriptedProvider([
      [call("1", "explore"), call("2", "explore"), { type: "stop", reason: "tool_use" }],
      [{ type: "stop", reason: "end_turn" }],
    ]);
    const agent = new Agent(provider, [task], new PermissionEngine("ask", async () => "deny"), { sandbox });
    agent.pushUser("fan out");
    await collect(agent);
    expect(maxActive).toBe(2);
  });

  it("auto-isolates two writable task children onto worktrees", async () => {
    const seen: unknown[] = [];
    const task: ToolSpec = {
      name: "task",
      description: "task",
      parameters: {},
      permission: "mutating",
      parallelSafe: true,
      async run(input) {
        seen.push(input);
        return { output: "ok" };
      },
    };
    const call = (id: string) =>
      ({
        type: "tool_call" as const,
        call: {
          type: "tool_call" as const,
          id,
          name: "task",
          input: { description: id, prompt: "edit", subagent_type: "general" },
        },
      });
    const provider = new ScriptedProvider([
      [call("1"), call("2"), { type: "stop", reason: "tool_use" }],
      [{ type: "stop", reason: "end_turn" }],
    ]);
    const agent = new Agent(provider, [task], new PermissionEngine("yolo", async () => "once"), {
      sandbox,
      openWorktree: async () => ({ sandbox, path: "/tmp/wt" }),
    });
    agent.pushUser("two writers");
    await collect(agent);
    expect(seen).toHaveLength(2);
    expect(seen.every((s) => (s as { isolation?: string }).isolation === "worktree")).toBe(true);
  });

  it("stops a runaway tool loop at maxSteps", async () => {
    const call = { type: "tool_call", call: { type: "tool_call", id: "1", name: "read", input: {} } } as const;
    const provider = new ScriptedProvider([[call, { type: "stop", reason: "tool_use" }]]);
    const readTool: ToolSpec = { name: "read", description: "", parameters: {}, permission: "safe", parallelSafe: true, async run() { return { output: "ok" }; } };
    const agent = new Agent(provider, [readTool], new PermissionEngine("ask", async () => "deny"), { sandbox, maxSteps: 2 });
    agent.pushUser("loop");
    const events = await collect(agent);
    expect(events.some((e) => e.type === "error" && e.error.includes("step limit reached"))).toBe(true);
    expect(provider.calls).toBe(2);
  });

  it("returns a denied tool result to the model without executing", async () => {
    const run = vi.fn(async () => ({ output: "bad" }));
    const dangerous: ToolSpec = { name: "bash", description: "", parameters: {}, permission: "dangerous", parallelSafe: false, run };
    const provider = new ScriptedProvider([[
      { type: "tool_call", call: { type: "tool_call", id: "1", name: "bash", input: {} } },
      { type: "stop", reason: "tool_use" },
    ], [{ type: "stop", reason: "end_turn" }]]);
    const agent = new Agent(provider, [dangerous], new PermissionEngine("ask", async () => "deny"), { sandbox });
    agent.pushUser("go");
    const events = await collect(agent);
    expect(run).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "tool_denied")).toBe(true);
  });

  it("redacts secrets in tool output before they enter history", async () => {
    const leak: ToolSpec = {
      name: "read",
      description: "",
      parameters: {},
      permission: "safe",
      parallelSafe: true,
      async run() {
        return { output: "token sk-abcdefghijklmnopqrstuvwxyz123456" };
      },
    };
    const provider = new ScriptedProvider([
      [
        { type: "tool_call", call: { type: "tool_call", id: "1", name: "read", input: {} } },
        { type: "stop", reason: "tool_use" },
      ],
      [{ type: "text_delta", text: "ok" }, { type: "stop", reason: "end_turn" }],
    ]);
    const agent = new Agent(provider, [leak], new PermissionEngine("ask", async () => "deny"), { sandbox });
    agent.pushUser("read it");
    await collect(agent);
    const blob = JSON.stringify(agent.history());
    expect(blob).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(blob).toContain("[REDACTED]");
  });

  it("auto-compacts a bloated history before the next model turn", async () => {
    const tiny = { ...capabilities, contextWindow: 80 };
    const fat = "z".repeat(400);
    const initialMessages: CanonicalMessage[] = [
      { role: "user", content: [{ type: "text", text: "task" }] },
      { role: "assistant", content: [{ type: "tool_call", id: "1", name: "read", input: {} }] },
      { role: "tool", content: [{ type: "tool_result", id: "1", name: "read", output: fat }] },
      { role: "assistant", content: [{ type: "tool_call", id: "2", name: "read", input: {} }] },
      { role: "tool", content: [{ type: "tool_result", id: "2", name: "read", output: fat }] },
      { role: "assistant", content: [{ type: "tool_call", id: "3", name: "read", input: {} }] },
      { role: "tool", content: [{ type: "tool_result", id: "3", name: "read", output: "recent-ok" }] },
    ];
    const provider: Provider = {
      id: "test",
      model: "scripted",
      capabilities: () => tiny,
      async *stream() {
        yield { type: "text_delta", text: "ok" };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const agent = new Agent(provider, [], new PermissionEngine("ask", async () => "deny"), {
      sandbox,
      compact: { keepRecentToolResults: 1, thresholdPercent: 50 },
      initialMessages,
    });
    const events = await collect(agent);
    const compacted = events.find((e) => e.type === "compacted");
    expect(compacted?.type).toBe("compacted");
    if (compacted?.type === "compacted") {
      expect(compacted.stats.after).toBeLessThan(compacted.stats.before);
    }
    const blob = JSON.stringify(agent.history());
    expect(blob).toContain("recent-ok");
    expect(blob).not.toContain(fat);
  });

  it("sticky-suppresses auto-compact after a failed shrink", async () => {
    const tiny = { ...capabilities, contextWindow: 8 };
    const provider = new ScriptedProvider([[{ type: "stop", reason: "end_turn" }]]);
    provider.capabilities = () => tiny;
    const initialMessages: CanonicalMessage[] = [{ role: "user", content: [{ type: "text", text: "task" }] }];
    for (let i = 0; i < 8; i++) {
      initialMessages.push(
        { role: "user", content: [{ type: "text", text: `u${i}` }] },
        { role: "assistant", content: [{ type: "text", text: `a${i}` }] },
      );
    }
    const agent = new Agent(provider, [], new PermissionEngine("ask", async () => "deny"), {
      sandbox,
      compact: {
        thresholdPercent: 1,
        keepRecentTurns: 2,
        summarize: async () => {
          throw new Error("summarizer down");
        },
      },
      initialMessages,
    });
    const first = await agent.compactNow("auto");
    const second = await agent.compactNow("auto");
    expect(first?.suppressed).toBe(true);
    expect(second?.suppressed).toBe(true);
  });

  it("rewinds a mutating write back to the prior file contents", async () => {
    const files = new Map<string, string>([["a.txt", "old"]]);
    const sb: Sandbox = {
      ...sandbox,
      async readFile(p) {
        const v = files.get(p);
        if (v === undefined) throw new Error("missing");
        return v;
      },
      async writeFile(p, c) {
        files.set(p, c);
      },
    };
    const writeTool: ToolSpec = {
      name: "write",
      description: "",
      parameters: {},
      permission: "mutating",
      parallelSafe: false,
      async run(input: { path: string; content: string }, ctx) {
        await ctx.sandbox.writeFile(input.path, input.content);
        return { output: "wrote" };
      },
    };
    const provider = new ScriptedProvider([
      [
        {
          type: "tool_call",
          call: { type: "tool_call", id: "1", name: "write", input: { path: "a.txt", content: "new" } },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [{ type: "text_delta", text: "done" }, { type: "stop", reason: "end_turn" }],
    ]);
    const agent = new Agent(provider, [writeTool], new PermissionEngine("yolo", async () => "once"), {
      sandbox: sb,
    });
    agent.pushUser("edit it");
    await collect(agent);
    expect(files.get("a.txt")).toBe("new");
    const r = await agent.rewind();
    expect(r?.files).toContain("a.txt");
    expect(files.get("a.txt")).toBe("old");
  });

  it("PreToolUse hook can deny a permitted tool", async () => {
    const run = vi.fn(async () => ({ output: "wrote" }));
    const writeTool: ToolSpec = {
      name: "write",
      description: "",
      parameters: {},
      permission: "mutating",
      parallelSafe: false,
      run,
    };
    const provider = new ScriptedProvider([
      [
        { type: "tool_call", call: { type: "tool_call", id: "1", name: "write", input: { path: "a.ts" } } },
        { type: "stop", reason: "tool_use" },
      ],
      [{ type: "stop", reason: "end_turn" }],
    ]);
    const agent = new Agent(provider, [writeTool], new PermissionEngine("yolo", async () => "once"), {
      sandbox: {
        ...sandbox,
        async exec() {
          return { stdout: "", stderr: "hook-deny", code: 1 };
        },
      },
      hooks: { PreToolUse: [{ matcher: "write", command: "deny" }] },
    });
    agent.pushUser("edit");
    const events = await collect(agent);
    expect(run).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "tool_denied")).toBe(true);
  });

  it("submitPrompt skips pushUser when UserPromptSubmit blocks", async () => {
    const provider = new ScriptedProvider([[{ type: "stop", reason: "end_turn" }]]);
    const agent = new Agent(provider, [], new PermissionEngine("ask", async () => "deny"), {
      sandbox: {
        ...sandbox,
        async exec() {
          return { stdout: "", stderr: "nope", code: 1 };
        },
      },
      hooks: { UserPromptSubmit: [{ command: "check" }] },
    });
    const r = await agent.submitPrompt("secret");
    expect(r.blocked).toBe(true);
    expect(agent.history()).toHaveLength(0);
  });

  it("records worktree paths from spawnChild", async () => {
    const provider = new ScriptedProvider([
      [{ type: "text_delta", text: "ok" }, { type: "stop", reason: "end_turn" }],
    ]);
    const parent = new Agent(provider, [], new PermissionEngine("ask", async () => "deny"), {
      sandbox,
      openWorktree: async () => ({ sandbox, path: "/tmp/wt-abc" }),
    });
    const r = await parent.spawnChild({
      description: "iso",
      prompt: "x",
      isolation: "worktree",
    });
    expect(r.output).toContain("/tmp/wt-abc");
    expect(parent.sessionWorktrees()).toEqual(["/tmp/wt-abc"]);
  });

  it("stores image parts on the user message", async () => {
    const provider = new ScriptedProvider([[{ type: "stop", reason: "end_turn" }]]);
    const agent = new Agent(provider, [], new PermissionEngine("ask", async () => "deny"), { sandbox });
    agent.pushUser("see this", [{ type: "image", mediaType: "image/png", data: "aaa", path: "shot.png" }]);
    const user = agent.history()[0];
    expect(user.content.some((p) => p.type === "image" && p.path === "shot.png")).toBe(true);
  });
});
