import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { PermissionClass } from "@polycode/core";

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  permission?: PermissionClass;
  /**
   * Permit npx/npm/yarn/bunx as `command`. Default false — those download and
   * execute packages from the public registry.
   */
  allowRegistry?: boolean;
}

export interface McpFile {
  mcpServers?: Record<string, McpServerConfig>;
}

export function loadMcpConfig(cwd: string): Record<string, McpServerConfig> {
  const files = [
    join(cwd, ".polycode", "mcp.json"),
    join(process.env.POLYCODE_CONFIG_DIR ?? join(homedir(), ".config", "polycode"), "mcp.json"),
  ];
  const out: Record<string, McpServerConfig> = {};
  // user first, project overrides
  for (const f of [...files].reverse()) {
    if (!existsSync(f)) continue;
    try {
      const j = JSON.parse(readFileSync(f, "utf8")) as McpFile;
      Object.assign(out, j.mcpServers ?? {});
    } catch (e) {
      console.error(`mcp: failed to parse ${f}: ${e}`);
    }
  }
  return out;
}

export function sanitizeSegment(s: string): string {
  const t = s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return t || "unnamed";
}

export function mcpToolName(server: string, tool: string): string {
  return `mcp__${sanitizeSegment(server)}__${sanitizeSegment(tool)}`;
}

const REGISTRY_BINS = new Set([
  "npx",
  "npm",
  "pnpm",
  "pnpx",
  "yarn",
  "yarnpkg",
  "bunx",
  "corepack",
]);

/** True when `command` is a registry runner (npx, npm, …). */
export function isRegistrySpawnCommand(command: string): boolean {
  const base = basename(command.replace(/\\/g, "/")).toLowerCase();
  const name = base.replace(/\.(cmd|exe|bat|ps1)$/i, "");
  return REGISTRY_BINS.has(name);
}

/** Throw unless the command is a local binary or the caller opted into registry spawn. */
export function assertSafeMcpCommand(cfg: McpServerConfig, allowRegistrySpawns = false): void {
  if (!cfg.command || !isRegistrySpawnCommand(cfg.command)) return;
  if (allowRegistrySpawns && cfg.allowRegistry === true) return;
  throw new Error(
    `refusing ${basename(cfg.command)} (public-registry execute). Point command at a local binary. ` +
      `To override, set allowRegistry on this server and connect with allowRegistrySpawns.`,
  );
}
