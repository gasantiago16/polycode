import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type SkillSource = "project" | "user" | "grok" | "bundled" | "plugin";

export interface Skill {
  name: string;
  description: string;
  body: string;
  dir: string;
  source: SkillSource;
}

const PRIORITY: Record<SkillSource, number> = { project: 0, user: 1, plugin: 2, grok: 3, bundled: 4 };

export function bundledSkillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "bundled");
}

export function parseSkillMd(raw: string, dir: string, source: SkillSource): Skill | null {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const fm = m[1];
  const body = m[2].trim();
  const name = scalar(fm, "name");
  const description = scalar(fm, "description");
  if (!name) return null;
  return { name: name.trim(), description: description.trim(), body, dir, source };
}

function scalar(fm: string, key: string): string {
  const line = fm.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  if (!line) return "";
  let v = line[1].trim();
  if (v === ">" || v === "|" || v === ">-" || v === "|-") {
    const after = fm.slice((line.index ?? 0) + line[0].length);
    const block: string[] = [];
    for (const row of after.split(/\r?\n/).slice(1)) {
      if (/^[a-zA-Z0-9_-]+:/.test(row)) break;
      block.push(row.replace(/^\s{2,}/, ""));
    }
    v = block.join(" ").trim();
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

function loadDir(root: string, source: SkillSource): Skill[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  const out: Skill[] = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    const file = join(dir, "SKILL.md");
    if (!existsSync(file)) continue;
    try {
      const skill = parseSkillMd(readFileSync(file, "utf8"), dir, source);
      if (skill) out.push(skill);
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

export interface LoadSkillsOptions {
  cwd: string;
  grokCompat?: boolean;
  bundledDir?: string;
}

export function loadSkills(opts: LoadSkillsOptions): Skill[] {
  const bundled = opts.bundledDir ?? bundledSkillsDir();
  const user = join(process.env.POLYCODE_CONFIG_DIR ?? join(homedir(), ".config", "polycode"), "skills");
  const layers: Skill[][] = [
    loadDir(join(opts.cwd, ".polycode", "skills"), "project"),
    loadDir(user, "user"),
    opts.grokCompat ? loadDir(join(homedir(), ".grok", "skills"), "grok") : [],
    loadDir(bundled, "bundled"),
  ];
  const byName = new Map<string, Skill>();
  for (const layer of layers) {
    for (const s of layer) {
      if (!byName.has(s.name)) byName.set(s.name, s);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name) || PRIORITY[a.source] - PRIORITY[b.source]);
}

export function expandSkill(skill: Skill, args: string): string {
  const a = args.trim();
  return skill.body.replaceAll("$ARGUMENTS", a).replaceAll("$0", a);
}

export function skillsListing(skills: Skill[]): string {
  if (!skills.length) return "No skills loaded.";
  return skills.map((s) => `/${s.name}  (${s.source})  ${s.description.split("\n")[0] ?? ""}`).join("\n");
}

export function skillPromptBlock(skills: Skill[]): string {
  if (!skills.length) return "";
  const lines = skills.map((s) => `- /${s.name}: ${s.description.split("\n")[0] ?? s.name}`);
  return `<skills>\nAvailable slash-invoked skills (read the body only when the user invokes them):\n${lines.join("\n")}\n</skills>`;
}
