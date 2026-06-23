import type { Provider, GenerateRequest } from "@polycode/core";
import { makeProvider, type ProviderSpec } from "@polycode/providers";

export type Tier = "cheap" | "strong" | "long";
export type RoutingStrategy = "heuristic" | "model";

export interface RouterConfig {
  tiers: Record<Tier, ProviderSpec>;
  system?: string;
  routing?: {
    /** "heuristic" (default, free) or "model" (a cheap model picks the tier). */
    strategy?: RoutingStrategy;
    /** Model used for classification; defaults to the cheap tier. */
    classifier?: ProviderSpec;
  };
}

const LONG_TOKENS = 200_000;

// ---------------------------------------------------------------------------
// Heuristic classifier — zero-cost regex pass. Also the fallback for the model
// classifier when the classification call fails or returns garbage.
// ---------------------------------------------------------------------------
export function classify(userText: string, contextTokens = 0): Tier {
  if (contextTokens > LONG_TOKENS) return "long";
  const t = userText.toLowerCase();
  const hard =
    /\b(refactor|architect|design|debug|why|root cause|trace|optimi[sz]e|migrate|plan|investigate)\b/.test(
      t,
    );
  if (hard || userText.length > 600) return "strong";
  return "cheap";
}

export interface Classifier {
  readonly strategy: RoutingStrategy;
  classify(userText: string, contextTokens?: number): Promise<Tier>;
}

export class HeuristicClassifier implements Classifier {
  readonly strategy = "heuristic" as const;
  async classify(userText: string, contextTokens = 0): Promise<Tier> {
    return classify(userText, contextTokens);
  }
}

const CLASSIFIER_SYSTEM = [
  "You are a routing classifier for a coding agent. Pick the cheapest CAPABLE tier for the user's task.",
  "Tiers:",
  "- cheap: simple edits, file lookups, short questions, small well-scoped changes.",
  "- strong: multi-file changes, debugging, design, planning, or hard reasoning.",
  "- long: tasks that require reading very large context (whole-repo / many big files).",
  "Reply with EXACTLY one lowercase word: cheap, strong, or long. No punctuation, no explanation.",
].join("\n");

/**
 * Model-driven classifier — a cheap model labels each turn. Falls back to the
 * heuristic on any error or unparseable reply, and short-circuits huge context
 * to "long" without an API call. Results are memoized per normalized prompt.
 */
export class ModelClassifier implements Classifier {
  readonly strategy = "model" as const;
  private cache = new Map<string, Tier>();

  constructor(private provider: Provider) {}

  async classify(userText: string, contextTokens = 0): Promise<Tier> {
    if (contextTokens > LONG_TOKENS) return "long";

    const key = userText.trim().slice(0, 240).toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;

    let tier: Tier;
    try {
      const out = await drainText(this.provider, {
        system: CLASSIFIER_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Task:\n"""\n${userText.slice(0, 4000)}\n"""\n\nTier (one word):`,
              },
            ],
          },
        ],
        tools: [],
        maxOutputTokens: 8,
        reasoningEffort: "low",
      });
      tier = parseTier(out) ?? classify(userText, contextTokens);
    } catch {
      tier = classify(userText, contextTokens);
    }

    this.cache.set(key, tier);
    return tier;
  }
}

function parseTier(s: string): Tier | null {
  const m = s.toLowerCase().match(/\b(cheap|strong|long)\b/);
  return (m?.[1] as Tier) ?? null;
}

/** Run a no-tools provider turn and concatenate its text output. */
async function drainText(provider: Provider, req: GenerateRequest): Promise<string> {
  let out = "";
  for await (const ev of provider.stream(req)) {
    if (ev.type === "text_delta") out += ev.text;
    else if (ev.type === "error") throw new Error(ev.error);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Router — classifies a turn and hands back the right (memoized) Provider.
// ---------------------------------------------------------------------------
export class Router {
  private cache = new Map<Tier, Provider>();
  private classifier: Classifier;

  constructor(private cfg: RouterConfig) {
    const strategy = cfg.routing?.strategy ?? "heuristic";
    if (strategy === "model") {
      const spec = cfg.routing?.classifier ?? cfg.tiers.cheap;
      this.classifier = new ModelClassifier(makeProvider(spec));
    } else {
      this.classifier = new HeuristicClassifier();
    }
  }

  get strategy(): RoutingStrategy {
    return this.classifier.strategy;
  }

  /** Lazily build (and memoize) the Provider for a tier. */
  pick(tier: Tier): Provider {
    let p = this.cache.get(tier);
    if (!p) {
      p = makeProvider(this.cfg.tiers[tier]);
      this.cache.set(tier, p);
    }
    return p;
  }

  async route(
    userText: string,
    contextTokens = 0,
  ): Promise<{ tier: Tier; provider: Provider }> {
    const tier = await this.classifier.classify(userText, contextTokens);
    return { tier, provider: this.pick(tier) };
  }
}
