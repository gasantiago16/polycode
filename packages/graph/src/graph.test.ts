import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { compileGraph, GraphCompileError } from "./compile.js";
import { FileCheckpointStore } from "./checkpoint.js";
import { expandTemplate, mergeState } from "./reduce.js";
import { runGraph } from "./run.js";
import { parseGraphDef } from "./load.js";
import { END, START, type GraphDef, type GraphHost } from "./types.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function linear(): GraphDef {
  return {
    name: "linear",
    nodes: {
      a: { prompt: "do {{query}}" },
      b: { prompt: "then {{last}}" },
    },
    edges: [
      { from: START, to: "a" },
      { from: "a", to: "b" },
      { from: "b", to: END },
    ],
  };
}

function mockHost(replies: Record<string, string>): GraphHost {
  return {
    async agent(job) {
      const key = job.description;
      return { output: replies[key] ?? `out:${job.prompt}`, isError: false };
    },
  };
}

describe("compileGraph", () => {
  it("rejects unknown edge targets and missing START", () => {
    expect(() =>
      compileGraph({
        name: "x",
        nodes: { a: { prompt: "p" } },
        edges: [{ from: "a", to: "nope" }],
      }),
    ).toThrow(GraphCompileError);
    expect(() =>
      compileGraph({
        name: "x",
        nodes: { a: { prompt: "p" } },
        edges: [{ from: "a", to: END }],
      }),
    ).toThrow(/START/);
  });

  it("accepts a linear graph", () => {
    const c = compileGraph(linear());
    expect(c.successors(START, {})).toEqual(["a"]);
    expect(c.successors("b", {})).toEqual([END]);
  });
});

describe("reducers and templates", () => {
  it("replaces and appends", () => {
    const def: GraphDef = {
      name: "r",
      state: { last: { reducer: "replace" }, findings: { reducer: "append" } },
      nodes: { a: { prompt: "p" } },
      edges: [{ from: START, to: "a" }],
    };
    const s = mergeState(def, { last: "1", findings: [] }, { last: "2", findings: { node: "a" } });
    expect(s.last).toBe("2");
    expect(s.findings).toEqual([{ node: "a" }]);
  });

  it("expands {{query}} only", () => {
    expect(expandTemplate("Q={{query}} {{missing}}", { query: "hi" })).toBe("Q=hi ");
  });
});

describe("runGraph", () => {
  it("runs a linear graph and checkpoints", async () => {
    const dir = join(tmpdir(), `poly-graph-${Date.now()}`);
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    const store = new FileCheckpointStore(dir);
    const cp = await runGraph({
      compiled: compileGraph(linear()),
      host: mockHost({ a: "A-OUT", b: "B-OUT" }),
      store,
      threadId: "t1",
      input: { query: "task" },
    });
    expect(cp.status).toBe("completed");
    expect(cp.history.map((h) => h.node)).toEqual(["a", "b"]);
    expect(cp.state.last).toBe("B-OUT");
    expect(store.load("t1")?.status).toBe("completed");
  });

  it("pauses at interruptBefore and resumes", async () => {
    const dir = join(tmpdir(), `poly-graph-int-${Date.now()}`);
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    const store = new FileCheckpointStore(dir);
    const def = linear();
    def.interruptBefore = ["b"];
    const compiled = compileGraph(def);
    const host = mockHost({ a: "A-OUT", b: "B-OUT" });
    const first = await runGraph({ compiled, host, store, threadId: "t2", input: { query: "q" } });
    expect(first.status).toBe("interrupted");
    expect(first.next).toEqual(["b"]);
    expect(first.history.map((h) => h.node)).toEqual(["a"]);
    const second = await runGraph({ compiled, host, store, threadId: "t2", resume: true });
    expect(second.status).toBe("completed");
    expect(second.history.map((h) => h.node)).toEqual(["a", "b"]);
  });

  it("takes a conditional edge", async () => {
    const dir = join(tmpdir(), `poly-graph-if-${Date.now()}`);
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    const def: GraphDef = {
      name: "branch",
      nodes: {
        a: { prompt: "x" },
        yes: { prompt: "y" },
        no: { prompt: "n" },
      },
      edges: [
        { from: START, to: "a" },
        { from: "a", to: "yes", if: { field: "last", includes: "GO" } },
        { from: "a", to: "no" },
        { from: "yes", to: END },
        { from: "no", to: END },
      ],
    };
    const store = new FileCheckpointStore(dir);
    const cp = await runGraph({
      compiled: compileGraph(def),
      host: mockHost({ a: "please GO now", yes: "did-yes", no: "did-no" }),
      store,
      threadId: "t3",
    });
    expect(cp.history.map((h) => h.node)).toEqual(["a", "yes"]);
    expect(cp.status).toBe("completed");
  });

  it("jails thread ids", () => {
    expect(() => new FileCheckpointStore("/tmp").load("../x")).toThrow(/invalid graph thread/);
  });
});

describe("parseGraphDef", () => {
  it("parses JSON graphs", () => {
    const g = parseGraphDef({
      name: "n",
      nodes: { a: { prompt: "p", subagent_type: "explore" } },
      edges: [{ from: "__start__", to: "a" }, { from: "a", to: "__end__" }],
    });
    expect(g?.name).toBe("n");
    expect(g?.nodes.a.subagent_type).toBe("explore");
    expect(compileGraph(g!).successors(START, {})).toEqual(["a"]);
  });
});
