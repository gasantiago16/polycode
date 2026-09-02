import { END, START, type GraphCheckpoint, type GraphDef } from "./types.js";

/** One-line DAG for lists: `START → explore → implement → END`. */
export function formatGraphDef(def: GraphDef): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  function walk(from: string, prefix: string): void {
    const outs = (def.edges ?? []).filter((e) => e.from === from);
    if (!outs.length) {
      if (from !== END) lines.push(`${prefix} → ${END}`);
      return;
    }
    for (const e of outs) {
      const cond = e.if
        ? ` ─if ${e.if.field}${e.if.includes ? `~${e.if.includes}` : e.if.equals ? `=${e.if.equals}` : ""}→ `
        : " → ";
      const step = `${prefix}${cond}${e.to}`;
      const key = `${from}|${e.to}|${cond}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (e.to === END) lines.push(step);
      else walk(e.to, step);
    }
  }
  walk(START, "START");
  const uniq = [...new Set(lines)];
  return uniq.length ? uniq.join("\n") : "START → END";
}

export function formatGraphProgress(cp: GraphCheckpoint): string {
  const done = cp.history.map((h) => h.node).join(" → ") || "(none)";
  const next = cp.next.filter((n) => n && n !== END).join(", ") || "END";
  return `graph ${cp.graph} · ${cp.status} · done ${done} · next ${next}`;
}
