import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { polycodeConfigDir } from "@polycode/core";
import { END, START, type AgentNode, type GraphDef, type GraphEdge, type GraphIf } from "./types.js";

export type GraphSource = "bundled" | "user" | "project";

export interface LoadedGraph extends GraphDef {
  source: GraphSource;
  path?: string;
}

function isIf(v: unknown): v is GraphIf {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.field === "string" && o.field.trim().length > 0;
}

function parseEdge(v: unknown): GraphEdge | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.from !== "string" || typeof o.to !== "string") return null;
  const e: GraphEdge = { from: o.from, to: o.to };
  if (o.if && isIf(o.if)) {
    e.if = {
      field: o.if.field,
      equals: typeof o.if.equals === "string" ? o.if.equals : undefined,
      includes: typeof o.if.includes === "string" ? o.if.includes : undefined,
    };
  }
  return e;
}

function parseNode(v: unknown): AgentNode | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.prompt !== "string" || !o.prompt.trim()) return null;
  const isolation = o.isolation === "worktree" ? "worktree" : o.isolation === "none" ? "none" : undefined;
  return {
    kind: "agent",
    description: typeof o.description === "string" ? o.description : undefined,
    subagent_type: typeof o.subagent_type === "string" ? o.subagent_type : undefined,
    isolation,
    persona: typeof o.persona === "string" ? o.persona : undefined,
    prompt: o.prompt,
    outputKey: typeof o.outputKey === "string" ? o.outputKey : undefined,
  };
}

export function parseGraphDef(raw: unknown): GraphDef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string" || !o.name.trim()) return null;
  if (!o.nodes || typeof o.nodes !== "object") return null;
  const nodes: Record<string, AgentNode> = {};
  for (const [k, v] of Object.entries(o.nodes as Record<string, unknown>)) {
    const n = parseNode(v);
    if (n) nodes[k] = n;
  }
  const edges = Array.isArray(o.edges) ? o.edges.map(parseEdge).filter((e): e is GraphEdge => !!e) : [];
  const state: GraphDef["state"] = {};
  if (o.state && typeof o.state === "object") {
    for (const [k, v] of Object.entries(o.state as Record<string, unknown>)) {
      const red = v && typeof v === "object" ? (v as { reducer?: string }).reducer : undefined;
      state[k] = { reducer: red === "append" ? "append" : "replace" };
    }
  }
  const interruptBefore = Array.isArray(o.interruptBefore)
    ? o.interruptBefore.filter((x): x is string => typeof x === "string")
    : undefined;
  return {
    name: o.name.trim(),
    description: typeof o.description === "string" ? o.description : undefined,
    maxSteps: typeof o.maxSteps === "number" ? o.maxSteps : undefined,
    state: Object.keys(state).length ? state : undefined,
    nodes,
    edges,
    interruptBefore,
  };
}

function readDir(dir: string): Array<{ def: GraphDef; path: string }> {
  if (!existsSync(dir)) return [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: Array<{ def: GraphDef; path: string }> = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    if (name.includes("..") || name.includes("/") || name.includes("\\")) continue;
    if (!/^[A-Za-z0-9._-]+\.json$/i.test(name)) continue;
    const path = join(dir, name);
    try {
      const parsed = parseGraphDef(JSON.parse(readFileSync(path, "utf8")));
      if (parsed) out.push({ def: parsed, path });
    } catch {
      /* skip */
    }
  }
  return out;
}

export function bundledGraphs(): LoadedGraph[] {
  return [
    {
      source: "bundled",
      name: "explore",
      description: "Single read-only explore child (checkpointed)",
      nodes: {
        explore: {
          subagent_type: "explore",
          prompt:
            "Read-only survey of the repo for:\n\n{{query}}\n\nReturn paths, current behavior, and risks. Do not edit.",
        },
      },
      edges: [
        { from: START, to: "explore" },
        { from: "explore", to: END },
      ],
    },
    {
      source: "bundled",
      name: "research-implement",
      description: "Explore, then implement in a worktree (LangGraph-shaped, checkpointed)",
      nodes: {
        explore: {
          subagent_type: "explore",
          prompt:
            "Read-only survey. Find files, types, and call sites for:\n\n{{query}}\n\nReturn: paths, current behavior, risks, tight sketch. Do not edit.",
        },
        implement: {
          subagent_type: "general",
          isolation: "worktree",
          prompt:
            "Implement this in the isolated worktree. Use the research notes. Run relevant tests if they exist.\n\nTask:\n{{query}}\n\nResearch:\n{{last}}",
        },
      },
      edges: [
        { from: START, to: "explore" },
        { from: "explore", to: "implement" },
        { from: "implement", to: END },
      ],
    },
  ];
}

/** Bundled, then user config `graphs/`, then project `.polycode/graphs/` (last wins). */
export function loadGraphs(cwd: string): LoadedGraph[] {
  const byName = new Map<string, LoadedGraph>();
  for (const g of bundledGraphs()) byName.set(g.name, g);
  for (const { def, path } of readDir(join(polycodeConfigDir(), "graphs"))) {
    byName.set(def.name, { ...def, source: "user", path });
  }
  for (const { def, path } of readDir(join(cwd, ".polycode", "graphs"))) {
    byName.set(def.name, { ...def, source: "project", path });
  }
  return [...byName.values()];
}

export function newThreadId(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
