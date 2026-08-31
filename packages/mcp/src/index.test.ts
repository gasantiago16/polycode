import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { assertSafeMcpCommand, isRegistrySpawnCommand, loadMcpConfig, mcpToolName } from "./config.js";
import { createMcpSearchTool, hydrateMcpTool, wrapMcpTools, type McpSession } from "./wrap.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("registry spawn guard", () => {
  it("flags npx/npm and allows a local node binary", () => {
    expect(isRegistrySpawnCommand("npx")).toBe(true);
    expect(isRegistrySpawnCommand("C:\\\\npm\\\\npx.cmd")).toBe(true);
    expect(isRegistrySpawnCommand("node")).toBe(false);
    expect(() => assertSafeMcpCommand({ command: "npx", args: ["-y", "evil"] })).toThrow(/refusing/);
    expect(() =>
      assertSafeMcpCommand({ command: "npx", allowRegistry: true }, true),
    ).not.toThrow();
  });
});

describe("mcpToolName", () => {
  it("sanitizes server and tool ids", () => {
    expect(mcpToolName("GitHub", "create-issue")).toBe("mcp__github__create_issue");
  });
});

describe("loadMcpConfig", () => {
  it("reads project mcp.json and lets it override user", () => {
    const cwd = join(tmpdir(), `poly-mcp-${Date.now()}`);
    mkdirSync(join(cwd, ".polycode"), { recursive: true });
    dirs.push(cwd);
    writeFileSync(
      join(cwd, ".polycode", "mcp.json"),
      JSON.stringify({ mcpServers: { echo: { command: "node", args: ["x.js"] } } }),
    );
    const cfg = loadMcpConfig(cwd);
    expect(cfg.echo?.command).toBe("node");
  });
});

describe("wrapMcpTools", () => {
  it("runs through the session and is dangerous by default", async () => {
    const session: McpSession = {
      async listTools() {
        return { tools: [] };
      },
      async callTool(name, args) {
        return { content: [{ type: "text", text: `${name}:${JSON.stringify(args)}` }] };
      },
      async close() {},
    };
    const [tool] = wrapMcpTools(
      "echo",
      [{ name: "ping", description: "ping", inputSchema: { type: "object", properties: { n: { type: "number" } } } }],
      session,
      {},
    );
    expect(tool.name).toBe("mcp__echo__ping");
    expect(tool.permission).toBe("dangerous");
    const r = await tool.run({ n: 1 }, { sandbox: {} as any });
    expect(r.output).toContain("ping");
    expect(r.isError).toBeFalsy();
  });

  it("stubs parameters until mcp_search or first call hydrates them", async () => {
    const session: McpSession = {
      async listTools() {
        return { tools: [] };
      },
      async callTool() {
        return { content: [{ type: "text", text: "ok" }] };
      },
      async close() {},
    };
    const schema = { type: "object", properties: { n: { type: "number" } }, required: ["n"] };
    const [tool] = wrapMcpTools("echo", [{ name: "ping", inputSchema: schema }], session, {});
    expect(tool.schemaDeferred).toBe(true);
    expect(JSON.stringify(tool.parameters)).not.toContain("required");
    const search = createMcpSearchTool([tool]);
    const listed = await search.run({ query: "" }, { sandbox: {} as any });
    expect(listed.output).toContain("(deferred)");
    const loaded = await search.run({ query: "ping" }, { sandbox: {} as any });
    expect(tool.schemaDeferred).toBeFalsy();
    expect(JSON.stringify(tool.parameters)).toContain("required");
    expect(loaded.output).toContain("mcp__echo__ping");
    const [eager] = wrapMcpTools("echo", [{ name: "ping", inputSchema: schema }], session, {}, {
      deferSchema: false,
    });
    expect(eager.schemaDeferred).toBeFalsy();
    expect(JSON.stringify(eager.parameters)).toContain("required");
    hydrateMcpTool(eager);
  });
});
