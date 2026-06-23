import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { makeProvider, parseModelArg, type ProviderSpec } from "@polycode/providers";
import { Router, type RouterConfig, type RoutingStrategy, type Tier } from "@polycode/router";
import { createSandbox, type SandboxConfig, type SandboxKind } from "@polycode/sandbox";
import { hydrateEnv } from "@polycode/secrets";
import { tools } from "@polycode/tools";
import { startTui, type Spec } from "@polycode/tui";

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
  const sandbox = await buildSandbox(cfg, values.sandbox as SandboxKind | undefined, cwd);

  if (values.serve) {
    const { startServer } = await import("@polycode/server");
    startServer({ cfg, port: Number(values.port ?? 8787), sandbox });
    return;
  }

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
    system: cfg.system,
    buildProvider: (spec) => makeProvider(spec as ProviderSpec),
    onModelSwitch: (arg) => makeProvider(parseModelArg(arg)),
    route,
    autoRoute: router.strategy === "model",
  });
}

/** Build the tool-execution sandbox; fall back to local if docker is unavailable. */
async function buildSandbox(cfg: AppConfig, override: SandboxKind | undefined, root: string) {
  const kind = override ?? cfg.sandbox?.kind ?? "local";
  try {
    const sb = await createSandbox({ ...cfg.sandbox, kind, root });
    if (kind === "docker") console.error(`sandbox: docker (${sb.root})`);
    return sb;
  } catch (e) {
    console.error(`sandbox: ${String(e)} — falling back to local`);
    return createSandbox({ kind: "local", root });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
