export interface Price {
  /** USD per million input tokens */
  input: number;
  /** USD per million output tokens */
  output: number;
}

/** Pinned ballpark list prices (2026-08). Training-tier Muse is the cheap exception. */
export const DEFAULT_PRICES: Record<string, Price> = {
  openai: { input: 1.25, output: 10 },
  google: { input: 0.15, output: 0.6 },
  xai: { input: 1, output: 2 },
  muse: { input: 1.25, output: 4.25 },
  nvidia: { input: 0.2, output: 0.2 },
  qwen: { input: 0.5, output: 3 },
  anthropic: { input: 3, output: 15 },
};

export const MUSE_CONTRIBUTOR_PRICE: Price = { input: 0.1, output: 0.2 };

export interface ModelUsage {
  model: string; // provider:model
  inputTokens: number;
  outputTokens: number;
}

export function priceFor(model: string): Price {
  const [provider, id = ""] = model.split(":");
  if (/contributor/i.test(id) || /contributor/i.test(model)) return MUSE_CONTRIBUTOR_PRICE;
  return DEFAULT_PRICES[provider] ?? { input: 1, output: 2 };
}

export function costUsd(u: ModelUsage): number {
  const p = priceFor(u.model);
  return (u.inputTokens / 1_000_000) * p.input + (u.outputTokens / 1_000_000) * p.output;
}

export function compactCostUsd(rows: ModelUsage[]): string {
  const total = rows.reduce((s, r) => s + costUsd(r), 0);
  if (!rows.length) return "$0.00";
  return `$${total.toFixed(total >= 1 ? 2 : 4)}`;
}

export function formatCost(rows: ModelUsage[]): string {
  if (!rows.length) return "cost  $0.00  (no usage yet)";
  const lines = rows.map((r) => {
    const usd = costUsd(r);
    return `  ${r.model}  in ${r.inputTokens}  out ${r.outputTokens}  ~$${usd.toFixed(4)}`;
  });
  const total = rows.reduce((s, r) => s + costUsd(r), 0);
  const tin = rows.reduce((s, r) => s + r.inputTokens, 0);
  const tout = rows.reduce((s, r) => s + r.outputTokens, 0);
  return [`cost  ~$${total.toFixed(4)}  (in ${tin} / out ${tout})`, ...lines].join("\n");
}
