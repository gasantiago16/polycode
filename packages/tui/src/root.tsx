import React, { useState } from "react";
import { Text } from "ink";
import { App } from "./app.js";
import { Setup } from "./setup.js";
import { configured, hydrateEnv } from "@polycode/secrets";
import type { Provider, Sandbox, ToolSpec } from "@polycode/core";

export interface Spec {
  provider: string;
  model: string;
}

export interface RootProps {
  tiers: { cheap: Spec; strong: Spec; long: Spec };
  forced?: Spec;
  tools: ToolSpec[];
  sandbox: Sandbox;
  system?: string;
  /** Build a Provider for an initial tier spec. */
  buildProvider: (spec: Spec) => Provider;
  /** Build a Provider from a "provider:model" arg (for /model). */
  onModelSwitch: (arg: string) => Provider;
  /** Classify a turn → tier Provider (smart routing). */
  route?: (text: string) => Promise<{ provider: Provider; tier: string; label: string }>;
  /** Start with per-turn auto-routing enabled. */
  autoRoute?: boolean;
}

/** Orchestrates first-run setup vs. the main app. */
export function Root(props: RootProps) {
  const [mode, setMode] = useState<"setup" | "app">(configured().length ? "app" : "setup");

  if (mode === "setup") {
    return (
      <Setup
        onDone={() => {
          hydrateEnv();
          setMode("app");
        }}
      />
    );
  }

  const spec = pickSpec(props);
  if (!spec) {
    // configured() came back empty (e.g. all keys removed) — go (back) to setup
    return <Setup onDone={() => setMode("app")} />;
  }

  hydrateEnv();
  let provider: Provider;
  try {
    provider = props.buildProvider(spec);
  } catch (e) {
    return <Text color="red">failed to build provider: {String(e)}</Text>;
  }

  return (
    <App
      provider={provider}
      tools={props.tools}
      sandbox={props.sandbox}
      system={props.system}
      onModelSwitch={props.onModelSwitch}
      onLogin={() => setMode("setup")}
      route={props.route}
      autoRoute={props.autoRoute}
    />
  );
}

/** Prefer --model, else the first tier whose provider has a configured key. */
function pickSpec(props: RootProps): Spec | null {
  const have = new Set(configured() as string[]);
  if (props.forced && have.has(props.forced.provider)) return props.forced;
  for (const t of [props.tiers.strong, props.tiers.cheap, props.tiers.long]) {
    if (have.has(t.provider)) return t;
  }
  return null;
}
