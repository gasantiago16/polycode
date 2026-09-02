import type { CompiledGraph } from "./compile.js";
import { FileCheckpointStore, assertThreadId } from "./checkpoint.js";
import { expandTemplate, mergeState } from "./reduce.js";
import { END, START, type GraphCheckpoint, type GraphHost, type GraphStep } from "./types.js";

export interface RunGraphOpts {
  compiled: CompiledGraph;
  host: GraphHost;
  store: FileCheckpointStore;
  threadId: string;
  input?: Record<string, unknown>;
  /** Continue an interrupted/failed thread. */
  resume?: boolean;
  /** Fired after each checkpoint write (progress UI). */
  onStep?: (cp: GraphCheckpoint) => void;
}

export async function runGraph(opts: RunGraphOpts): Promise<GraphCheckpoint> {
  const { compiled, host, store, onStep } = opts;
  const ping = (c: GraphCheckpoint) => {
    store.save(c);
    onStep?.(c);
  };
  const threadId = assertThreadId(opts.threadId);
  const def = compiled.def;
  const maxSteps = def.maxSteps ?? 16;
  const interrupt = new Set(def.interruptBefore ?? []);

  const existing = store.load(threadId);
  let cp: GraphCheckpoint;
  let skipInterrupt = !!opts.resume;
  if (opts.resume) {
    if (!existing) throw new Error(`no graph thread "${threadId}"`);
    if (existing.graph !== def.name) {
      throw new Error(`thread ${threadId} is graph "${existing.graph}", not "${def.name}"`);
    }
    if (existing.status === "completed") return existing;
    cp = { ...existing, status: "running", error: undefined, updatedAt: now() };
  } else {
    if (existing && existing.status === "running") {
      throw new Error(`thread ${threadId} is already running — /graph resume ${threadId}`);
    }
    const state = mergeState(def, { query: "", last: "", findings: [] }, opts.input ?? {});
    cp = {
      version: 1,
      threadId,
      graph: def.name,
      state,
      next: compiled.successors(START, state),
      status: "running",
      steps: 0,
      history: [],
      updatedAt: now(),
    };
  }

  ping(cp);

  while (cp.status === "running") {
    const next = cp.next.filter((n) => n && n !== END);
    if (!next.length) {
      cp = { ...cp, status: "completed", next: [], updatedAt: now() };
      ping(cp);
      break;
    }
    if (cp.steps >= maxSteps) {
      cp = {
        ...cp,
        status: "failed",
        error: `maxSteps ${maxSteps} reached`,
        updatedAt: now(),
      };
      ping(cp);
      break;
    }

    const gate = next.filter((n) => interrupt.has(n));
    if (gate.length && !skipInterrupt) {
      cp = { ...cp, status: "interrupted", next, updatedAt: now() };
      ping(cp);
      break;
    }
    skipInterrupt = false;

    const missing = next.filter((n) => !def.nodes[n]);
    if (missing.length) {
      cp = { ...cp, status: "failed", error: `unknown node "${missing[0]}"`, updatedAt: now() };
      ping(cp);
      break;
    }

    const results = await Promise.all(
      next.map(async (id) => {
        const node = def.nodes[id];
        const prompt = expandTemplate(node.prompt, cp.state as Record<string, unknown>);
        const r = await host.agent({
          description: node.description ?? id,
          prompt,
          subagent_type: node.subagent_type,
          isolation: node.isolation,
          persona: node.persona,
        });
        return { id, node, r };
      }),
    );

    let state = cp.state;
    const history = [...cp.history];
    for (const { id, node, r } of results) {
      const step: GraphStep = { node: id, output: r.output, error: r.isError };
      history.push(step);
      const key = node.outputKey ?? "last";
      state = mergeState(def, state, {
        [key]: r.output,
        last: r.output,
        findings: { node: id, output: r.output, error: !!r.isError },
      });
    }

    const failed = results.find((x) => x.r.isError);
    const following = [
      ...new Set(results.flatMap((x) => compiled.successors(x.id, state)).filter((n) => n !== END)),
    ];
    const done = results.every((x) => compiled.successors(x.id, state).includes(END) || !compiled.successors(x.id, state).length);

    cp = {
      ...cp,
      state,
      history,
      steps: cp.steps + next.length,
      next: failed ? next : done && !following.length ? [] : following,
      status: failed ? "failed" : "running",
      error: failed ? `${failed.id}: ${failed.r.output.slice(0, 400)}` : undefined,
      updatedAt: now(),
    };
    ping(cp);
  }

  return cp;
}

export function formatGraphRun(cp: GraphCheckpoint): string {
  const head = `graph ${cp.graph}  thread ${cp.threadId}  ${cp.status}  ${cp.steps} steps`;
  const err = cp.error ? `\n${cp.error}` : "";
  const body = cp.history.map((h) => `## ${h.node}${h.error ? " (error)" : ""}\n${h.output}`).join("\n\n");
  return body ? `${head}${err}\n\n${body}` : `${head}${err}`;
}

function now(): string {
  return new Date().toISOString();
}
