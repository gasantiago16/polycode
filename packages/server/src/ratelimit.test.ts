import { describe, expect, it } from "vitest";
import { RateLimiter } from "./ratelimit.js";

describe("RateLimiter", () => {
  it("allows up to max then rejects until the window slides", () => {
    const rl = new RateLimiter({ windowMs: 1_000, max: 2, concurrent: 10 });
    expect(rl.check("a", 0).ok).toBe(true);
    expect(rl.check("a", 10).ok).toBe(true);
    const denied = rl.check("a", 20);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe("rate");
    expect(denied.retryAfterSec).toBeGreaterThan(0);
    rl.finish("a");
    rl.finish("a");
    expect(rl.check("a", 1_001).ok).toBe(true);
  });

  it("caps concurrent in-flight checks", () => {
    const rl = new RateLimiter({ windowMs: 60_000, max: 50, concurrent: 2 });
    expect(rl.check("b").ok).toBe(true);
    expect(rl.check("b").ok).toBe(true);
    const denied = rl.check("b");
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe("concurrent");
    rl.finish("b");
    expect(rl.check("b").ok).toBe(true);
  });
});
