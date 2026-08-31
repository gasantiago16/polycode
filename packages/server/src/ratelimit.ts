export interface RateLimitConfig {
  /** Sliding window length (default 60_000). */
  windowMs?: number;
  /** Max accepted requests per key per window (default 30). */
  max?: number;
  /** Max in-flight /chat handlers per key (default 2). */
  concurrent?: number;
}

export interface RateLimitDecision {
  ok: boolean;
  retryAfterSec: number;
  reason?: "rate" | "concurrent";
}

interface Bucket {
  times: number[];
  inflight: number;
}

export class RateLimiter {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly concurrent: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(cfg: RateLimitConfig = {}) {
    this.windowMs = cfg.windowMs ?? 60_000;
    this.max = cfg.max ?? 30;
    this.concurrent = cfg.concurrent ?? 2;
  }

  /** Window-only hit (failed auth). Does not take a concurrent slot. */
  note(key: string, now = Date.now()): RateLimitDecision {
    return this.hitWindow(key, now);
  }

  check(key: string, now = Date.now()): RateLimitDecision {
    const w = this.hitWindow(key, now);
    if (!w.ok) return w;
    const b = this.bucket(key);
    if (b.inflight >= this.concurrent) {
      b.times.pop();
      return { ok: false, retryAfterSec: 1, reason: "concurrent" };
    }
    b.inflight++;
    return { ok: true, retryAfterSec: 0 };
  }

  finish(key: string): void {
    const b = this.buckets.get(key);
    if (!b) return;
    b.inflight = Math.max(0, b.inflight - 1);
  }

  private hitWindow(key: string, now: number): RateLimitDecision {
    const b = this.bucket(key);
    const cutoff = now - this.windowMs;
    b.times = b.times.filter((t) => t > cutoff);
    if (b.times.length >= this.max) {
      const retryAfterSec = Math.max(1, Math.ceil((b.times[0] + this.windowMs - now) / 1000));
      return { ok: false, retryAfterSec, reason: "rate" };
    }
    b.times.push(now);
    return { ok: true, retryAfterSec: 0 };
  }

  private bucket(key: string): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = { times: [], inflight: 0 };
      this.buckets.set(key, b);
    }
    return b;
  }
}
