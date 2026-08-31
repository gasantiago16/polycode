import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent } from "./agent.js";
import { PermissionEngine } from "./permissions.js";
import {
  parseReviewVerdict,
  parseChildType,
  toolsForChild,
  registerExtraChildren,
  systemForChild,
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

describe("systemForChild persona overlay", () => {
  it("appends persona instructions", () => {
    expect(systemForChild("explore", undefined, "Be terse.")).toContain("<persona>");
    expect(systemForChild("explore", undefined, "Be terse.")).toContain("Be terse.");
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

  it("background spawn returns an id and waitChild collects", async () => {
    const provider: Provider = {
      id: "test",
      model: "slow",
      capabilities: () => capabilities,
      async *stream() {
        await new Promise((r) => setTimeout(r, 25));
        yield { type: "text_delta", text: "bg-done" };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const parent = new Agent(provider, [read], new PermissionEngine("ask", async () => "deny"), { sandbox });
    const r = await parent.spawnChild({
      description: "look",
      prompt: "go",
      subagent_type: "explore",
      background: true,
    });
    expect(r.output).toMatch(/background child c1/);
    expect(parent.listChildren()[0].status).toBe("running");
    const waited = await parent.waitChild("c1", 1000);
    expect(waited.output).toContain("bg-done");
    expect(parent.listChildren()[0].status).toBe("completed");
  });

  it("refuses background writers in ask mode", async () => {
    const provider = new ScriptedProvider([[{ type: "stop", reason: "end_turn" }]]);
    const parent = new Agent(provider, [read], new PermissionEngine("ask", async () => "deny"), { sandbox });
    const r = await parent.spawnChild({
      description: "edit",
      prompt: "x",
      subagent_type: "general",
      background: true,
    });
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/acceptEdits or yolo/);
  });

  it("resume_from continues a completed child", async () => {
    const provider = new ScriptedProvider([
      [{ type: "text_delta", text: "first-pass" }, { type: "stop", reason: "end_turn" }],
      [{ type: "text_delta", text: "second-pass" }, { type: "stop", reason: "end_turn" }],
    ]);
    const parent = new Agent(provider, [read], new PermissionEngine("ask", async () => "deny"), { sandbox });
    await parent.spawnChild({ description: "e", prompt: "one", subagent_type: "explore" });
    const id = parent.listChildren()[0].id;
    const r = await parent.spawnChild({ description: "e2", prompt: "two", resume_from: id });
    expect(r.output).toContain("second-pass");
    expect(parent.listChildren()).toHaveLength(2);
  });

  it("injects persona instructions into the child system prompt", async () => {
    let seen = "";
    const provider: Provider = {
      id: "test",
      model: "p",
      capabilities: () => capabilities,
      async *stream(req) {
        seen = req.system ?? "";
        yield { type: "text_delta", text: "ok" };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const parent = new Agent(provider, [read], new PermissionEngine("ask", async () => "deny"), {
      sandbox,
      personas: [{ name: "terse", description: "t", instructions: "THREE BULLETS ONLY", source: "project" }],
    });
    await parent.spawnChild({
      description: "e",
      prompt: "x",
      subagent_type: "explore",
      persona: "terse",
    });
    expect(seen).toContain("THREE BULLETS ONLY");
  });

  it("detachRunningChildren backgrounds a foreground child instead of killing it", async () => {
    const provider: Provider = {
      id: "test",
      model: "slow",
      capabilities: () => capabilities,
      async *stream() {
        await new Promise((r) => setTimeout(r, 40));
        yield { type: "text_delta", text: "survived" };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const parent = new Agent(provider, [read], new PermissionEngine("ask", async () => "deny"), { sandbox });
    const ac = new AbortController();
    const pending = parent.spawnChild(
      { description: "fg", prompt: "go", subagent_type: "explore" },
      ac.signal,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(parent.listChildren()[0].status).toBe("running");
    const ids = parent.detachRunningChildren();
    ac.abort();
    const r = await pending;
    expect(ids).toEqual(["c1"]);
    expect(r.output).toMatch(/backgrounded c1/);
    const waited = await parent.waitChild("c1", 1000);
    expect(waited.output).toContain("survived");
    expect(parent.listChildren()[0].status).toBe("completed");
  });

  it("caps parallel background explores at 8", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const provider: Provider = {
      id: "test",
      model: "slow",
      capabilities: () => capabilities,
      async *stream() {
        await hold;
        yield { type: "text_delta", text: "x" };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const parent = new Agent(provider, [read], new PermissionEngine("yolo", async () => "once"), { sandbox });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        parent.spawnChild({
          description: `e${i}`,
          prompt: "go",
          subagent_type: "explore",
          background: true,
        }),
      ),
    );
    expect(results.filter((r) => !r.isError)).toHaveLength(8);
    expect(results.filter((r) => r.isError).every((r) => /too many running children/.test(r.output))).toBe(true);
    expect(parent.listChildren().filter((c) => c.status === "running")).toHaveLength(8);
    release();
  });

  it("refuses background researchers in ask mode", async () => {
    const provider = new ScriptedProvider([[{ type: "stop", reason: "end_turn" }]]);
    const parent = new Agent(provider, [read], new PermissionEngine("ask", async () => "deny"), { sandbox });
    const r = await parent.spawnChild({
      description: "cite",
      prompt: "x",
      subagent_type: "researcher",
      background: true,
    });
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/acceptEdits or yolo/);
  });

  it("Ctrl+B kills writers in ask instead of reporting them backgrounded", async () => {
    const provider: Provider = {
      id: "test",
      model: "slow",
      capabilities: () => capabilities,
      async *stream() {
        await new Promise((r) => setTimeout(r, 80));
        yield { type: "text_delta", text: "should-not-survive" };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const parent = new Agent(provider, [read], new PermissionEngine("ask", async () => "deny"), { sandbox });
    const ac = new AbortController();
    const pending = parent.spawnChild(
      { description: "edit", prompt: "go", subagent_type: "general" },
      ac.signal,
    );
    await new Promise((r) => setTimeout(r, 10));
    const ids = parent.detachRunningChildren();
    ac.abort();
    const r = await pending;
    expect(ids).toEqual([]);
    expect(r.output).not.toMatch(/backgrounded/);
    expect(parent.listChildren()[0].status).toBe("killed");
  });

  it("ignores isolation=worktree on resume of a non-worktree child", async () => {
    const provider = new ScriptedProvider([
      [{ type: "text_delta", text: "first" }, { type: "stop", reason: "end_turn" }],
      [{ type: "text_delta", text: "second" }, { type: "stop", reason: "end_turn" }],
    ]);
    const parent = new Agent(provider, [read], new PermissionEngine("ask", async () => "deny"), {
      sandbox,
      openWorktree: async () => ({ sandbox, path: "/tmp/wt-should-not-open" }),
    });
    await parent.spawnChild({ description: "e", prompt: "one", subagent_type: "explore" });
    const id = parent.listChildren()[0].id;
    await parent.spawnChild({
      description: "e2",
      prompt: "two",
      resume_from: id,
      isolation: "worktree",
    });
    const child = parent.listChildren()[1];
    expect(child.isolation).toBe("none");
    expect(child.worktreePath).toBeUndefined();
    expect(parent.sessionWorktrees()).toEqual([]);
  });

  it("redacts secrets on the child failure path", async () => {
    const provider: Provider = {
      id: "test",
      model: "boom",
      capabilities: () => capabilities,
      async *stream() {
        throw new Error("upstream Bearer sk-abcdefghijklmnopqrstuvwxyz123456");
      },
    };
    const parent = new Agent(provider, [read], new PermissionEngine("ask", async () => "deny"), { sandbox });
    const r = await parent.spawnChild({ description: "e", prompt: "go", subagent_type: "explore" });
    expect(r.isError).toBe(true);
    expect(r.output).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(r.output).toContain("[REDACTED]");
  });

  it("waitChild timeout 0 is a snapshot even when a parent signal is live", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const provider: Provider = {
      id: "test",
      model: "slow",
      capabilities: () => capabilities,
      async *stream() {
        await hold;
        yield { type: "text_delta", text: "late" };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const parent = new Agent(provider, [read], new PermissionEngine("ask", async () => "deny"), { sandbox });
    await parent.spawnChild({
      description: "look",
      prompt: "go",
      subagent_type: "explore",
      background: true,
    });
    const ac = new AbortController();
    const r = await parent.waitChild("c1", 0, ac.signal);
    expect(r.output).toMatch(/still running/);
    expect(parent.listChildren()[0].status).toBe("running");
    release();
  });

  it("Ctrl+B during worktree open does not re-bind the aborted parent signal", async () => {
    let release!: () => void;
    const hold = new Promise<{ sandbox: Sandbox; path: string }>((r) => {
      release = () => r({ sandbox, path: "/tmp/wt-detach" });
    });
    const provider: Provider = {
      id: "test",
      model: "slow",
      capabilities: () => capabilities,
      async *stream() {
        yield { type: "text_delta", text: "survived-wt" };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const parent = new Agent(provider, [read], new PermissionEngine("ask", async () => "deny"), {
      sandbox,
      openWorktree: () => hold,
    });
    const ac = new AbortController();
    const pending = parent.spawnChild(
      { description: "e", prompt: "go", subagent_type: "explore", isolation: "worktree" },
      ac.signal,
    );
    await new Promise((r) => setTimeout(r, 10));
    const ids = parent.detachRunningChildren();
    ac.abort();
    release();
    const r = await pending;
    expect(ids).toEqual(["c1"]);
    expect(r.output).toMatch(/survived-wt|backgrounded/);
    expect(parent.listChildren()[0].status).not.toBe("killed");
  });

  it("waitChild honors abort and returns live peek while still running", async () => {
    const provider: Provider = {
      id: "test",
      model: "slow",
      capabilities: () => capabilities,
      async *stream() {
        await new Promise((r) => setTimeout(r, 200));
        yield { type: "text_delta", text: "late" };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const parent = new Agent(provider, [read], new PermissionEngine("ask", async () => "deny"), { sandbox });
    await parent.spawnChild({
      description: "look",
      prompt: "go",
      subagent_type: "explore",
      background: true,
    });
    const ac = new AbortController();
    const pending = parent.waitChild("c1", 60_000, ac.signal);
    ac.abort();
    const r = await pending;
    expect(r.output).toMatch(/still running/);
    expect(parent.listChildren()[0].status).toBe("running");
  });

  it("clears demoteTurn after abort during stream so the next tool turn runs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const ran = vi.fn(async () => ({ output: "ok" }));
    const readTool: ToolSpec = { ...read, run: ran };
    const provider: Provider = {
      id: "test",
      model: "x",
      capabilities: () => capabilities,
      async *stream(req) {
        calls++;
        if (calls === 1) {
          await gate;
          if (req.signal?.aborted) throw new Error("aborted");
          yield { type: "text_delta", text: "one" };
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        if (calls === 2) {
          yield {
            type: "tool_call",
            call: { type: "tool_call", id: "1", name: "read", input: { path: "a.ts" } },
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield { type: "text_delta", text: "two" };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const parent = new Agent(provider, [readTool], new PermissionEngine("ask", async () => "deny"), { sandbox });
    parent.pushUser("one");
    const ac = new AbortController();
    const first = parent.run(ac.signal);
    const waiter = (async () => {
      try {
        for await (const _ of first) {
          /* drain */
        }
      } catch {
        /* abort */
      }
    })();
    await new Promise((r) => setTimeout(r, 5));
    parent.detachRunningChildren();
    ac.abort();
    release();
    await waiter;

    parent.pushUser("two");
    const events = [];
    for await (const ev of parent.run()) events.push(ev);
    expect(ran).toHaveBeenCalled();
    expect(events.some((e) => e.type === "text_delta" && e.text === "two")).toBe(true);
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
