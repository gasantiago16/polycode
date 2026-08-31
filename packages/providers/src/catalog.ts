import type { Capabilities } from "@polycode/core";

/** Pinned 2026-08-31. Re-check live docs before treating IDs as eternal. */
export const CATALOG_UPDATED = "2026-08-31";

export const PROVIDER_IDS = [
  "openai",
  "google",
  "xai",
  "muse",
  "nvidia",
  "qwen",
  "anthropic",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type AdapterKind = "openai" | "google" | "xai" | "anthropic" | "openai-compat";

export interface CatalogEntry {
  id: ProviderId;
  kind: AdapterKind;
  label: string;
  envKeys: string[];
  keyUrl: string;
  baseURL?: string;
  /** Env var that overrides baseURL (on-prem NIM, Qwen region, etc.). */
  baseURLEnv?: string;
  defaultModels: { cheap: string; strong: string; long: string };
  capabilities: Capabilities;
}

const TOOLS: Capabilities = {
  supportsTools: true,
  supportsReasoning: true,
  supportsCaching: true,
  supportsVision: true,
  parallelTools: true,
  contextWindow: 128_000,
  maxOutput: 16_000,
};

export const CATALOG: CatalogEntry[] = [
  {
    id: "openai",
    kind: "openai",
    label: "OpenAI",
    envKeys: ["OPENAI_API_KEY"],
    keyUrl: "https://platform.openai.com/api-keys",
    defaultModels: { cheap: "gpt-5.4-mini", strong: "gpt-5.5", long: "gpt-5.5" },
    capabilities: { ...TOOLS, contextWindow: 400_000, maxOutput: 128_000 },
  },
  {
    id: "google",
    kind: "google",
    label: "Google Gemini",
    envKeys: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
    keyUrl: "https://aistudio.google.com/app/apikey",
    defaultModels: {
      cheap: "gemini-2.5-flash",
      strong: "gemini-3.1-pro",
      long: "gemini-3.1-pro",
    },
    capabilities: { ...TOOLS, contextWindow: 1_000_000, maxOutput: 64_000 },
  },
  {
    id: "xai",
    kind: "xai",
    label: "xAI (Grok)",
    envKeys: ["XAI_API_KEY"],
    keyUrl: "https://console.x.ai/",
    defaultModels: { cheap: "grok-4.3", strong: "grok-4.3", long: "grok-4.3" },
    capabilities: { ...TOOLS, contextWindow: 256_000, maxOutput: 64_000 },
  },
  {
    id: "muse",
    kind: "openai-compat",
    label: "Meta Muse",
    envKeys: ["MUSE_API_KEY", "MODEL_API_KEY"],
    keyUrl: "https://ai.developer.meta.com/",
    baseURL: "https://api.meta.ai/v1",
    baseURLEnv: "MUSE_BASE_URL",
    defaultModels: {
      cheap: "muse-spark-1.2",
      strong: "muse-spark-1.2",
      long: "muse-spark-1.2",
    },
    capabilities: { ...TOOLS, contextWindow: 1_048_576, maxOutput: 131_072 },
  },
  {
    id: "nvidia",
    kind: "openai-compat",
    label: "NVIDIA NIM",
    envKeys: ["NVIDIA_API_KEY"],
    keyUrl: "https://build.nvidia.com/",
    baseURL: "https://integrate.api.nvidia.com/v1",
    baseURLEnv: "NVIDIA_BASE_URL",
    defaultModels: {
      cheap: "nvidia/nemotron-3-nano-30b-a3b",
      strong: "nvidia/nemotron-3-super-120b-a12b",
      long: "nvidia/nemotron-3-super-120b-a12b",
    },
    capabilities: { ...TOOLS, contextWindow: 262_144, maxOutput: 32_768 },
  },
  {
    id: "qwen",
    kind: "openai-compat",
    label: "Qwen (DashScope)",
    envKeys: ["DASHSCOPE_API_KEY", "QWEN_API_KEY"],
    keyUrl: "https://modelstudio.console.alibabacloud.com/",
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    baseURLEnv: "QWEN_BASE_URL",
    defaultModels: {
      cheap: "qwen3-coder-plus",
      strong: "qwen3.8-max",
      long: "qwen3.8-max",
    },
    capabilities: { ...TOOLS, contextWindow: 262_144, maxOutput: 32_768 },
  },
  {
    id: "anthropic",
    kind: "anthropic",
    label: "Anthropic",
    envKeys: ["ANTHROPIC_API_KEY"],
    keyUrl: "https://console.anthropic.com/settings/keys",
    defaultModels: {
      cheap: "claude-sonnet-4-5",
      strong: "claude-sonnet-4-5",
      long: "claude-sonnet-4-5",
    },
    capabilities: { ...TOOLS, contextWindow: 200_000, maxOutput: 64_000 },
  },
];

export function catalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.id === id);
}

export function isProviderId(id: string): id is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(id);
}

export function formatCatalog(): string {
  const lines = [`polycode model catalog (pinned ${CATALOG_UPDATED})`, ""];
  for (const e of CATALOG) {
    lines.push(`${e.id.padEnd(10)} ${e.kind.padEnd(14)} ${e.label}`);
    lines.push(
      `           cheap  ${e.defaultModels.cheap}`,
      `           strong ${e.defaultModels.strong}`,
      `           long   ${e.defaultModels.long}`,
      `           window ${e.capabilities.contextWindow}  key ${e.envKeys.join(" | ")}`,
      "",
    );
  }
  lines.push('Switch: /model <provider:model>   e.g. nvidia:nvidia/nemotron-3-nano-30b-a3b');
  lines.push("Contributor / training-tier ids require allowTrainingTiers.");
  return lines.join("\n");
}
