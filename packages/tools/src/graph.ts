import type { ToolSpec } from "@polycode/core";
import {
  compileGraph,
  FileCheckpointStore,
  formatGraphProgress,
  formatGraphRun,
  hostFromSpawn,
  loadGraphs,
  newThreadId,
  runGraph,
} from "@polycode/graph";
import { join } from "node:path";

/** Parent-only. Children are constructed without this tool. */
export const graphTool: ToolSpec = {
  name: "graph",
  description:
    "Run a named agent graph (LangGraph-shaped, checkpointed). Graphs: demo (stage-safe explore), explore, research-implement, plus .polycode/graphs/*.json. Prefer this over a chain of task calls when the work is a known pipeline. resume_from continues an interrupted thread id.",
  permission: "mutating",
  parallelSafe: false,
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Graph name from /graphs (e.g. demo, explore, research-implement)" },
      query: { type: "string", description: "Task text substituted as {{query}}" },
      resume_from: { type: "string", description: "Existing thread id to resume" },
    },
    required: ["name"],
    additionalProperties: false,
  },
  async run(input: { name: string; query?: string; resume_from?: string }, ctx) {
    if (!ctx.spawnChild) {
      return { output: "graph is not available in this agent (nested spawn blocked)", isError: true };
    }
    const cwd = ctx.sandbox.projectPath ?? ctx.sandbox.root;
    if (!cwd || cwd.startsWith("docker:")) {
      return { output: "graph needs a project path (local sandbox)", isError: true };
    }
    const loaded = loadGraphs(cwd);
    const def = loaded.find((g) => g.name === input.name);
    if (!def) {
      const names = loaded.map((g) => g.name).join(", ") || "(none)";
      return { output: `unknown graph "${input.name}" (loaded: ${names})`, isError: true };
    }
    try {
      const compiled = compileGraph(def);
      const store = new FileCheckpointStore(join(cwd, ".polycode", "graph-runs"));
      const host = hostFromSpawn((job) => ctx.spawnChild!(job));
      const threadId = input.resume_from?.trim() || newThreadId();
      const progress: string[] = [];
      const cp = await runGraph({
        compiled,
        host,
        store,
        threadId,
        resume: !!input.resume_from,
        input: { query: input.query ?? "" },
        onStep: (s) => progress.push(formatGraphProgress(s)),
      });
      const trail = progress.length ? `${progress.join("\n")}\n\n` : "";
      return { output: trail + formatGraphRun(cp), isError: cp.status === "failed" };
    } catch (e) {
      return { output: String(e), isError: true };
    }
  },
};
