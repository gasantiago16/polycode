import { describe, expect, it, vi } from "vitest";
import { Agent } from "./agent.js";
import { PermissionEngine } from "./permissions.js";
import type { CanonicalEvent, GenerateRequest, Provider, Sandbox, ToolSpec } from "./types.js";

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
});
