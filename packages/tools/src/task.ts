import type { SpawnChildInput, ToolSpec } from "@polycode/core";

/** Parent-only. Children are constructed without this tool (depth 1). */
export const task: ToolSpec = {
  name: "task",
  description:
    "Delegate work to a child agent with its own context window. Types: general (default), explore (read-only), review (cranky reviewer), researcher (web), or a plugin agent name. isolation=worktree gives the child a detached git worktree (writes stay off the parent tree). Depth 1. Returns only the child's final text.",
  permission: "mutating",
  parallelSafe: false,
  parameters: {
    type: "object",
    properties: {
      description: { type: "string", description: "Short 3-5 word label shown in the UI" },
      prompt: { type: "string", description: "Full instructions for the child" },
      subagent_type: {
        type: "string",
        description: "Child kind: general|explore|review|researcher or a plugin agent (default general)",
      },
      isolation: {
        type: "string",
        enum: ["none", "worktree"],
        description: "none (default) shares the parent tree; worktree is an isolated git copy",
      },
    },
    required: ["description", "prompt"],
    additionalProperties: false,
  },
  async run(input: SpawnChildInput, ctx) {
    if (!ctx.spawnChild) {
      return { output: "task is not available in this agent (nested spawn blocked)", isError: true };
    }
    return ctx.spawnChild(input);
  },
};
