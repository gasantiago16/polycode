import type { SpawnChildInput, ToolRunResult } from "@polycode/core";

export const START = "__start__";
export const END = "__end__";

export type ReducerKind = "replace" | "append";

export interface StateField {
  reducer?: ReducerKind;
}

export interface AgentNode {
  kind?: "agent";
  description?: string;
  subagent_type?: string;
  isolation?: "none" | "worktree";
  persona?: string;
  /** Prompt template. `{{key}}` is substituted from graph state. */
  prompt: string;
  /** State key for this node's text output (default `last`). */
  outputKey?: string;
}

export interface GraphIf {
  field: string;
  equals?: string;
  includes?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  if?: GraphIf;
}

export interface GraphDef {
  name: string;
  description?: string;
  /** Cap on node executions (default 16). */
  maxSteps?: number;
  state?: Record<string, StateField>;
  nodes: Record<string, AgentNode>;
  edges: GraphEdge[];
  /** Pause before these nodes (checkpoint `interrupted`; `/graph resume`). */
  interruptBefore?: string[];
}

export type GraphStatus = "running" | "completed" | "interrupted" | "failed";

export interface GraphStep {
  node: string;
  output: string;
  error?: boolean;
}

export interface GraphCheckpoint {
  version: 1;
  threadId: string;
  graph: string;
  state: Record<string, unknown>;
  next: string[];
  status: GraphStatus;
  steps: number;
  history: GraphStep[];
  error?: string;
  updatedAt: string;
}

export interface GraphHost {
  agent(job: {
    description: string;
    prompt: string;
    subagent_type?: string;
    isolation?: "none" | "worktree";
    persona?: string;
  }): Promise<ToolRunResult>;
}

export function hostFromSpawn(
  spawn: (input: SpawnChildInput) => Promise<ToolRunResult>,
): GraphHost {
  return {
    agent: (job) =>
      spawn({
        description: job.description,
        prompt: job.prompt,
        subagent_type: job.subagent_type,
        isolation: job.isolation,
        persona: job.persona,
      }),
  };
}
