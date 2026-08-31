/** Node `setInterval` treats delays above this as 1ms. */
export const MAX_SAFE_INTERVAL_MS = 2_147_483_647;
/** Product cap: 24h. */
export const MAX_LOOP_MS = 86_400_000;
export const MIN_LOOP_MS = 15_000;

const INTERVAL_FACTOR: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parse `60s` / `5m` / `2h` / `1d`. Returns ms or null (unknown / overflow / above cap). */
export function parseLoopInterval(raw: string): number | null {
  const m = raw.trim().match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const factor = INTERVAL_FACTOR[m[2].toLowerCase()];
  const ms = n * factor;
  if (!Number.isFinite(ms) || ms > MAX_LOOP_MS || ms > MAX_SAFE_INTERVAL_MS) return null;
  return ms;
}

export function looksLikeLoopInterval(raw: string): boolean {
  return /^\d+(ms|s|m|h|d)$/i.test(raw.trim());
}

/** Monotonic loop ids (`l1`, `l2`, …) that never reuse after stop. */
export function nextLoopId(seq: { current: number }): string {
  seq.current += 1;
  return `l${seq.current}`;
}

export function formatLoopInterval(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

export type LoopParse =
  | { op: "list" }
  | { op: "stop"; id?: string }
  | { op: "start"; intervalMs: number; prompt: string }
  | { op: "usage"; error?: string };

/** `/loop` · `/loop stop [id]` · `/loop 5m <prompt>` · `/loop <prompt>` (default 5m). */
export function parseLoopCommand(line: string): LoopParse {
  const rest = line.replace(/^\/loop\b/i, "").trim();
  if (!rest) return { op: "list" };
  const [first, ...more] = rest.split(/\s+/);
  if (first.toLowerCase() === "stop" || first.toLowerCase() === "off") {
    return { op: "stop", id: more[0] };
  }
  if (looksLikeLoopInterval(first)) {
    const ms = parseLoopInterval(first);
    if (ms == null) {
      return { op: "usage", error: `interval must be at most ${formatLoopInterval(MAX_LOOP_MS)}` };
    }
    const prompt = more.join(" ").trim();
    if (!prompt) return { op: "usage", error: "usage: /loop 5m <prompt>" };
    if (ms < MIN_LOOP_MS) {
      return { op: "usage", error: `interval must be at least ${formatLoopInterval(MIN_LOOP_MS)}` };
    }
    return { op: "start", intervalMs: ms, prompt };
  }
  return { op: "start", intervalMs: 5 * 60_000, prompt: rest };
}
