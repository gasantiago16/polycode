import { describe, expect, it } from "vitest";
import { tools } from "./index.js";
import { graphTool } from "./graph.js";

describe("graph tool", () => {
  it("is registered on the parent tool list", () => {
    expect(tools.some((t) => t.name === "graph")).toBe(true);
  });

  it("errors when spawnChild is missing", async () => {
    const r = await graphTool.run(
      { name: "demo" },
      { sandbox: { root: "/tmp", projectPath: "/tmp" } as any },
    );
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/nested spawn blocked/);
  });

  it("errors on unknown graph name", async () => {
    const r = await graphTool.run(
      { name: "nope-not-a-graph" },
      {
        sandbox: { root: process.cwd(), projectPath: process.cwd() } as any,
        spawnChild: async () => ({ output: "no" }),
      },
    );
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/unknown graph/);
  });
});
