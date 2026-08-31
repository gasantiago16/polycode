import React, { useState } from "react";
import { Text } from "ink";
import { App } from "./app.js";
import { Settings } from "./settings.js";
import { pickStartingSpec, type Spec } from "./start.js";
import { configured, hydrateEnv, type ProviderId } from "@polycode/secrets";
import type {
  CanonicalMessage,
  CompactConfig,
  HookSet,
  ModelUsage,
  PermissionRule,
  Persona,
  Provider,
  Sandbox,
  TodoItem,
  ToolSpec,
} from "@polycode/core";
import type { LoadedWorkflow } from "@polycode/workflows";

export type { Spec } from "./start.js";

export interface RootProps {
  tiers: { cheap: Spec; strong: Spec; long: Spec };
  forced?: Spec;
  tools: ToolSpec[];
  sandbox: Sandbox;
  cwd: string;
  system?: string;
  buildProvider: (spec: Spec) => Provider;
  onModelSwitch: (arg: string) => Provider;
  route?: (text: string) => Promise<{ provider: Provider; tier: string; label: string }>;
  autoRoute?: boolean;
  /** Validate a provider's stored key with a tiny request. */
  validate?: (p: ProviderId) => Promise<boolean>;
  /** Agentic key-provisioning hook (MCP/tool). */
  onAgentic?: (p: ProviderId) => Promise<string> | string;
  /** Prior conversation to resume. */
  initialMessages?: CanonicalMessage[];
  /** Persist the conversation after each turn (session transcript). */
  onPersist?: (
    messages: CanonicalMessage[],
    model: string,
    extra?: { todos?: TodoItem[]; usage?: ModelUsage[] },
  ) => void;
  permissionRules?: PermissionRule[];
  initialTodos?: TodoItem[];
  initialUsage?: ModelUsage[];
  compact?: CompactConfig;
  skills?: Array<{ name: string; description: string; source: string }>;
  resolveSkill?: (name: string, args: string) => string | null;
  mcpStatus?: Array<{ name: string; ok: boolean; tools: string[]; error?: string }>;
  plugins?: Array<{ name: string; description: string; version?: string; source: string }>;
  openWorktree?: () => Promise<{ sandbox: Sandbox; path: string }>;
  hooks?: HookSet;
  workflows?: LoadedWorkflow[];
  worktreeOps?: {
    list: () => string[];
    apply: (idOrPath: string) => Promise<{ files: string[]; path: string }>;
    remove: (idOrPath: string) => Promise<string>;
  };
  statusLine?: { template?: string; command?: string };
  /** Model id to use when the only configured provider is not in a tier (e.g. Grok-only). */
  specForProvider?: (provider: string) => Spec;
  personas?: Persona[];
}

/** Orchestrates first-run / on-demand settings vs. the main app. */
export function Root(props: RootProps) {
  const [mode, setMode] = useState<"settings" | "app">(configured().length ? "app" : "settings");

  if (mode === "settings") {
    return (
      <Settings
        firstRun
        validate={props.validate}
        onAgentic={props.onAgentic}
        onDone={() => {
          hydrateEnv();
          setMode("app");
        }}
      />
    );
  }

  const spec = pickStartingSpec(
    configured() as string[],
    props.tiers,
    props.forced,
    props.specForProvider,
  );
  if (!spec) {
    return (
      <Settings
        firstRun
        validate={props.validate}
        onAgentic={props.onAgentic}
        onDone={() => {
          hydrateEnv();
          setMode("app");
        }}
      />
    );
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
      cwd={props.cwd}
      system={props.system}
      onModelSwitch={props.onModelSwitch}
      route={props.route}
      autoRoute={props.autoRoute}
      validate={props.validate}
      onAgentic={props.onAgentic}
      initialMessages={props.initialMessages}
      onPersist={props.onPersist}
      compact={props.compact}
      skills={props.skills}
      resolveSkill={props.resolveSkill}
      permissionRules={props.permissionRules}
      initialTodos={props.initialTodos}
      initialUsage={props.initialUsage}
      mcpStatus={props.mcpStatus}
      plugins={props.plugins}
      openWorktree={props.openWorktree}
      hooks={props.hooks}
      workflows={props.workflows}
      worktreeOps={props.worktreeOps}
      statusLine={props.statusLine}
      personas={props.personas}
    />
  );
}


