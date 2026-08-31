export interface Spec {
  provider: string;
  model: string;
}

/**
 * Choose the starting model. Tiers win when their provider has a key; otherwise
 * the first configured provider is used (so a Grok-only or Muse-only setup
 * is not stuck on the settings screen forever).
 */
export function pickStartingSpec(
  have: string[],
  tiers: { cheap: Spec; strong: Spec; long: Spec },
  forced?: Spec,
  specForProvider?: (provider: string) => Spec,
): Spec | null {
  const set = new Set(have);
  if (forced && set.has(forced.provider)) return forced;
  for (const t of [tiers.strong, tiers.cheap, tiers.long]) {
    if (set.has(t.provider)) return t;
  }
  const first = have[0];
  if (!first) return null;
  return specForProvider?.(first) ?? { provider: first, model: "unknown" };
}
