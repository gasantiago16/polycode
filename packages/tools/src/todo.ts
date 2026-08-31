import type { TodoItem, ToolSpec } from "@polycode/core";

export const todoWrite: ToolSpec = {
  name: "todo_write",
  description:
    "Replace the in-memory task list for this session. Use it to plan multi-step work and mark items in_progress / completed. Not persisted across --resume yet.",
  permission: "safe",
  parallelSafe: false,
  parameters: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            content: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
          },
          required: ["id", "content", "status"],
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
  async run(input: { items: TodoItem[] }, ctx) {
    if (!ctx.todos) return { output: "todo store unavailable", isError: true };
    const items = Array.isArray(input.items) ? input.items : [];
    ctx.todos.replace(items);
    const line = (t: TodoItem) => `- [${t.status}] ${t.id}: ${t.content}`;
    return { output: items.length ? items.map(line).join("\n") : "(empty todo list)" };
  },
};
