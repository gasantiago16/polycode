import type { ToolSpec } from "@polycode/core";

/** Parent-only. Snapshot or wait for a background child. */
export const taskWait: ToolSpec = {
  name: "task_wait",
  description:
    "List child agents, or fetch one by id. timeout_ms=0 (default) is a snapshot; >0 waits up to that many ms for completion.",
  permission: "safe",
  parallelSafe: false,
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Child id from a background task. Omit to list all." },
      timeout_ms: { type: "number", description: "Wait up to this many ms (default 0 = snapshot)" },
    },
    additionalProperties: false,
  },
  async run(input: { id?: string; timeout_ms?: number }, ctx) {
    if (!ctx.waitChild) return { output: "task_wait is parent-only", isError: true };
    const ms = typeof input.timeout_ms === "number" && input.timeout_ms > 0 ? input.timeout_ms : 0;
    return ctx.waitChild(input.id, ms);
  },
};

/** Parent-only. Abort a running background child. */
export const taskKill: ToolSpec = {
  name: "task_kill",
  description: "Abort a running background child by id.",
  permission: "mutating",
  parallelSafe: false,
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "Child id" } },
    required: ["id"],
    additionalProperties: false,
  },
  run(input: { id: string }, ctx) {
    if (!ctx.killChild) return Promise.resolve({ output: "task_kill is parent-only", isError: true });
    return Promise.resolve(ctx.killChild(input.id));
  },
};
