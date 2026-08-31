/** Parse `60s` / `5m` / `2h` / `1d`. Returns ms or null. */
export function parseLoopInterval(raw: string): number | null {
  const m = raw.trim().match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = m[2].toLowerCase();
  if (u === "ms") return n;
  if (u === "s") return n * 1000;
  if (u === "m") return n * 60_000;
  if (u === "h") return n * 3_600_000;
  return n * 86_400_000;
}

export const MIN_LOOP_MS = 15_000;

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
  const ms = parseLoopInterval(first);
  if (ms != null) {
    const prompt = more.join(" ").trim();
    if (!prompt) return { op: "usage", error: "usage: /loop 5m <prompt>" };
    if (ms < MIN_LOOP_MS) {
      return { op: "usage", error: `interval must be at least ${formatLoopInterval(MIN_LOOP_MS)}` };
    }
    return { op: "start", intervalMs: ms, prompt };
  }
  return { op: "start", intervalMs: 5 * 60_000, prompt: rest };
}
