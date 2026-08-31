import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { deepResearchWorkflow } from "./deep-research.js";
import type { WorkflowFile, WorkflowJobSpec } from "./runner.js";

export type WorkflowSource = "bundled" | "user" | "project";

export interface LoadedWorkflow extends WorkflowFile {
  source: WorkflowSource;
  path?: string;
}

function isJob(v: unknown): v is WorkflowJobSpec {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.description === "string" && typeof o.prompt === "string";
}

export function parseWorkflowFile(raw: unknown): WorkflowFile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string" || !o.name.trim()) return null;
  const parallel = Array.isArray(o.parallel) ? o.parallel.filter(isJob) : undefined;
  const steps = Array.isArray(o.steps) ? o.steps.filter(isJob) : undefined;
  let synthesize: WorkflowFile["synthesize"];
  if (o.synthesize && typeof o.synthesize === "object") {
    const s = o.synthesize as Record<string, unknown>;
    if (typeof s.prompt === "string") {
      synthesize = {
        prompt: s.prompt,
        subagent_type: typeof s.subagent_type === "string" ? s.subagent_type : undefined,
      };
    }
  }
  return {
    name: o.name.trim(),
    description: typeof o.description === "string" ? o.description : undefined,
    budget: typeof o.budget === "number" && o.budget > 0 ? o.budget : undefined,
    parallel,
    steps,
    synthesize,
  };
}

function readDir(dir: string): Array<{ file: WorkflowFile; path: string }> {
  if (!existsSync(dir)) return [];
  const out: Array<{ file: WorkflowFile; path: string }> = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    try {
      const parsed = parseWorkflowFile(JSON.parse(readFileSync(path, "utf8")));
      if (parsed) out.push({ file: parsed, path });
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export function bundledWorkflows(): LoadedWorkflow[] {
  return [{ ...deepResearchWorkflow(), source: "bundled" }];
}

/** Bundled, then user (`~/.config/polycode/workflows`), then project (last wins). */
export function loadWorkflows(cwd: string): LoadedWorkflow[] {
  const byName = new Map<string, LoadedWorkflow>();
  for (const w of bundledWorkflows()) byName.set(w.name, w);
  const userDir = join(homedir(), ".config", "polycode", "workflows");
  for (const { file, path } of readDir(userDir)) {
    byName.set(file.name, { ...file, source: "user", path });
  }
  const projectDir = join(cwd, ".polycode", "workflows");
  for (const { file, path } of readDir(projectDir)) {
    byName.set(file.name, { ...file, source: "project", path });
  }
  return [...byName.values()];
}
