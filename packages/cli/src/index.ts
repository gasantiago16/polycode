import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gatherContext, type CanonicalMessage, type GenerateRequest } from "@polycode/core";
import { makeProvider, parseModelArg, type ProviderSpec } from "@polycode/providers";
import { Router, type RouterConfig, type RoutingStrategy, type Tier } from "@polycode/router";
import { createSandbox, type SandboxConfig, type SandboxKind } from "@polycode/sandbox";
import { hydrateEnv, getKey, ENV_VAR, type ProviderId } from "@polycode/secrets";
import { tools } from "@polycode/tools";
import { startTui, type Spec } from "@polycode/tui";
import { SessionStore, deriveTitle } from "./session.js";

type AppConfig = RouterConfig & { sandbox?: SandboxConfig };

const DEFAULT_CONFIG: AppConfig = {
  tiers: {
    cheap: { provider: "google", model: "gemini-2.5-flash" },
    strong: { provider: "openai", model: "gpt-5.5" },
    long: { provider: "google", model: "gemini-2.5-pro" },
  },
  system:
    "You are polycode, a terminal coding agent. Be concise. Use tools to inspect and edit the project.",
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
      continue: { type: "boolean" }, // resume the most recent session in this project
      resume: { type: "string" }, // resume a specific session id
      sessions: { type: "boolean" }, // list saved sessions and exit
    },
    allowPositionals: true,
  });

  // Pull keys from the OS keychain / file store into the env the SDK reads.
  hydrateEnv();

  const cfg = loadConfig();
  if (values.routing) {
    cfg.routing = { ...cfg.routing, strategy: values.routing as RoutingStrategy };
  }
  const cwd = process.cwd();
  const store = new SessionStore(cwd);

  // `--sessions`: list saved transcripts for this project and exit.
  if (values.sessions) {
    const metas = store.list();
    if (!metas.length) console.log("no sessions in this project");
    else for (const m of metas) console.log(`${m.id}  ${m.model.padEnd(22)}  ${m.title}`);
    return;
  }

  const sandbox = await buildSandbox(cfg, values.sandbox as SandboxKind | undefined, cwd);

  if (values.serve) {
    const { startServer } = await import("@polycode/server");
    startServer({ cfg, port: Number(values.port ?? 8787), sandbox });
    return;
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

  // Session transcript: resume a prior conversation (--continue / --resume) or
  // start a fresh one, and persist after every turn.
  let initialMessages: CanonicalMessage[] | undefined;
  let sessionId: string | undefined;
  let createdAt: string | undefined;
  if (values.continue || values.resume) {
    const data = values.resume ? store.load(values.resume) : store.latest();
    if (data) {
      initialMessages = data.messages;
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
  const onPersist = (messages: CanonicalMessage[], model: string) => {
    try {
      store.save({
        id: sessionId!,
        createdAt: createdAt!,
        updatedAt: new Date().toISOString(),
        cwd,
        model,
        title: deriveTitle(messages),
        messages,
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
    onAgentic: (p) =>
      `agentic provisioning for ${p} is not wired yet — coming soon (MCP/tool flow). Use paste / import-env / open-page for now.`,
    initialMessages,
    onPersist,
  });
}

/** A small model id for the provider (prefers a configured tier). */
function modelFor(cfg: AppConfig, p: ProviderId): string {
  for (const t of [cfg.tiers.cheap, cfg.tiers.strong, cfg.tiers.long]) {
    if (t.provider === p) return t.model;
  }
  const fallback: Record<ProviderId, string> = {
    openai: "gpt-5.4-mini",
    google: "gemini-2.5-flash",
    xai: "grok-4.3",
  };
  return fallback[p];
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
