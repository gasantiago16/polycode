import { describe, expect, it } from "vitest";
import { formatHookSet, mergeHookSets, runHooks } from "./hooks.js";
import type { Sandbox, ToolSpec } from "./types.js";

function sandboxWith(execImpl: Sandbox["exec"]): Sandbox {
  return {
    root: "t",
    async readFile() {
      return "";
    },
    async writeFile() {},
    exec: execImpl,
    async execFile() {
      return { stdout: "", stderr: "", code: 0 };
    },
    async *walk() {},
    async dispose() {},
  };
}

const write: ToolSpec = {
  name: "write",
  description: "",
  parameters: {},
  permission: "mutating",
  parallelSafe: false,
  async run() {
    return { output: "ok" };
  },
};

describe("runHooks", () => {
  it("PreToolUse nonzero exit blocks the tool", async () => {
    const r = await runHooks(
      { PreToolUse: [{ matcher: "write", command: "fail $FILE" }] },
      "PreToolUse",
      sandboxWith(async (cmd) => {
        expect(cmd).toContain("src/a.ts");
        return { stdout: "", stderr: "nope", code: 1 };
      }),
      { tool: write, input: { path: "src/a.ts" } },
    );
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/nope/);
  });

  it("skips hooks whose matcher does not match", async () => {
    let ran = 0;
    await runHooks(
      { PreToolUse: [{ matcher: "bash", command: "x" }] },
      "PreToolUse",
      sandboxWith(async () => {
        ran++;
        return { stdout: "", stderr: "", code: 0 };
      }),
      { tool: write, input: {} },
    );
    expect(ran).toBe(0);
  });

  it("UserPromptSubmit nonzero exit blocks the prompt", async () => {
    const r = await runHooks(
      { UserPromptSubmit: [{ command: "check $PROMPT" }] },
      "UserPromptSubmit",
      sandboxWith(async (cmd) => {
        expect(cmd).toContain("drop db");
        return { stdout: "", stderr: "blocked", code: 2 };
      }),
      { prompt: "drop db" },
    );
    expect(r.blocked).toBe(true);
  });

  it("Stop and PostToolUse never block on nonzero", async () => {
    const stop = await runHooks(
      { Stop: [{ command: "x" }] },
      "Stop",
      sandboxWith(async () => ({ stdout: "", stderr: "x", code: 1 })),
      {},
    );
    expect(stop.blocked).toBe(false);
    const post = await runHooks(
      { PostToolUse: [{ matcher: "write", command: "x $OUTPUT" }] },
      "PostToolUse",
      sandboxWith(async (cmd) => {
        expect(cmd).toContain("wrote");
        return { stdout: "", stderr: "", code: 9 };
      }),
      { tool: write, output: "wrote" },
    );
    expect(post.blocked).toBe(false);
  });

  it("SubagentStart matcher uses $SUBAGENT_TYPE", async () => {
    const cmds: string[] = [];
    await runHooks(
      { SubagentStart: [{ matcher: "review", command: "echo $SUBAGENT_TYPE $PROMPT" }] },
      "SubagentStart",
      sandboxWith(async (cmd) => {
        cmds.push(cmd);
        return { stdout: "", stderr: "", code: 0 };
      }),
      { subagentType: "review", prompt: "look" },
    );
    expect(cmds).toEqual(["echo review look"]);
  });

  it("merges hook sets in order", () => {
    const m = mergeHookSets(
      { PreToolUse: [{ command: "a" }] },
      { PreToolUse: [{ command: "b" }], Stop: [{ command: "s" }] },
    );
    expect(m.PreToolUse?.map((h) => h.command)).toEqual(["a", "b"]);
    expect(m.Stop?.map((h) => h.command)).toEqual(["s"]);
  });

  it("formats a hook set", () => {
    expect(formatHookSet(undefined)).toMatch(/no hooks/);
    expect(
      formatHookSet({
        PreToolUse: [{ matcher: "bash", command: "true" }],
        SessionStart: [{ command: "echo hi" }],
      }),
    ).toContain("PreToolUse  bash  true");
  });
});
