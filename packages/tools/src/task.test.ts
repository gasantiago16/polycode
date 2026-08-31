import { describe, expect, it, vi } from "vitest";
import { task } from "./task.js";

describe("task tool", () => {
  it("errors when spawnChild is missing (child / nested)", async () => {
    const r = await task.run(
      { description: "x", prompt: "y" },
      { sandbox: {} as any },
    );
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/nested spawn blocked/);
  });

  it("delegates to ctx.spawnChild", async () => {
    const spawnChild = vi.fn(async () => ({ output: "ok" }));
    const r = await task.run(
      { description: "x", prompt: "y", subagent_type: "explore" },
      { sandbox: {} as any, spawnChild },
    );
    expect(r.output).toBe("ok");
    expect(spawnChild).toHaveBeenCalledWith({
      description: "x",
      prompt: "y",
      subagent_type: "explore",
    });
  });
});
