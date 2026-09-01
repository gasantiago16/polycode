import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  gatherContext,
  summarizePrompt,
  type CanonicalMessage,
  compileRules,
  mergeHookSets,
  registerExtraChildren,
  listExtraChildren,
  loadPersonas,
  CHILD_TYPES,
  type CompactConfig,
  type GenerateRequest,
  type HookSet,
  type PermissionMode,
} from "@polycode/core";
import {
  configureProviders,
  defaultModel,
  formatCatalog,
  makeProvider,
  parseModelArg,
  type CustomProvider,
  type ProviderSpec,
} from "@polycode/providers";
import { Router, type RouterConfig, type RoutingStrategy, type Tier } from "@polycode/router";
import {
  addGitWorktree,
  applyGitWorktree,
  createSandbox,
  listGitWorktrees,
  LocalSandbox,
  removeGitWorktree,
  resolveGitWorktree,
  type SandboxConfig,
  type SandboxKind,
} from "@polycode/sandbox";
import { loadWorkflows } from "@polycode/workflows";
import { loadGraphs } from "@polycode/graph";
import { loadPlugins } from "@polycode/plugins";
import { createLspTool } from "@polycode/lsp";
import { hydrateEnv, loadDotEnvFiles, envFileCandidates, getKey, ENV_VAR, type ProviderId } from "@polycode/secrets";
import { tools as allTools } from "@polycode/tools";
import { connectMcpServers, createMcpSearchTool, loadMcpConfig, type McpServerStatus } from "@polycode/mcp";
import { expandSkill, loadSkills, skillPromptBlock } from "@polycode/skills";
import { startTui, type Spec } from "@polycode/tui";
import { SessionStore, deriveTitle, type SessionData } from "./session.js";

type SessionCfg = {
  autoCompactThresholdPercent?: number;
  keepRecentTurns?: number;
  keepRecentToolResults?: number;
};

type AppConfig = RouterConfig & {
  sandbox?: SandboxConfig;
  session?: SessionCfg;
  profile?: string;
  allowTrainingTiers?: boolean;
  web?: boolean;
  compat?: { grokSkills?: boolean };
  providers?: { custom?: CustomProvider[]; allow?: string[] };
  permissions?: { allow?: string[]; deny?: string[] };
  hooks?: HookSet;
  mcp?: { deferSchemas?: boolean; allowRegistrySpawns?: boolean };
  plugins?: { disable?: string[] };
  statusLine?: { template?: string; command?: string };
  hosted?: {
    mode?: PermissionMode;
    host?: string;
    rateLimit?: { windowMs?: number; max?: number; concurrent?: number };
    maxBodyBytes?: number;
    maxMessageChars?: number;
    trustProxy?: boolean;
    corsOrigin?: string;
    maxTurnMs?: number;
  };
};

const DEFAULT_CONFIG: AppConfig = {
  tiers: {
    cheap: { provider: "google", model: "gemini-2.5-flash" },
    strong: { provider: "openai", model: "gpt-5.5" },
    long: { provider: "google", model: "gemini-2.5-pro" },
  },
  system:
    "You are polycode, a terminal coding agent. Be concise. Inspect with read, grep, glob, and ls — glob returns a file count, so do not use bash to list, find, or count files (bash prompts in ask mode and Unix tools like wc fail on Windows). bash is for tests/builds. When work splits, call several task tools in one turn so they run in parallel: explore/researcher for read-only surveys, isolation=worktree for implementers. background=true returns an id (task_wait collects). resume_from continues a finished child. persona= applies .polycode/personas. Depth 1. Summarize child returns; do not paste raw dumps.",
};

function loadConfig(): AppConfig {
  const candidates = [
    join(process.cwd(), "polycode.config.json"),
    join(homedir(), ".config", "polycode", "config.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(p, "utf8")) };
      } catch (e) {
        console.error(`failed to parse ${p}: ${e}`);
      }
    }
  }
  return DEFAULT_CONFIG;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      model: { type: "string" }, // "openai:gpt-5.5" | "google:gemini-2.5-pro" | "xai:grok-4.3"
      tier: { type: "string" }, // cheap | strong | long
      routing: { type: "string" }, // heuristic | model (overrides config)
      sandbox: { type: "string" }, // local | docker (overrides config)
      serve: { type: "boolean" },
      port: { type: "string" },
      host: { type: "string" },
      continue: { type: "boolean" }, // resume the most recent session in this project
      resume: { type: "string" }, // resume a specific session id
      sessions: { type: "boolean" }, // list saved sessions and exit
      models: { type: "boolean" }, // print the provider catalog and exit
      insecure: { type: "boolean" }, // hosted: skip bearer auth (local scaffold only)
    },
    allowPositionals: true,
  });

  loadDotEnvFiles(envFileCandidates(process.cwd()));
  hydrateEnv();

  const cfg = loadConfig();
  if (values.routing) {
    cfg.routing = { ...cfg.routing, strategy: values.routing as RoutingStrategy };
  }
  if (cfg.profile === "company") {
    cfg.allowTrainingTiers = false;
    cfg.sandbox = { ...cfg.sandbox, kind: "docker", network: false };
    const want = cfg.hosted?.mode;
    cfg.hosted = {
      ...cfg.hosted,
      mode: want === "acceptEdits" ? "acceptEdits" : "plan",
    };
  }
  configureProviders({
    allowTrainingTiers: cfg.allowTrainingTiers === true,
    allowedProviders: cfg.providers?.allow ?? null,
    custom: cfg.providers?.custom ?? [],
  });
  if (values.models) {
    console.log(formatCatalog());
    for (const c of cfg.providers?.custom ?? []) {
      console.log(`custom     openai-compat   ${c.id}  ${c.baseURL}`);
    }
    return;
  }
  const cwd = process.cwd();
  const store = new SessionStore(cwd);
  const insecure = values.insecure === true;
  const inDocker = existsSync("/.dockerenv");
  const serveHost =
    values.host ??
    cfg.hosted?.host ??
    process.env.POLYCODE_HOST ??
    (inDocker ? "0.0.0.0" : "127.0.0.1");
  const loopbackHost = serveHost === "127.0.0.1" || serveHost === "localhost" || serveHost === "::1";
  if (values.serve && !insecure && !loopbackHost) {
    cfg.sandbox = { ...cfg.sandbox, kind: "docker", network: false };
  }

  // `--sessions`: list saved transcripts for this project and exit.
  if (values.sessions) {
    const metas = store.list();
    if (!metas.length) console.log("no sessions in this project");
    else for (const m of metas) console.log(`${m.id}  ${m.model.padEnd(22)}  ${m.title}`);
    return;
  }

  const sandbox = await buildSandbox(cfg, values.sandbox as SandboxKind | undefined, cwd);

  const webEnabled = cfg.web !== false;
  const tools = [
    ...(webEnabled ? allTools : allTools.filter((t) => t.name !== "web_fetch" && t.name !== "web_search")),
  ];

  const plugins = loadPlugins({ cwd, disable: cfg.plugins?.disable });
  registerExtraChildren(plugins.flatMap((p) => p.agents));
  const pluginHooks = mergeHookSets(...plugins.map((p) => p.hooks));
  const hooks = mergeHookSets(cfg.hooks, pluginHooks);
  const lsp = createLspTool(
    cwd,
    plugins.flatMap((p) => p.lspServers),
  );
  if (lsp) tools.push(lsp);

  let mcpStatus: McpServerStatus[] = [];
  let mcpClose: () => Promise<void> = async () => {};
  const mcpServers = {
    ...loadMcpConfig(cwd),
    ...Object.assign({}, ...plugins.map((p) => p.mcpServers)),
  };
  const deferMcp = cfg.mcp?.deferSchemas !== false;
  if (Object.keys(mcpServers).length) {
    const mcp = await connectMcpServers(mcpServers, {
      deferSchema: deferMcp,
      allowRegistrySpawns: cfg.profile === "company" ? false : cfg.mcp?.allowRegistrySpawns === true,
    });
    if (deferMcp && mcp.tools.length) tools.push(createMcpSearchTool(mcp.tools));
    tools.push(...mcp.tools);
    mcpStatus = mcp.status;
    mcpClose = () => mcp.close();
    process.once("exit", () => {
      void mcpClose();
    });
  }

  const grokCompat = cfg.compat?.grokSkills === true && cfg.profile !== "company";
  const skills = loadSkills({ cwd, grokCompat });
  for (const s of plugins.flatMap((p) => p.skills)) {
    if (!skills.some((x) => x.name === s.name)) skills.push(s);
  }

  // Enrich the system prompt with live project context (cwd, git, file tree,
  // CLAUDE.md/AGENTS.md) so the agent starts grounded instead of blind.
  let system = cfg.system ?? "";
  try {
    const projectContext = await gatherContext({ cwd, sandbox });
    if (projectContext) system = system ? `${system}\n\n${projectContext}` : projectContext;
  } catch {
    /* fall back to the base system prompt */
  }
  const listing = skillPromptBlock(skills);
  if (listing) system = system ? `${system}\n\n${listing}` : listing;
  const extraAgents = listExtraChildren();
  if (extraAgents.length) {
    const block = `<plugin_agents>\n${extraAgents.map((a) => `- ${a.name}: ${a.description}`).join("\n")}\nUse task subagent_type with these names.\n</plugin_agents>`;
    system = system ? `${system}\n\n${block}` : block;
  }
  if (deferMcp && tools.some((t) => t.schemaDeferred)) {
    const note =
      "MCP tools (mcp__*) start with stub input schemas to save context. Call mcp_search with a tool name or keyword to load the full JSON schema before using them. The first call also hydrates the schema.";
    system = system ? `${system}\n\n${note}` : note;
  }

  if (values.serve) {
    const { startServer, normalizeAuthTokens } = await import("@polycode/server");
    const tokens = normalizeAuthTokens([
      process.env.POLYCODE_AUTH_TOKEN,
      ...(process.env.POLYCODE_AUTH_TOKENS?.split(/[,\s]+/) ?? []),
    ]);
    if (!tokens.length && !insecure) {
      console.error(
        "hosted mode requires POLYCODE_AUTH_TOKEN of at least 16 characters (or --insecure for local scaffold)",
      );
      process.exit(1);
    }
    if (!insecure && !loopbackHost && !String(sandbox.root).startsWith("docker:")) {
      console.error(`hosted bind ${serveHost} requires a docker sandbox (set sandbox.kind or pass --sandbox docker)`);
      process.exit(1);
    }
    startServer({
      cfg: { ...cfg, system },
      port: Number(values.port ?? 8787),
      host: serveHost,
      sandbox,
      authToken: tokens,
      insecure,
      tools,
      compact: buildCompact(cfg),
      hooks,
      ideCatalog: {
        plugins: plugins.map((p) => ({
          name: p.name,
          description: p.description,
          version: p.version,
          source: p.source,
        })),
        skills: skills.map((s) => ({ name: s.name, description: s.description, source: s.source })),
        tools: tools.map((t) => t.name),
        agents: [...CHILD_TYPES, ...listExtraChildren().map((a) => a.name)],
      },
      permissionRules: compileRules(cfg.permissions),
      mode: cfg.hosted?.mode,
      hosted: cfg.hosted,
      auditPath: join(cwd, ".polycode", "audit.jsonl"),
      openWorktree: sandbox.projectPath
        ? async () => {
            const path = await addGitWorktree(sandbox.projectPath!);
            return { sandbox: new LocalSandbox(path), path };
          }
        : undefined,
    });
    return;
  }

  // Session transcript: resume a prior conversation (--continue / --resume) or
  // start a fresh one, and persist after every turn.
  let initialMessages: CanonicalMessage[] | undefined;
  let initialTodos = undefined as SessionData["todos"];
  let initialUsage = undefined as SessionData["usage"];
  let sessionId: string | undefined;
  let createdAt: string | undefined;
  if (values.continue || values.resume) {
    const data = values.resume ? store.load(values.resume) : store.latest();
    if (data) {
      initialMessages = data.messages;
      initialTodos = data.todos;
      initialUsage = data.usage;
      sessionId = data.id;
      createdAt = data.createdAt;
    } else if (values.resume) {
      console.error(`no session "${values.resume}" in this project — starting fresh`);
    } else {
      console.error("no prior session to continue — starting fresh");
    }
  }
  const now = new Date();
  sessionId ??= store.newId(now);
  createdAt ??= now.toISOString();
  const onPersist = (
    messages: CanonicalMessage[],
    model: string,
    extra?: { todos?: SessionData["todos"]; usage?: SessionData["usage"] },
  ) => {
    try {
      store.save({
        id: sessionId!,
        createdAt: createdAt!,
        updatedAt: new Date().toISOString(),
        cwd,
        model,
        title: deriveTitle(messages),
        messages,
        todos: extra?.todos,
        usage: extra?.usage,
      });
    } catch {
      /* best-effort: never crash a turn over persistence */
    }
  };

  // Optional forced starting model: --model wins, else --tier, else Root auto-picks.
  const forced: Spec | undefined = values.model
    ? parseModelArg(values.model)
    : values.tier
      ? cfg.tiers[values.tier as Tier]
      : undefined;

  // Smart routing: enable per-turn auto-routing by default when strategy=model.
  const router = new Router(cfg);
  const route = async (text: string) => {
    const { tier, provider } = await router.route(text);
    return { provider, tier, label: `${provider.id}:${provider.model}` };
  };

  startTui({
    tiers: cfg.tiers,
    forced,
    tools,
    sandbox,
    cwd,
    system,
    buildProvider: (spec) => makeProvider(spec as ProviderSpec),
    onModelSwitch: (arg) => makeProvider(parseModelArg(arg)),
    route,
    autoRoute: router.strategy === "model",
    validate: (p) => validateKey(cfg, p),
    specForProvider: (p) => ({ provider: p, model: modelFor(cfg, p as ProviderId) }),
    personas: loadPersonas(cwd),
    onAgentic: (p) =>
      `agentic provisioning for ${p} is not wired yet — coming soon (MCP/tool flow). Use paste / import-env / open-page for now.`,
    initialMessages,
    onPersist,
    compact: buildCompact(cfg),
    permissionRules: compileRules(cfg.permissions),
    initialTodos,
    initialUsage,
    skills: skills.map((s) => ({ name: s.name, description: s.description, source: s.source })),
    resolveSkill: (name, args) => {
      const s = skills.find((x) => x.name === name);
      return s ? expandSkill(s, args) : null;
    },
    mcpStatus,
    openWorktree: sandbox.projectPath
      ? async () => {
          const path = await addGitWorktree(sandbox.projectPath!);
          return { sandbox: new LocalSandbox(path), path };
        }
      : undefined,
    hooks,
    plugins: plugins.map((p) => ({
      name: p.name,
      description: p.description,
      version: p.version,
      source: p.source,
    })),
    workflows: loadWorkflows(cwd),
    graphs: loadGraphs(cwd),
    statusLine: cfg.statusLine,
    worktreeOps: sandbox.projectPath
      ? {
          list: () => listGitWorktrees(cwd),
          apply: async (id) => {
            const path = resolveGitWorktree(cwd, id);
            if (!path) throw new Error(`no worktree "${id}" under .polycode/worktrees`);
            const r = await applyGitWorktree(cwd, path);
            return { ...r, path };
          },
          remove: async (id) => {
            const path = resolveGitWorktree(cwd, id);
            if (!path) throw new Error(`no worktree "${id}" under .polycode/worktrees`);
            await removeGitWorktree(cwd, path);
            return path;
          },
        }
      : undefined,
  });
}

function buildCompact(cfg: AppConfig): CompactConfig {
  const s = cfg.session;
  return {
    thresholdPercent: s?.autoCompactThresholdPercent ?? 85,
    keepRecentTurns: s?.keepRecentTurns ?? 8,
    keepRecentToolResults: s?.keepRecentToolResults ?? 6,
    async summarize(args) {
      const cheap = makeProvider(cfg.tiers.cheap);
      let out = "";
      for await (const ev of cheap.stream({
        system:
          "You summarize coding-agent transcripts. Keep the original task, file paths, decisions, errors, and todos. Drop raw tool dumps.",
        messages: [{ role: "user", content: [{ type: "text", text: summarizePrompt(args) }] }],
        tools: [],
        maxOutputTokens: 800,
      })) {
        if (ev.type === "text_delta") out += ev.text;
        else if (ev.type === "error") throw new Error(ev.error);
      }
      const text = out.trim();
      if (!text) throw new Error("empty compaction summary");
      return text;
    },
  };
}

/** A small model id for the provider (prefers a configured tier). */
function modelFor(cfg: AppConfig, p: ProviderId): string {
  for (const t of [cfg.tiers.cheap, cfg.tiers.strong, cfg.tiers.long]) {
    if (t.provider === p) return t.model;
  }
  return defaultModel(p, "cheap");
}

/** Validate a provider's stored key with a tiny request. */
async function validateKey(cfg: AppConfig, p: ProviderId): Promise<boolean> {
  const key = getKey(p);
  if (!key) return false;
  process.env[ENV_VAR[p]] = key; // ensure the SDK sees the freshly-saved key
  const provider = makeProvider({ provider: p, model: modelFor(cfg, p) });
  const req: GenerateRequest = {
    messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
    tools: [],
    maxOutputTokens: 4,
  };
  try {
    for await (const ev of provider.stream(req)) {
      if (ev.type === "error") return false;
      if (ev.type === "stop") return ev.reason !== "error";
    }
    return true;
  } catch {
    return false;
  }
}

/** Build the tool-execution sandbox. Explicit Docker mode always fails closed. */
async function buildSandbox(cfg: AppConfig, override: SandboxKind | undefined, root: string) {
  const kind = override ?? cfg.sandbox?.kind ?? "local";
  try {
    const sb = await createSandbox({ ...cfg.sandbox, kind, root });
    if (kind === "docker") console.error(`sandbox: docker (${sb.root})`);
    return sb;
  } catch (e) {
    if (kind === "docker") throw new Error(`docker sandbox required: ${String(e)}`);
    console.error(`sandbox: ${String(e)} — using local sandbox`);
    return createSandbox({ kind: "local", root });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
