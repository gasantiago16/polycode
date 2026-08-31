import { basename } from "node:path";

export interface StatusLineVars {
  model: string;
  mode: string;
  route: "on" | "off";
  sandbox: string;
  ctxUsed: number;
  ctxWindow: number;
  sessionTokens: number;
  mcpOk: number;
  mcpTotal: number;
  mcpDeferred: number;
  cost: string;
  cwd: string;
}

export const DEFAULT_STATUS_TEMPLATE =
  "$model · $mode · route:$route · sandbox:$sandbox$ctx_seg$sum_seg$mcp_seg";

export function fmtK(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k < 10 ? k.toFixed(1) : Math.round(k).toString()) + "k";
}

export function statusLineVars(partial: StatusLineVars): Record<string, string> {
  const ctx =
    partial.ctxUsed > 0 ? `${fmtK(partial.ctxUsed)}/${fmtK(partial.ctxWindow)}` : "";
  const pct =
    partial.ctxWindow > 0 && partial.ctxUsed > 0
      ? `${Math.round((100 * partial.ctxUsed) / partial.ctxWindow)}%`
      : "";
  return {
    model: partial.model,
    mode: partial.mode,
    route: partial.route,
    sandbox: partial.sandbox,
    ctx,
    ctx_pct: pct,
    ctx_seg: ctx ? ` · ctx ${ctx}` : "",
    sum: partial.sessionTokens > 0 ? fmtK(partial.sessionTokens) : "",
    sum_seg: partial.sessionTokens > 0 ? ` · Σ ${fmtK(partial.sessionTokens)} tok` : "",
    mcp: partial.mcpTotal > 0 ? `${partial.mcpOk}/${partial.mcpTotal}` : "",
    mcp_seg: partial.mcpTotal > 0 ? ` · mcp:${partial.mcpOk}/${partial.mcpTotal}` : "",
    deferred: partial.mcpDeferred > 0 ? String(partial.mcpDeferred) : "",
    cost: partial.cost,
    cost_seg: partial.cost && partial.cost !== "$0.00" ? ` · ${partial.cost}` : "",
    cwd: basename(partial.cwd) || partial.cwd,
  };
}

/** Substitute `$token` placeholders. Unknown tokens stay as-is. */
export function formatStatusLine(template: string, vars: StatusLineVars): string {
  const map = statusLineVars(vars);
  return template.replace(/\$([a-z_]+)/gi, (all, key: string) => {
    const k = key.toLowerCase();
    return k in map ? map[k] : all;
  });
}

export function expandStatusCommand(command: string, vars: StatusLineVars): string {
  const map = statusLineVars(vars);
  let out = command;
  for (const [k, v] of Object.entries(map)) {
    out = out.replaceAll("$" + k.toUpperCase(), v);
    out = out.replaceAll("$" + k, v);
  }
  return out;
}
