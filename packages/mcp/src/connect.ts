import { assertPublicHttpUrl, childProcessEnv, type PermissionClass } from "@polycode/core";
import { assertSafeMcpCommand, type McpServerConfig } from "./config.js";
import { wrapMcpTools, type McpServerStatus, type McpSession, type WrapMcpOptions } from "./wrap.js";
import type { ToolSpec } from "@polycode/core";

export interface ConnectedMcp {
  tools: ToolSpec[];
  status: McpServerStatus[];
  close(): Promise<void>;
}

const CONNECT_MS = 12_000;

async function connectOne(
  name: string,
  cfg: McpServerConfig,
  wrapOpts?: WrapMcpOptions & { allowRegistrySpawns?: boolean },
): Promise<{ session: McpSession; tools: ToolSpec[] }> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const client = new Client({ name: "polycode", version: "0.1.0" });

  if (cfg.url) {
    await assertPublicHttpUrl(cfg.url);
    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    );
    const headers = cfg.headers ?? {};
    const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
      requestInit: { headers },
    });
    await withTimeout(client.connect(transport), CONNECT_MS, `mcp ${name} http connect`);
  } else if (cfg.command) {
    assertSafeMcpCommand(cfg, wrapOpts?.allowRegistrySpawns === true);
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const transport = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: childProcessEnv(cfg.env) as Record<string, string>,
      cwd: cfg.cwd,
      stderr: "pipe",
    });
    await withTimeout(client.connect(transport), CONNECT_MS, `mcp ${name} stdio connect`);
  } else {
    throw new Error("mcp server needs command or url");
  }

  const listed = await withTimeout(client.listTools(), CONNECT_MS, `mcp ${name} listTools`);
  const session: McpSession = {
    async listTools() {
      return listed;
    },
    async callTool(toolName, args) {
      return client.callTool({ name: toolName, arguments: (args ?? {}) as Record<string, unknown> });
    },
    async close() {
      await client.close();
    },
  };
  return { session, tools: wrapMcpTools(name, listed.tools ?? [], session, cfg, wrapOpts) };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Connect every configured server. Failures are skipped (fail-soft). */
export async function connectMcpServers(
  servers: Record<string, McpServerConfig>,
  opts?: WrapMcpOptions & { allowRegistrySpawns?: boolean },
): Promise<ConnectedMcp> {
  const tools: ToolSpec[] = [];
  const status: McpServerStatus[] = [];
  const sessions: McpSession[] = [];

  for (const [name, cfg] of Object.entries(servers)) {
    try {
      const c = await connectOne(name, cfg, opts);
      sessions.push(c.session);
      tools.push(...c.tools);
      status.push({ name, ok: true, tools: c.tools.map((t) => t.name) });
    } catch (e) {
      const msg = String(e);
      console.error(`mcp: ${name} skipped — ${msg}`);
      status.push({ name, ok: false, tools: [], error: msg });
    }
  }

  return {
    tools,
    status,
    async close() {
      await Promise.all(sessions.map((s) => s.close().catch(() => undefined)));
    },
  };
}

export type { PermissionClass };
