import type { ToolSpec } from "@polycode/core";
import { mcpToolName, type McpServerConfig } from "./config.js";

export interface ListedMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpSession {
  listTools(): Promise<{ tools: ListedMcpTool[] }>;
  callTool(name: string, args: unknown): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpServerStatus {
  name: string;
  ok: boolean;
  tools: string[];
  error?: string;
}

function stringifyResult(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  try {
    const o = raw as { content?: unknown };
    if (Array.isArray(o.content)) {
      return o.content
        .map((p) => {
          if (p && typeof p === "object" && "text" in p) return String((p as { text: string }).text);
          return JSON.stringify(p);
        })
        .join("\n");
    }
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(raw);
  }
}

const DEFERRED_SCHEMAS = new WeakMap<ToolSpec, Record<string, unknown>>();

export interface WrapMcpOptions {
  /** Stub `parameters` until mcp_search or first call (default true). */
  deferSchema?: boolean;
}

export function hydrateMcpTool(spec: ToolSpec): boolean {
  const full = DEFERRED_SCHEMAS.get(spec);
  if (!full) {
    spec.schemaDeferred = false;
    return false;
  }
  spec.parameters = full;
  spec.schemaDeferred = false;
  DEFERRED_SCHEMAS.delete(spec);
  return true;
}

export function wrapMcpTools(
  server: string,
  tools: ListedMcpTool[],
  session: McpSession,
  cfg: McpServerConfig,
  opts?: WrapMcpOptions,
): ToolSpec[] {
  const permission = cfg.permission ?? "dangerous";
  const defer = opts?.deferSchema !== false;
  return tools.map((t) => {
    const name = mcpToolName(server, t.name);
    const parameters =
      t.inputSchema && typeof t.inputSchema === "object"
        ? t.inputSchema
        : { type: "object", additionalProperties: true };
    const spec: ToolSpec = {
      name,
      description: `[mcp:${server}] ${t.description ?? t.name}`,
      permission,
      parallelSafe: false,
      parameters,
      async run(input) {
        hydrateMcpTool(spec);
        try {
          const raw = await session.callTool(t.name, input ?? {});
          return { output: stringifyResult(raw).slice(0, 60_000) || "(empty MCP result)" };
        } catch (e) {
          return { output: `mcp ${server}/${t.name}: ${String(e)}`, isError: true };
        }
      },
    };
    if (defer) {
      DEFERRED_SCHEMAS.set(spec, parameters);
      spec.parameters = { type: "object", additionalProperties: true };
      spec.schemaDeferred = true;
    }
    return spec;
  });
}

/** Safe tool: list or hydrate deferred MCP JSON schemas into the model context. */
export function createMcpSearchTool(mcpTools: ToolSpec[]): ToolSpec {
  return {
    name: "mcp_search",
    description:
      "Load full JSON input schemas for MCP tools (mcp__*) into context. Pass a keyword, a mcp__ name, or * (up to 8). Empty query lists names without hydrating.",
    permission: "safe",
    parallelSafe: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword, mcp__ name, or * to hydrate matches" },
        limit: { type: "number", description: "Max tools to hydrate (default 8, cap 8)" },
      },
      additionalProperties: false,
    },
    async run(input: { query?: string; limit?: number }) {
      const q = (input.query ?? "").trim().toLowerCase();
      const limit = Math.min(8, Math.max(1, Math.floor(input.limit ?? 8)));
      if (!q) {
        const lines = mcpTools.map(
          (t) => `${t.name}${t.schemaDeferred ? " (deferred)" : ""}  ${t.description}`,
        );
        return { output: lines.join("\n") || "(no MCP tools)" };
      }
      const hits = mcpTools
        .filter(
          (t) =>
            q === "*" ||
            t.name.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q),
        )
        .slice(0, limit);
      const hydrated = hits.map((t) => {
        hydrateMcpTool(t);
        return { name: t.name, description: t.description, parameters: t.parameters };
      });
      return { output: JSON.stringify(hydrated, null, 2) };
    },
  };
}
