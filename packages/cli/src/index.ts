import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { makeProvider, parseModelArg } from "@polycode/providers";
import { Router, type RouterConfig, type Tier } from "@polycode/router";
import { tools } from "@polycode/tools";
import { startTui } from "@polycode/tui";

const DEFAULT_CONFIG: RouterConfig = {
  tiers: {
    cheap: { provider: "google", model: "gemini-2.5-flash" },
    strong: { provider: "openai", model: "gpt-5" },
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
      model: { type: "string" }, // "openai:gpt-5" | "google:gemini-2.5-pro" | "xai:grok-4"
      tier: { type: "string" }, // cheap | strong | long
      serve: { type: "boolean" },
      port: { type: "string" },
    },
    allowPositionals: true,
  });

  const cfg = loadConfig();
  const cwd = process.cwd();

  if (values.serve) {
    const { startServer } = await import("@polycode/server");
    startServer({ cfg, port: Number(values.port ?? 8787), cwd });
    return;
  }

  const router = new Router(cfg);
  const provider = values.model
    ? makeProvider(parseModelArg(values.model))
    : router.pick((values.tier as Tier) ?? "strong");

  startTui({
    provider,
    tools,
    cwd,
    system: cfg.system,
    // wires the /model command to a freshly-built Provider
    onModelSwitch: (arg) => makeProvider(parseModelArg(arg)),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
