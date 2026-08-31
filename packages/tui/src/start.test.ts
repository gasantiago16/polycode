import { describe, expect, it } from "vitest";
import { pickStartingSpec } from "./start.js";

const tiers = {
  cheap: { provider: "google", model: "gemini-2.5-flash" },
  strong: { provider: "openai", model: "gpt-5.5" },
  long: { provider: "google", model: "gemini-2.5-pro" },
};

describe("pickStartingSpec", () => {
  it("uses a tier when that provider has a key", () => {
    expect(pickStartingSpec(["openai"], tiers)).toEqual(tiers.strong);
  });

  it("does not trap a Grok-only or Muse-only setup behind google/openai tiers", () => {
    expect(
      pickStartingSpec(["xai"], tiers, undefined, (p) => ({ provider: p, model: "grok-4.3" })),
    ).toEqual({ provider: "xai", model: "grok-4.3" });
    expect(
      pickStartingSpec(["muse"], tiers, undefined, (p) => ({ provider: p, model: "muse-spark-1.2" })),
    ).toEqual({ provider: "muse", model: "muse-spark-1.2" });
  });

  it("returns null when nothing is configured", () => {
    expect(pickStartingSpec([], tiers)).toBeNull();
  });
});
