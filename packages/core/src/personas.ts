import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { polycodeConfigDir } from "./paths.js";

export interface Persona {
  name: string;
  description: string;
  instructions: string;
  source: "project" | "user";
}

function parsePersonaFile(name: string, text: string, source: Persona["source"]): Persona | null {
  const body = text.replace(/\r\n/g, "\n").trim();
  if (!body) return null;
  const id = name.replace(/\.(md|txt)$/i, "").trim().toLowerCase();
  if (!id) return null;
  const lines = body.split("\n");
  let description = id;
  let start = 0;
  if (lines[0]?.startsWith("# ")) {
    description = lines[0].slice(2).trim() || id;
    start = 1;
    while (lines[start] === "") start++;
  }
  const instructions = lines.slice(start).join("\n").trim();
  if (!instructions) return null;
  return { name: id, description, instructions, source };
}

function jailedPersonaPath(dir: string, name: string): string | null {
  if (name.includes("..") || name.includes("/") || name.includes("\\")) return null;
  if (!/^[A-Za-z0-9._-]+\.(md|txt)$/i.test(name)) return null;
  const file = join(dir, name);
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink()) return null;
    const root = realpathSync(dir).replace(/\\/g, "/").toLowerCase();
    const resolved = realpathSync(file).replace(/\\/g, "/").toLowerCase();
    if (resolved !== root && !resolved.startsWith(root.endsWith("/") ? root : `${root}/`)) return null;
    return file;
  } catch {
    return null;
  }
}

function readDir(dir: string, source: Persona["source"]): Persona[] {
  if (!existsSync(dir)) return [];
  try {
    if (lstatSync(dir).isSymbolicLink()) return [];
  } catch {
    return [];
  }
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: Persona[] = [];
  for (const n of names) {
    if (!/\.(md|txt)$/i.test(n)) continue;
    const file = jailedPersonaPath(dir, n);
    if (!file) continue;
    try {
      const raw = readFileSync(file, "utf8");
      const p = parsePersonaFile(n, raw.length > 16_384 ? raw.slice(0, 16_384) : raw, source);
      if (p) out.push(p);
    } catch {
      /* skip */
    }
  }
  return out;
}

/** Project `.polycode/personas/` overrides user-config `personas/`. */
export function loadPersonas(cwd: string): Persona[] {
  const byName = new Map<string, Persona>();
  const user = join(polycodeConfigDir(), "personas");
  for (const p of readDir(user, "user")) byName.set(p.name, p);
  for (const p of readDir(join(cwd, ".polycode", "personas"), "project")) byName.set(p.name, p);
  return [...byName.values()];
}

export function lookupPersona(list: Persona[] | undefined, name?: string): Persona | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  return (list ?? []).find((p) => p.name === n);
}
