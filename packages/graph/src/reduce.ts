import type { GraphDef, ReducerKind } from "./types.js";

const IDENT_G = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export function expandTemplate(tmpl: string, state: Record<string, unknown>): string {
  return tmpl.replace(IDENT_G, (_, k: string) => stringify(state[k]));
}

export function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function fieldReducer(def: GraphDef, key: string): ReducerKind {
  return def.state?.[key]?.reducer ?? (key === "findings" ? "append" : "replace");
}

export function mergeState(
  def: GraphDef,
  prev: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(patch)) {
    if (fieldReducer(def, k) === "append") {
      const cur = Array.isArray(out[k]) ? (out[k] as unknown[]) : [];
      const add = Array.isArray(v) ? v : [v];
      out[k] = [...cur, ...add];
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function stateFieldText(state: Record<string, unknown>, field: string): string {
  return stringify(state[field]);
}
