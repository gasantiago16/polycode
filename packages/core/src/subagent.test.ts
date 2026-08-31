import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent } from "./agent.js";
import { PermissionEngine } from "./permissions.js";
import {
  parseReviewVerdict,
  parseChildType,
  toolsForChild,
  registerExtraChildren,
} from "./subagent.js";
import type { CanonicalEvent, GenerateRequest, Provider, Sandbox, ToolSpec } from "./types.js";

const capabilities = {
  contextWindow: 10_000,
  maxOutput: 1_000,
  supportsTools: true,
  supportsReasoning: false,
  supportsCaching: false,
  supportsVision: false,
  parallelTools: true,
};

class ScriptedProvider implements Provider {
  id = "test";
  model = "scripted";
  calls = 0;
  constructor(private scripts: Array<CanonicalEvent[]>) {}
  capabilities() {
    return capabilities;
  }
  async *stream(_req: GenerateRequest) {
    const script = this.scripts[Math.min(this.calls++, this.scripts.length - 1)];
    for (const event of script) yield event;
  }
}

const sandbox: Sandbox = {
  root: "test",
  async readFile() {
    return "";
  },
  async writeFile() {},
  async exec() {
    return { stdout: "", stderr: "", code: 0 };
  },
  async execFile() {
    return { stdout: "", stderr: "", code: 0 };
  },
  async *walk() {},
  async dispose() {},
};

const read: ToolSpec = {
  name: "read",
  description: "",
  parameters: {},
  permission: "safe",
  parallelSafe: true,
  async run() {
    return { output: "file" };
  },
};
const bash: ToolSpec = {
  name: "bash",
  description: "",
  parameters: {},
  permission: "dangerous",
  parallelSafe: false,
  async run() {
    return { output: "sh" };
  },
};
const write: ToolSpec = {
  name: "write",
  description: "",
  parameters: {},
  permission: "mutating",
  parallelSafe: false,
  run: vi.fn(async () => ({ output: "wrote" })),
};
const task: ToolSpec = {
  name: "task",
  description: "",
  parameters: {},
  permission: "mutating",
  parallelSafe: false,
  async run(input: { description: string; prompt: string; subagent_type?: string }, ctx) {
    if (!ctx.spawnChild) return { output: "nested spawn blocked", isError: true };
    return ctx.spawnChild(input);
  },
};

describe("toolsForChild / parseChildType", () => {
  afterEach(() => registerExtraChildren([]));
  it("strips task and restricts explore to read-only tools", () => {
    const all = [read, write, bash, task];
    expect(toolsForChild("general", all).map((t) => t.name)).toEqual(["read", "write", "bash"]);
    expect(toolsForChild("explore", all).map((t) => t.name)).toEqual(["read"]);
    const web: ToolSpec = {
      name: "web_fetch",
      description: "",
      parameters: {},
      permission: "dangerous",
      parallelSafe: true,
      async run() {
        return { output: "w" };
      },
    };
    expect(toolsForChild("researcher", [...all, web]).map((t) => t.name)).toEqual(["read", "web_fetch"]);
    expect(toolsForChild("review", all).map((t) => t.name).sort()).toEqual(["read", "write"]);
  });
  it("rejects unknown types", () => {
    expect(() => parseChildType("swarm")).toThrow(/unknown subagent_type/);
  });
  it("accepts a registered plugin agent", () => {
    registerExtraChildren([{ name: "nitpicker", description: "nits", system: "find nits", tools: ["read"] }]);
    expect(parseChildType("nitpicker")).toBe("nitpicker");
    expect(toolsForChild("nitpicker", [read, write, bash]).map((t) => t.name)).toEqual(["read"]);
    registerExtraChildren([]);
  });
});

describe("review write jail", () => {
  it("blocks writes outside .polycode/reviews/", async () => {
    const jailed = toolsForChild("review", [write])[0];
    const r = await jailed.run({ path: "src/secret.ts", content: "x" }, { sandbox });
    expect(r.isError).toBe(true);
    expect(write.run).not.toHaveBeenCalled();
  });
  it("allows writes under .polycode/reviews/", async () => {
    const jailed = toolsForChild("review", [write])[0];
    const r = await jailed.run({ path: ".polycode/reviews/x.md", content: "ok" }, { sandbox });
    expect(r.isError).toBeFalsy();
    expect(write.run).toHaveBeenCalled();
  });
});

describe("Agent.spawnChild", () => {
  it("returns only the child's final text and does not leak child tools into parent history", async () => {
    const provider = new ScriptedProvider([
      [{ type: "text_delta", text: "found landing.rs" }, { type: "stop", reason: "end_turn" }],
    ]);
    const parent = new Agent(provider, [read, task], new PermissionEngine("ask", async () => "deny"), {
      sandbox,
    });
    parent.pushUser("parent");
    const result = await parent.spawnChild({
      description: "explore landing",
      prompt: "find landing",
      subagent_type: "explore",
    });
    expect(result.output).toContain("found landing.rs");
    expect(JSON.stringify(parent.history())).not.toContain("found landing.rs");
  });

  it("refuses nested spawn on a child agent", async () => {
    const provider = new ScriptedProvider([[{ type: "stop", reason: "end_turn" }]]);
    const child = new Agent(provider, [read, task], new PermissionEngine("ask", async () => "deny"), {
      sandbox,
      isChild: true,
    });
    const r = await child.spawnChild({ description: "nope", prompt: "x" });
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/depth 1/);
  });

  it("errors when worktree isolation is requested without a factory", async () => {
    const provider = new ScriptedProvider([[{ type: "stop", reason: "end_turn" }]]);
    const parent = new Agent(provider, [read, task], new PermissionEngine("ask", async () => "deny"), {
      sandbox,
    });
    const r = await parent.spawnChild({
      description: "iso",
      prompt: "x",
      isolation: "worktree",
    });
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/worktree/);
  });

  it("runs task from the parent loop and stores only the child summary", async () => {
    const provider = new ScriptedProvider([
      [
        {
          type: "tool_call",
          call: {
            type: "tool_call",
            id: "1",
            name: "task",
            input: { description: "look", prompt: "find x", subagent_type: "explore" },
          },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [{ type: "text_delta", text: "child-summary" }, { type: "stop", reason: "end_turn" }],
      [{ type: "text_delta", text: "parent-done" }, { type: "stop", reason: "end_turn" }],
    ]);
    const parent = new Agent(provider, [read, task], new PermissionEngine("yolo", async () => "once"), {
      sandbox,
    });
    parent.pushUser("delegate");
    const events = [];
    for await (const ev of parent.run()) events.push(ev);
    const toolMsg = parent.history().find((m) => m.role === "tool");
    const out = toolMsg?.content.map((p) => ("output" in p ? p.output : "")).join("") ?? "";
    expect(out).toContain("child-summary");
    expect(events.some((e) => e.type === "text_delta" && e.text === "parent-done")).toBe(true);
    // Child explore tools exclude `task`, so a nested spawn never ran.
    expect(out).not.toMatch(/nested spawn blocked|depth 1/);
  });
});

describe("parseReviewVerdict", () => {
  it("REJECTS when a bug is open", () => {
    const md = `## Summary\nx\n\n## Verdict\nAPPROVE\n\n## Issues\n\n### Issue 1 -- Severity: bug\n- File: a.ts:1\n`;
    expect(parseReviewVerdict(md).verdict).toBe("REJECT");
    expect(parseReviewVerdict(md).bugs).toBe(1);
  });
  it("APPROVES with only nits", () => {
    const md = `## Verdict\nAPPROVE\n\n### Issue 1 -- Severity: nit\n- File: a.ts:1\n`;
    expect(parseReviewVerdict(md)).toMatchObject({ verdict: "APPROVE", nits: 1, bugs: 0 });
  });
});
