import type { ToolSpec } from "@polycode/core";
import { loadLspConfig, lspQuery, type LspAction, type LspServerConfig } from "./client.js";

export function createLspTool(root: string, extra: LspServerConfig[] = []): ToolSpec | null {
  const servers = [...loadLspConfig(root), ...extra];
  if (!servers.length) return null;
  return {
    name: "lsp",
    description:
      "Type-aware navigation via a configured language server (hover, definition, references, documentSymbol). Requires .polycode/lsp.json or a plugin lsp.json. Fail-soft if the server is missing.",
    permission: "safe",
    parallelSafe: false,
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["hover", "definition", "references", "documentSymbol"] },
        path: { type: "string", description: "Project-relative file path" },
        line: { type: "number", description: "1-based line (hover/definition/references)" },
        character: { type: "number", description: "1-based column" },
      },
      required: ["action", "path"],
      additionalProperties: false,
    },
    async run(input: { action: string; path: string; line?: number; character?: number }) {
      const action = input.action as LspAction;
      if (!["hover", "definition", "references", "documentSymbol"].includes(action)) {
        return { output: `unknown lsp action "${input.action}"`, isError: true };
      }
      try {
        const output = await lspQuery({
          root,
          servers,
          action,
          path: input.path,
          line: input.line,
          character: input.character,
        });
        const isError = output.startsWith("lsp ") && output.includes("failed");
        return { output, isError };
      } catch (e) {
        return { output: String(e), isError: true };
      }
    },
  };
}
