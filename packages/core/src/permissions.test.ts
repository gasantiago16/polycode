import { describe, expect, it, vi } from "vitest";
import { PermissionEngine, type PermissionChoice } from "./permissions.js";
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
});
