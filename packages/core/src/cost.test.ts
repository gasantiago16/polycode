import { describe, expect, it } from "vitest";
import { compactCostUsd, costUsd, formatCost, priceFor } from "./cost.js";

describe("cost", () => {
  it("uses Muse contributor rates for training-tier ids", () => {
    expect(priceFor("muse:muse-spark-1.2-contributor")).toEqual({ input: 0.1, output: 0.2 });
    expect(priceFor("muse:muse-spark-1.2").input).toBe(1.25);
  });
  it("formats a session ledger", () => {
    const text = formatCost([
      { model: "google:gemini-2.5-flash", inputTokens: 1_000_000, outputTokens: 0 },
    ]);
    expect(text).toMatch(/\$0\.1500/);
  });
  it("is zero for empty usage", () => {
    expect(costUsd({ model: "xai:grok-4.3", inputTokens: 0, outputTokens: 0 })).toBe(0);
    expect(compactCostUsd([])).toBe("$0.00");
  });
});
