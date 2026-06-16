import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import type { Provider, Capabilities } from "@polycode/core";
import { createAiSdkProvider } from "./ai-sdk-provider.js";

export type ProviderId = "openai" | "google" | "xai";

export interface ProviderSpec {
  provider: ProviderId;
  model: string;
}

// Placeholder capability numbers — CONFIRM against current provider docs.
const OPENAI_CAPS: Capabilities = {
  contextWindow: 400_000,
  maxOutput: 128_000,
  supportsTools: true,
  supportsReasoning: true,
  supportsCaching: true,
  supportsVision: true,
  parallelTools: true,
};

const GEMINI_CAPS: Capabilities = {
  contextWindow: 1_000_000,
  maxOutput: 64_000,
  supportsTools: true,
  supportsReasoning: true,
  supportsCaching: true,
  supportsVision: true,
  parallelTools: true,
};

const XAI_CAPS: Capabilities = {
  contextWindow: 256_000,
  maxOutput: 64_000,
  supportsTools: true,
  supportsReasoning: true,
  supportsCaching: true,
  supportsVision: true,
  parallelTools: true,
};

export function makeProvider(spec: ProviderSpec): Provider {
  switch (spec.provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
      return createAiSdkProvider({
        id: "openai",
        modelId: spec.model,
        model: openai(spec.model),
        capabilities: OPENAI_CAPS,
      });
    }
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      });
      return createAiSdkProvider({
        id: "google",
        modelId: spec.model,
        model: google(spec.model),
        capabilities: GEMINI_CAPS,
      });
    }
    case "xai": {
      const xai = createXai({ apiKey: process.env.XAI_API_KEY });
      return createAiSdkProvider({
        id: "xai",
        modelId: spec.model,
        model: xai(spec.model),
        capabilities: XAI_CAPS,
      });
    }
    default:
      throw new Error(`unknown provider: ${(spec as ProviderSpec).provider}`);
  }
}

/** Parse a "provider:model" string from the CLI / `/model` command. */
export function parseModelArg(arg: string): ProviderSpec {
  const [provider, ...rest] = arg.split(":");
  const model = rest.join(":");
  const known: ProviderId[] = ["openai", "google", "xai"];
  if (!known.includes(provider as ProviderId) || !model) {
    throw new Error(`expected "<openai|google|xai>:<model>", got "${arg}"`);
  }
  return { provider: provider as ProviderId, model };
}

export { createAiSdkProvider } from "./ai-sdk-provider.js";
