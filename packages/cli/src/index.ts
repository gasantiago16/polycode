import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { makeProvider, parseModelArg, type ProviderSpec } from "@polycode/providers";
import type { RouterConfig, Tier } from "@polycode/router";
import { hydrateEnv } from "@polycode/secrets";
import { tools } from "@polycode/tools";
import { startTui, type Spec } from "@polycode/tui";

const DEFAULT_CONFIG: RouterConfig = {
  tiers: {
    cheap: { provider: "google", model: "gemini-2.5-flash" },
    strong: { provider: "openai", model: "gpt-5.5" },
    long: { provider: "google", model: "gemini-2.5-pro" },
  },
  system:
    "You are polycode, a terminal coding agent. Be concise. Use tools to inspect and edit the project.",
};

function loadConfig(): RouterConfig {
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
      serve: { type: "boolean" },
      port: { type: "string" },
    },
    allowPositionals: true,
  });

  // Pull keys from the OS keychain / file store into the env the SDK reads.
  hydrateEnv();

  const cfg = loadConfig();
  const cwd = process.cwd();

  if (values.serve) {
    const { startServer } = await import("@polycode/server");
    startServer({ cfg, port: Number(values.port ?? 8787), cwd });
    return;
  }

  // Optional forced starting model: --model wins, else --tier, else Root auto-picks.
  const forced: Spec | undefined = values.model
    ? parseModelArg(values.model)
    : values.tier
      ? cfg.tiers[values.tier as Tier]
      : undefined;

  startTui({
    tiers: cfg.tiers,
    forced,
    tools,
    cwd,
    system: cfg.system,
    buildProvider: (spec) => makeProvider(spec as ProviderSpec),
    onModelSwitch: (arg) => makeProvider(parseModelArg(arg)),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
