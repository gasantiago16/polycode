import { appendMemory, readMemory, replaceMemory, MEMORY_PATH, type ToolSpec } from "@polycode/core";

export const memory: ToolSpec = {
  name: "memory",
  description:
    `Read, append, or replace curated project memory at ${MEMORY_PATH}. Use for durable facts, decisions, and conventions worth remembering next session. Never dump transcripts, secrets, or raw tool output. Keep entries short.`,
  permission: "mutating",
  parallelSafe: false,
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["read", "append", "replace"] },
      content: { type: "string", description: "Note text (required for append/replace)" },
    },
    required: ["action"],
    additionalProperties: false,
  },
  async run(input: { action: string; content?: string }, ctx) {
    const action = (input.action ?? "").trim().toLowerCase();
    if (action === "read") {
      const body = await readMemory(ctx.sandbox);
      return { output: body.trim() ? body : `(empty ${MEMORY_PATH})` };
    }
    if (action === "append") {
      try {
        const r = await appendMemory(ctx.sandbox, String(input.content ?? ""));
        return { output: `appended to ${r.path} (${r.bytes} bytes)` };
      } catch (e) {
        return { output: String(e), isError: true };
      }
    }
    if (action === "replace") {
      try {
        const r = await replaceMemory(ctx.sandbox, String(input.content ?? ""));
        return { output: `wrote ${r.path} (${r.bytes} bytes)` };
      } catch (e) {
        return { output: String(e), isError: true };
      }
    }
    return { output: `unknown memory action "${input.action}" (use read|append|replace)`, isError: true };
  },
};
