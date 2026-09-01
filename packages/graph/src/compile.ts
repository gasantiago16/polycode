import { END, START, type GraphDef, type GraphEdge, type GraphIf } from "./types.js";
import { stateFieldText } from "./reduce.js";

const NODE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export class GraphCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphCompileError";
  }
}

export interface CompiledGraph {
  def: GraphDef;
  successors(from: string, state: Record<string, unknown>): string[];
}

export function compileGraph(def: GraphDef): CompiledGraph {
  const name = def.name?.trim() ?? "";
  if (!NODE_NAME.test(name)) throw new GraphCompileError("graph name must be a simple identifier");
  const nodes = def.nodes ?? {};
  const ids = Object.keys(nodes);
  if (!ids.length) throw new GraphCompileError("graph has no nodes");
  for (const id of ids) {
    if (!NODE_NAME.test(id) || id === START || id === END) {
      throw new GraphCompileError(`invalid node name "${id}"`);
    }
    const n = nodes[id];
    if (!n || typeof n.prompt !== "string" || !n.prompt.trim()) {
      throw new GraphCompileError(`node "${id}" needs a prompt`);
    }
  }
  const edges = def.edges ?? [];
  if (!edges.length) throw new GraphCompileError("graph has no edges");
  const known = new Set<string>([START, END, ...ids]);
  let fromStart = false;
  for (const e of edges) {
    if (!e || typeof e.from !== "string" || typeof e.to !== "string") {
      throw new GraphCompileError("edge needs from and to");
    }
    if (!known.has(e.from)) throw new GraphCompileError(`edge from unknown node "${e.from}"`);
    if (!known.has(e.to)) throw new GraphCompileError(`edge to unknown node "${e.to}"`);
    if (e.from === END) throw new GraphCompileError("END cannot have outgoing edges");
    if (e.to === START) throw new GraphCompileError("cannot edge to START");
    if (e.from === START) fromStart = true;
    if (e.if && (typeof e.if.field !== "string" || !e.if.field.trim())) {
      throw new GraphCompileError(`conditional edge from "${e.from}" needs if.field`);
    }
  }
  if (!fromStart) throw new GraphCompileError("no edge from START");
  for (const id of def.interruptBefore ?? []) {
    if (!ids.includes(id)) throw new GraphCompileError(`interruptBefore unknown node "${id}"`);
  }
  const maxSteps = def.maxSteps ?? 16;
  if (!Number.isFinite(maxSteps) || maxSteps < 1 || maxSteps > 64) {
    throw new GraphCompileError("maxSteps must be 1..64");
  }
  return {
    def: { ...def, name, maxSteps },
    successors: (from, state) => successors(edges, from, state),
  };
}

function matchIf(state: Record<string, unknown>, cond: GraphIf): boolean {
  const text = stateFieldText(state, cond.field);
  if (cond.equals != null) return text === cond.equals;
  if (cond.includes != null) return text.toLowerCase().includes(cond.includes.toLowerCase());
  return text.length > 0;
}

function successors(edges: GraphEdge[], from: string, state: Record<string, unknown>): string[] {
  const hits: string[] = [];
  const uncond: string[] = [];
  for (const e of edges) {
    if (e.from !== from) continue;
    if (e.if) {
      if (matchIf(state, e.if)) hits.push(e.to);
    } else uncond.push(e.to);
  }
  const raw = hits.length ? hits : uncond;
  const next = [...new Set(raw)];
  const work = next.filter((n) => n !== END);
  if (!work.length && next.includes(END)) return [END];
  return work.length ? work : next;
}
