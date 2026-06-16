import type { Provider } from "@polycode/core";
import { makeProvider, type ProviderSpec } from "@polycode/providers";

export type Tier = "cheap" | "strong" | "long";

export interface RouterConfig {
  tiers: Record<Tier, ProviderSpec>;
  system?: string;
}

/**
 * Smart routing v0 — a cheap heuristic classifier. Swap the body for a
 * Gemini-Flash classification call if you want model-driven routing later.
 *   long   — context too big for the strong model's sweet spot
 *   strong — reasoning / multi-file / planning work
 *   cheap  — everything else (simple edits, lookups, chit-chat)
 */
export function classify(userText: string, contextTokens = 0): Tier {
  if (contextTokens > 200_000) return "long";
  const t = userText.toLowerCase();
  const hard =
    /\b(refactor|architect|design|debug|why|root cause|trace|optimi[sz]e|migrate|plan|investigate)\b/.test(
      t,
    );
  if (hard || userText.length > 600) return "strong";
  return "cheap";
}

export class Router {
  private cache = new Map<Tier, Provider>();
  constructor(private cfg: RouterConfig) {}

  /** Lazily build (and memoize) the Provider for a tier. */
  pick(tier: Tier): Provider {
    let p = this.cache.get(tier);
    if (!p) {
      p = makeProvider(this.cfg.tiers[tier]);
      this.cache.set(tier, p);
    }
    return p;
  }

  route(userText: string, contextTokens = 0): { tier: Tier; provider: Provider } {
    const tier = classify(userText, contextTokens);
    return { tier, provider: this.pick(tier) };
  }
}
