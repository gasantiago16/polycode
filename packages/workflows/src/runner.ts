import type { SpawnChildInput, ToolRunResult } from "@polycode/core";

export interface WorkflowJob {
  description: string;
  prompt: string;
  subagent_type?: string;
  isolation?: "none" | "worktree";
}

export interface WorkflowHost {
  agent(job: WorkflowJob): Promise<ToolRunResult>;
}

export interface WorkflowBudget {
  total: number;
  spent: number;
}

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetError";
  }
}

export async function runAgent(
  host: WorkflowHost,
  job: WorkflowJob,
  budget: WorkflowBudget,
): Promise<ToolRunResult> {
  if (budget.spent >= budget.total) {
    throw new BudgetError(`workflow budget exhausted (${budget.spent}/${budget.total})`);
  }
  budget.spent++;
  return host.agent(job);
}

export async function runParallel(
  host: WorkflowHost,
  jobs: WorkflowJob[],
  budget: WorkflowBudget,
): Promise<ToolRunResult[]> {
  if (budget.spent + jobs.length > budget.total) {
    throw new BudgetError(
      `parallel panel of ${jobs.length} would exceed budget (${budget.spent}+${jobs.length}/${budget.total})`,
    );
  }
  budget.spent += jobs.length;
  return Promise.all(jobs.map((j) => host.agent(j)));
}

export async function runSequential(
  host: WorkflowHost,
  jobs: WorkflowJob[],
  budget: WorkflowBudget,
): Promise<ToolRunResult[]> {
  const out: ToolRunResult[] = [];
  for (const job of jobs) {
    out.push(await runAgent(host, job, budget));
  }
  return out;
}

export function expandVars(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`$${k}`, v);
  }
  return out;
}

export function parseWorkflowArgs(rest: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const leftover: string[] = [];
  for (const tok of rest.trim().split(/\s+/).filter(Boolean)) {
    const eq = tok.indexOf("=");
    if (eq > 0 && !tok.slice(0, eq).includes("/")) {
      vars[tok.slice(0, eq)] = tok.slice(eq + 1);
    } else leftover.push(tok);
  }
  if (leftover.length) vars.query ??= leftover.join(" ");
  return vars;
}

export interface WorkflowJobSpec {
  description: string;
  subagent_type?: string;
  prompt: string;
  isolation?: "none" | "worktree";
}

/** JSON workflow: optional parallel panel, then sequential steps, then synthesize. */
export interface WorkflowFile {
  name: string;
  description?: string;
  budget?: number;
  parallel?: WorkflowJobSpec[];
  steps?: WorkflowJobSpec[];
  synthesize?: { prompt: string; subagent_type?: string };
}

function jobFromSpec(spec: WorkflowJobSpec, vars: Record<string, string>): WorkflowJob {
  return {
    description: expandVars(spec.description, vars),
    prompt: expandVars(spec.prompt, vars),
    subagent_type: spec.subagent_type,
    isolation: spec.isolation,
  };
}

function joinResults(jobs: WorkflowJob[], parts: ToolRunResult[]): string {
  return parts.map((p, i) => `## ${jobs[i]?.description ?? i}\n${p.output}`).join("\n\n");
}

export async function runWorkflowFile(
  host: WorkflowHost,
  file: WorkflowFile,
  vars: Record<string, string>,
): Promise<{ parts: ToolRunResult[]; synthesis?: ToolRunResult }> {
  const budget: WorkflowBudget = { total: file.budget ?? 16, spent: 0 };
  const parallelJobs = (file.parallel ?? []).map((j) => jobFromSpec(j, vars));
  const parts: ToolRunResult[] = parallelJobs.length
    ? await runParallel(host, parallelJobs, budget)
    : [];
  let acc = joinResults(parallelJobs, parts);
  const seqJobs: WorkflowJob[] = [];
  for (const spec of file.steps ?? []) {
    const job = jobFromSpec(spec, { ...vars, results: acc });
    seqJobs.push(job);
    const r = await runAgent(host, job, budget);
    parts.push(r);
    acc = acc ? `${acc}\n\n## ${job.description}\n${r.output}` : `## ${job.description}\n${r.output}`;
  }
  let synthesis: ToolRunResult | undefined;
  if (file.synthesize) {
    synthesis = await runAgent(
      host,
      {
        description: "synthesize",
        subagent_type: file.synthesize.subagent_type ?? "general",
        prompt: expandVars(file.synthesize.prompt, { ...vars, results: acc }),
      },
      budget,
    );
  }
  return { parts, synthesis };
}

export function hostFromSpawn(spawn: (input: SpawnChildInput) => Promise<ToolRunResult>): WorkflowHost {
  return {
    agent: (job) =>
      spawn({
        description: job.description,
        prompt: job.prompt,
        subagent_type: job.subagent_type,
        isolation: job.isolation,
      }),
  };
}
