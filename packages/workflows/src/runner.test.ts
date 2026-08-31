import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  BudgetError,
  expandVars,
  parseWorkflowArgs,
  parseWorkflowFile,
  runParallel,
  runSequential,
  runWorkflowFile,
  type WorkflowHost,
} from "./index.js";
import { deepResearchWorkflow } from "./deep-research.js";
import { loadWorkflows } from "./load.js";

describe("expandVars", () => {
  it("substitutes $names", () => {
    expect(expandVars("q=$query slug=$slug", { query: "hi", slug: "hi" })).toBe("q=hi slug=hi");
  });
});

describe("parseWorkflowArgs", () => {
  it("treats leftover tokens as $query", () => {
    expect(parseWorkflowArgs("landing burn")).toEqual({ query: "landing burn" });
  });
  it("parses key=value and leftover query", () => {
    expect(parseWorkflowArgs("slug=x the rest")).toEqual({ slug: "x", query: "the rest" });
  });
});

describe("runParallel / budget", () => {
  it("rejects a panel that would exceed the cap", async () => {
    const host: WorkflowHost = {
      agent: async (j) => ({ output: j.description }),
    };
    await expect(
      runParallel(host, [{ description: "a", prompt: "a" }, { description: "b", prompt: "b" }], {
        total: 1,
        spent: 0,
      }),
    ).rejects.toBeInstanceOf(BudgetError);
  });
  it("runs jobs and counts against the budget", async () => {
    const host: WorkflowHost = {
      agent: async (j) => ({ output: j.prompt }),
    };
    const budget = { total: 4, spent: 0 };
    const parts = await runParallel(
      host,
      [{ description: "a", prompt: "A" }, { description: "b", prompt: "B" }],
      budget,
    );
    expect(parts.map((p) => p.output)).toEqual(["A", "B"]);
    expect(budget.spent).toBe(2);
  });
});

describe("runSequential", () => {
  it("runs one after another and stops when the budget is spent", async () => {
    const seen: string[] = [];
    const host: WorkflowHost = {
      agent: async (j) => {
        seen.push(j.description);
        return { output: j.prompt };
      },
    };
    const budget = { total: 2, spent: 0 };
    await expect(
      runSequential(
        host,
        [
          { description: "a", prompt: "A" },
          { description: "b", prompt: "B" },
          { description: "c", prompt: "C" },
        ],
        budget,
      ),
    ).rejects.toBeInstanceOf(BudgetError);
    expect(seen).toEqual(["a", "b"]);
  });
});

describe("runWorkflowFile steps", () => {
  it("runs parallel then sequential then synthesize with $results", async () => {
    const seen: string[] = [];
    const host: WorkflowHost = {
      agent: async (j) => {
        seen.push(`${j.subagent_type ?? "?"}:${j.description}`);
        return { output: `ok:${j.description}` };
      },
    };
    const r = await runWorkflowFile(
      host,
      {
        name: "pipe",
        budget: 8,
        parallel: [{ description: "p", prompt: "P", subagent_type: "explore" }],
        steps: [{ description: "s", prompt: "use $results", subagent_type: "general" }],
        synthesize: { prompt: "wrap $results", subagent_type: "general" },
      },
      {},
    );
    expect(r.parts).toHaveLength(2);
    expect(r.synthesis?.output).toContain("ok:synthesize");
    expect(seen).toEqual(["explore:p", "general:s", "general:synthesize"]);
  });
});

describe("deepResearchWorkflow", () => {
  it("fans out 3 researchers then synthesizes", async () => {
    const seen: string[] = [];
    const host: WorkflowHost = {
      agent: async (j) => {
        seen.push(`${j.subagent_type}:${j.description}`);
        return { output: `ok:${j.description}` };
      },
    };
    const r = await runWorkflowFile(host, deepResearchWorkflow(), {
      query: "landing burn",
      slug: "landing-burn",
    });
    expect(r.parts).toHaveLength(3);
    expect(r.synthesis?.output).toContain("ok:synthesize");
    expect(seen.filter((s) => s.startsWith("researcher:")).length).toBe(3);
  });
});

describe("loadWorkflows", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("parses a file and lets project JSON override bundled names", () => {
    expect(parseWorkflowFile({ name: "" })).toBeNull();
    const root = join(tmpdir(), `poly-wf-${Date.now()}`);
    dirs.push(root);
    mkdirSync(join(root, ".polycode", "workflows"), { recursive: true });
    writeFileSync(
      join(root, ".polycode", "workflows", "deep-research.json"),
      JSON.stringify({
        name: "deep-research",
        description: "project override",
        steps: [{ description: "one", prompt: "$query" }],
      }),
    );
    writeFileSync(join(root, ".polycode", "workflows", "broken.json"), "{");
    const loaded = loadWorkflows(root);
    const dr = loaded.find((w) => w.name === "deep-research");
    expect(dr?.source).toBe("project");
    expect(dr?.description).toBe("project override");
    expect(loaded.some((w) => w.name === "broken")).toBe(false);
  });
});
