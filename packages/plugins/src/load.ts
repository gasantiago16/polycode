import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, extname } from "node:path";
import { HOOK_EVENTS, type ExtraChildDef, type HookEvent, type HookSet, type HookSpec } from "@polycode/core";
import { parseSkillMd, type Skill } from "@polycode/skills";

export interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  enabled?: boolean;
  author?: { name?: string };
}

export interface PluginMcpServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  permission?: "safe" | "mutating" | "dangerous";
}

export interface PluginLspServer {
  language: string;
  command: string;
  args?: string[];
  /** File extensions, e.g. [".ts", ".tsx"]. */
  extensions?: string[];
}

export interface LoadedPlugin {
  name: string;
  version?: string;
  description: string;
  root: string;
  source: "project" | "user";
  skills: Skill[];
  agents: ExtraChildDef[];
  hooks: HookSet;
  mcpServers: Record<string, PluginMcpServer>;
  lspServers: PluginLspServer[];
}

function readJson(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function manifestOf(root: string, fallbackName: string): PluginManifest | null {
  const raw =
    readJson(join(root, "plugin.json")) ??
    readJson(join(root, ".polycode-plugin", "plugin.json")) ??
    readJson(join(root, ".claude-plugin", "plugin.json"));
  if (!raw || typeof raw !== "object") {
    // A folder of skills/commands still counts if it has any component dirs.
    const has =
      existsSync(join(root, "skills")) ||
      existsSync(join(root, "commands")) ||
      existsSync(join(root, "agents")) ||
      existsSync(join(root, "hooks")) ||
      existsSync(join(root, "mcp.json")) ||
      existsSync(join(root, ".mcp.json"));
    if (!has) return null;
    return { name: fallbackName, description: fallbackName };
  }
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : fallbackName;
  return {
    name,
    version: typeof o.version === "string" ? o.version : undefined,
    description: typeof o.description === "string" ? o.description : name,
    enabled: o.enabled === false ? false : true,
    author: o.author && typeof o.author === "object" ? (o.author as { name?: string }) : undefined,
  };
}

function loadSkillsDir(dir: string, plugin: string): Skill[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: Skill[] = [];
  for (const name of readdirSync(dir)) {
    const skillDir = join(dir, name);
    const file = join(skillDir, "SKILL.md");
    if (!existsSync(file)) continue;
    try {
      const skill = parseSkillMd(readFileSync(file, "utf8"), skillDir, "plugin");
      if (skill) out.push(skill);
    } catch {
      /* skip */
    }
  }
  return out.map((s) => ({ ...s, name: s.name || plugin }));
}

function loadCommands(dir: string, plugin: string): Skill[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: Skill[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const file = join(dir, name);
    const raw = readFileSync(file, "utf8");
    const parsed = parseSkillMd(raw, dir, "plugin");
    if (parsed) {
      out.push(parsed);
      continue;
    }
    const stem = basename(name, ".md");
    const first = raw.split(/\r?\n/).find((l) => l.trim()) ?? stem;
    out.push({
      name: stem,
      description: first.replace(/^#+\s*/, "").slice(0, 120),
      body: raw.replaceAll("$ARGUMENTS", "$ARGUMENTS").replaceAll("$0", "$0"),
      dir,
      source: "plugin",
    });
  }
  return out;
}

function loadAgents(dir: string): ExtraChildDef[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: ExtraChildDef[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const raw = readFileSync(join(dir, name), "utf8");
    const parsed = parseSkillMd(raw, dir, "plugin");
    const stem = basename(name, extname(name));
    const body = parsed?.body ?? raw;
    const desc = parsed?.description || stem;
    const toolsLine = raw.match(/^tools:\s*(.*)$/m);
    const tools = toolsLine
      ? toolsLine[1]
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    out.push({
      name: (parsed?.name || stem).toLowerCase(),
      description: desc,
      system: body,
      tools,
    });
  }
  return out;
}

function loadHooks(root: string): HookSet {
  const raw =
    readJson(join(root, "hooks", "hooks.json")) ??
    readJson(join(root, "hooks.json"));
  if (!raw || typeof raw !== "object") return {};
  const src = (raw as { hooks?: unknown }).hooks ?? raw;
  if (!src || typeof src !== "object") return {};
  const out: HookSet = {};
  const rec = src as Record<string, unknown>;
  for (const ev of HOOK_EVENTS) {
    const list = rec[ev];
    if (!Array.isArray(list)) continue;
    const specs: HookSpec[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const command = typeof o.command === "string" ? o.command : undefined;
      if (!command) continue;
      specs.push({
        matcher: typeof o.matcher === "string" ? o.matcher : undefined,
        command: command.replaceAll("$PLUGIN_ROOT", root).replaceAll("${CLAUDE_PLUGIN_ROOT}", root),
      });
    }
    if (specs.length) out[ev as HookEvent] = specs;
  }
  return out;
}

function loadMcp(root: string, plugin: string): Record<string, PluginMcpServer> {
  const raw = readJson(join(root, "mcp.json")) ?? readJson(join(root, ".mcp.json"));
  if (!raw || typeof raw !== "object") return {};
  const servers = (raw as { mcpServers?: Record<string, PluginMcpServer> }).mcpServers ?? {};
  const out: Record<string, PluginMcpServer> = {};
  const prefix = plugin.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "plugin";
  for (const [k, v] of Object.entries(servers)) {
    if (!v || typeof v !== "object") continue;
    out[`${prefix}_${k}`] = v;
  }
  return out;
}

function loadLsp(root: string): PluginLspServer[] {
  const raw = readJson(join(root, "lsp.json")) ?? readJson(join(root, ".lsp.json"));
  if (!raw) return [];
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { servers?: unknown }).servers)
      ? (raw as { servers: unknown[] }).servers
      : [];
  const out: PluginLspServer[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.language !== "string" || typeof o.command !== "string") continue;
    out.push({
      language: o.language,
      command: o.command,
      args: Array.isArray(o.args) ? o.args.map(String) : undefined,
      extensions: Array.isArray(o.extensions) ? o.extensions.map(String) : undefined,
    });
  }
  return out;
}

function loadOne(root: string, source: "project" | "user"): LoadedPlugin | null {
  const meta = manifestOf(root, basename(root));
  if (!meta || meta.enabled === false) return null;
  const name = meta.name;
  return {
    name,
    version: meta.version,
    description: meta.description ?? name,
    root,
    source,
    skills: [...loadSkillsDir(join(root, "skills"), name), ...loadCommands(join(root, "commands"), name)],
    agents: loadAgents(join(root, "agents")),
    hooks: loadHooks(root),
    mcpServers: loadMcp(root, name),
    lspServers: loadLsp(root),
  };
}

function scan(dir: string, source: "project" | "user"): LoadedPlugin[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: LoadedPlugin[] = [];
  for (const name of readdirSync(dir)) {
    const root = join(dir, name);
    if (!statSync(root).isDirectory()) continue;
    const p = loadOne(root, source);
    if (p) out.push(p);
  }
  return out;
}

export interface LoadPluginsOptions {
  cwd: string;
  /** Plugin names to skip. */
  disable?: string[];
}

/** Project `.polycode/plugins` wins over user plugins of the same name. */
export function loadPlugins(opts: LoadPluginsOptions): LoadedPlugin[] {
  const disable = new Set((opts.disable ?? []).map((s) => s.toLowerCase()));
  const userDir = join(process.env.POLYCODE_CONFIG_DIR ?? join(homedir(), ".config", "polycode"), "plugins");
  const byName = new Map<string, LoadedPlugin>();
  for (const p of scan(userDir, "user")) {
    if (!disable.has(p.name.toLowerCase())) byName.set(p.name.toLowerCase(), p);
  }
  for (const p of scan(join(opts.cwd, ".polycode", "plugins"), "project")) {
    if (!disable.has(p.name.toLowerCase())) byName.set(p.name.toLowerCase(), p);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
