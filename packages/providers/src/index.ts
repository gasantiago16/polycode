import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { Provider } from "@polycode/core";
import { createAiSdkProvider } from "./ai-sdk-provider.js";
import {
  CATALOG,
  CATALOG_UPDATED,
  PROVIDER_IDS,
  catalogEntry,
  formatCatalog,
  isProviderId,
  type CatalogEntry,
  type ProviderId,
} from "./catalog.js";
import { assertAllowedModel, getPolicy, resetPolicy, setPolicy } from "./policy.js";

export type { ProviderId } from "./catalog.js";
export type { ProviderPolicy } from "./policy.js";
export {
  CATALOG,
  CATALOG_UPDATED,
  PROVIDER_IDS,
  catalogEntry,
  formatCatalog,
  isProviderId,
} from "./catalog.js";
export { assertAllowedModel, getPolicy, resetPolicy, setPolicy, isTrainingTier } from "./policy.js";

export interface ProviderSpec {
  provider: string;
  model: string;
}

export interface CustomProvider {
  id: string;
  baseURL: string;
  envKey: string;
  models?: string[];
}

export interface ProvidersRuntime {
  allowTrainingTiers: boolean;
  allowedProviders?: string[] | null;
  custom: CustomProvider[];
}

let customProviders: CustomProvider[] = [];

export function configureProviders(cfg: Partial<ProvidersRuntime>): void {
  if (cfg.custom) customProviders = cfg.custom;
  setPolicy({
    allowTrainingTiers: cfg.allowTrainingTiers,
    allowedProviders: cfg.allowedProviders,
  });
}

export function resetProviderRuntime(): void {
  customProviders = [];
  resetPolicy();
}

function customEntry(id: string): CustomProvider | undefined {
  return customProviders.find((c) => c.id === id);
}

function envFirst(keys: string[]): string | undefined {
  for (const k of keys) {
    const v = process.env[k];
    if (v) return v;
  }
  return undefined;
}

function resolveBaseURL(entry: CatalogEntry): string | undefined {
  if (entry.baseURLEnv && process.env[entry.baseURLEnv]) return process.env[entry.baseURLEnv];
  return entry.baseURL;
}

export function makeProvider(spec: ProviderSpec): Provider {
  assertAllowedModel(spec.provider, spec.model);

  const custom = customEntry(spec.provider);
  if (custom) {
    const openai = createOpenAI({
      apiKey: process.env[custom.envKey],
      baseURL: custom.baseURL,
    });
    const caps = catalogEntry("openai")!.capabilities;
    return createAiSdkProvider({
      id: custom.id,
      modelId: spec.model,
      model: openai(spec.model),
      capabilities: caps,
    });
  }

  const entry = catalogEntry(spec.provider);
  if (!entry) {
    throw new Error(
      `unknown provider "${spec.provider}". Known: ${PROVIDER_IDS.join(", ")} (plus config providers.custom).`,
    );
  }

  const apiKey = envFirst(entry.envKeys);
  const baseURL = resolveBaseURL(entry);

  switch (entry.kind) {
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return createAiSdkProvider({
        id: entry.id,
        modelId: spec.model,
        model: openai(spec.model),
        capabilities: entry.capabilities,
      });
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey });
      return createAiSdkProvider({
        id: entry.id,
        modelId: spec.model,
        model: google(spec.model),
        capabilities: entry.capabilities,
      });
    }
    case "xai": {
      const xai = createXai({ apiKey });
      return createAiSdkProvider({
        id: entry.id,
        modelId: spec.model,
        model: xai(spec.model),
        capabilities: entry.capabilities,
      });
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return createAiSdkProvider({
        id: entry.id,
        modelId: spec.model,
        model: anthropic(spec.model),
        capabilities: entry.capabilities,
      });
    }
    case "openai-compat": {
      const openai = createOpenAI({ apiKey, baseURL });
      return createAiSdkProvider({
        id: entry.id,
        modelId: spec.model,
        model: openai(spec.model),
        capabilities: entry.capabilities,
      });
    }
    default:
      throw new Error(`unhandled adapter kind for ${entry.id}`);
  }
}

/** Parse a "provider:model" string from the CLI / `/model` command. */
export function parseModelArg(arg: string): ProviderSpec {
  const [provider, ...rest] = arg.split(":");
  const model = rest.join(":");
  if (!provider || !model) {
    throw new Error(`expected "<provider>:<model>", got "${arg}"`);
  }
  if (!isProviderId(provider) && !customEntry(provider)) {
    throw new Error(
      `unknown provider "${provider}". Known: ${PROVIDER_IDS.join(", ")}. Example: nvidia:nvidia/nemotron-3-nano-30b-a3b`,
    );
  }
  return { provider, model };
}

export function defaultModel(provider: string, tier: "cheap" | "strong" | "long" = "cheap"): string {
  return catalogEntry(provider)?.defaultModels[tier] ?? "unknown";
}

/** Test helper: the OpenAI-compat client options we would use (no network). */
export function resolvedCompatEndpoint(provider: string): { baseURL?: string; envKeys: string[] } | null {
  const custom = customEntry(provider);
  if (custom) return { baseURL: custom.baseURL, envKeys: [custom.envKey] };
  const entry = catalogEntry(provider);
  if (!entry || entry.kind !== "openai-compat") return null;
  return { baseURL: resolveBaseURL(entry), envKeys: entry.envKeys };
}

export { createAiSdkProvider } from "./ai-sdk-provider.js";
