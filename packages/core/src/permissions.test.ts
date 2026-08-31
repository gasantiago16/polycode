import { describe, expect, it, vi } from "vitest";
import { compileRules, PermissionEngine, type PermissionChoice } from "./permissions.js";
import type { PermissionClass, ToolSpec } from "./types.js";

function tool(name: string, permission: PermissionClass): ToolSpec {
  return {
    name,
    permission,
    description: name,
    parameters: {},
    parallelSafe: permission === "safe",
    async run() { return { output: "ok" }; },
  };
}

describe("PermissionEngine", () => {
  it("allows safe tools in every mode without prompting", async () => {
    for (const mode of ["plan", "ask", "acceptEdits", "yolo"] as const) {
      const prompt = vi.fn<() => Promise<PermissionChoice>>();
      expect((await new PermissionEngine(mode, prompt).check(tool("read", "safe"), {})).allow).toBe(true);
      expect(prompt).not.toHaveBeenCalled();
    }
  });

  it("keeps plan mode read-only even after a session grant", async () => {
    const engine = new PermissionEngine("ask", async () => "always");
    expect((await engine.check(tool("write", "mutating"), {})).allow).toBe(true);
    engine.setMode("plan");
    expect(await engine.check(tool("write", "mutating"), {})).toEqual({
      allow: false,
      reason: "plan mode: read-only tools only",
    });
  });

  it("auto-allows edits but still prompts for dangerous tools", async () => {
    const prompt = vi.fn(async () => "deny" as const);
    const engine = new PermissionEngine("acceptEdits", prompt);
    expect((await engine.check(tool("edit", "mutating"), {})).allow).toBe(true);
    expect((await engine.check(tool("bash", "dangerous"), {})).allow).toBe(false);
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("remembers an always grant by tool name", async () => {
    const prompt = vi.fn(async () => "always" as const);
    const engine = new PermissionEngine("ask", prompt);
    await engine.check(tool("write", "mutating"), { path: "a" });
    await engine.check(tool("write", "mutating"), { path: "b" });
    expect(prompt).toHaveBeenCalledOnce();
    expect(engine.sessionGrants()).toEqual(["write"]);
  });

  it("allows everything in yolo mode without prompting", async () => {
    const prompt = vi.fn(async () => "deny" as const);
    expect((await new PermissionEngine("yolo", prompt).check(tool("bash", "dangerous"), {})).allow).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("deny rules beat allow and skip the prompt", async () => {
    const prompt = vi.fn(async () => "once" as const);
    const rules = compileRules({ deny: ["Bash(rm *)"], allow: ["Bash(npm test*)"] });
    const engine = new PermissionEngine("ask", prompt, rules);
    expect((await engine.check(tool("bash", "dangerous"), { command: "rm -rf /" })).allow).toBe(false);
    expect((await engine.check(tool("bash", "dangerous"), { command: "npm test" })).allow).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("treats explore/researcher task children as safe so plan can fan them out", async () => {
    const prompt = vi.fn(async () => "deny" as const);
    const engine = new PermissionEngine("plan", prompt);
    const task = tool("task", "mutating");
    expect((await engine.check(task, { subagent_type: "explore", prompt: "look" })).allow).toBe(true);
    expect((await engine.check(task, { subagent_type: "researcher", prompt: "cite" })).allow).toBe(true);
    expect((await engine.check(task, { subagent_type: "general", prompt: "edit" })).allow).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("deny rules beat the safe-class short-circuit", async () => {
    const prompt = vi.fn(async () => "once" as const);
    const engine = new PermissionEngine("plan", prompt, compileRules({ deny: ["Read"] }));
    expect((await engine.check(tool("read", "safe"), { path: "src/a.ts" })).allow).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("blocks .env writes outside yolo", async () => {
    const prompt = vi.fn(async () => "once" as const);
    const engine = new PermissionEngine("ask", prompt);
    expect(await engine.check(tool("write", "mutating"), { path: ".env" })).toEqual({
      allow: false,
      reason: "protected path (.env / .git / .polycode)",
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("blocks safe reads of .env and bash that names it", async () => {
    const prompt = vi.fn(async () => "once" as const);
    const engine = new PermissionEngine("ask", prompt);
    expect((await engine.check(tool("read", "safe"), { path: ".env" })).allow).toBe(false);
    expect((await engine.check(tool("bash", "dangerous"), { command: "cat .env" })).allow).toBe(false);
    expect((await engine.check(tool("bash", "dangerous"), { command: "python -c \"open('.env')\"" })).allow).toBe(
      false,
    );
    expect(prompt).not.toHaveBeenCalled();
  });

  it("forkIsolated ask auto-allows worktree writes and bash without prompting", async () => {
    const prompt = vi.fn(async () => "deny" as const);
    const isolated = new PermissionEngine("ask", prompt).forkIsolated();
    expect(isolated.getMode()).toBe("acceptEdits");
    expect(isolated.isSilent()).toBe(true);
    expect((await isolated.check(tool("write", "mutating"), { path: "a.ts" })).allow).toBe(true);
    expect((await isolated.check(tool("bash", "dangerous"), { command: "npm test" })).allow).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("marks the second prompt for the same tool as repeat", async () => {
    const seen: boolean[] = [];
    const engine = new PermissionEngine("ask", async (req) => {
      seen.push(!!req.repeat);
      return "once";
    });
    await engine.check(tool("bash", "dangerous"), { command: "a" });
    await engine.check(tool("bash", "dangerous"), { command: "b" });
    expect(seen).toEqual([false, true]);
  });

  it("forkSilent acceptEdits auto-allows dangerous tools without prompting", async () => {
    const prompt = vi.fn(async () => "deny" as const);
    const silent = new PermissionEngine("acceptEdits", prompt).forkSilent();
    expect(silent.isSilent()).toBe(true);
    expect((await silent.check(tool("write", "mutating"), { path: "a.ts" })).allow).toBe(true);
    expect((await silent.check(tool("bash", "dangerous"), { command: "npm test" })).allow).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("forkSilent ask becomes plan and cannot prompt", async () => {
    const prompt = vi.fn(async () => "once" as const);
    const silent = new PermissionEngine("ask", prompt).forkSilent();
    expect(silent.getMode()).toBe("plan");
    expect((await silent.check(tool("write", "mutating"), { path: "a.ts" })).allow).toBe(false);
    expect((await silent.check(tool("bash", "dangerous"), { command: "ls" })).allow).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("invalidatePrompts denies an in-flight prompt", async () => {
    let release!: (c: PermissionChoice) => void;
    const prompt = vi.fn(
      () =>
        new Promise<PermissionChoice>((r) => {
          release = r;
        }),
    );
    const engine = new PermissionEngine("ask", prompt);
    const pending = engine.check(tool("write", "mutating"), { path: "a.ts" });
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
    engine.invalidatePrompts();
    release("once");
    expect(await pending).toEqual({ allow: false, reason: "background child cannot prompt" });
  });

  it("allows .polycode/memory.md the same way as reviews", async () => {
    const prompt = vi.fn(async () => "once" as const);
    const engine = new PermissionEngine("ask", prompt);
    expect((await engine.check(tool("write", "mutating"), { path: ".polycode/memory.md" })).allow).toBe(true);
    expect(
      (await engine.check(tool("write", "mutating"), { path: ".polycode/sessions/x.json" })).allow,
    ).toBe(false);
    expect(prompt).toHaveBeenCalledOnce();
  });
});
