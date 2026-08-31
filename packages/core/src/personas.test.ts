import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadPersonas, lookupPersona } from "./personas.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("loadPersonas", () => {
  it("reads markdown personas from the project dir", () => {
    const cwd = join(tmpdir(), `poly-persona-${Date.now()}`);
    dirs.push(cwd);
    mkdirSync(join(cwd, ".polycode", "personas"), { recursive: true });
    writeFileSync(
      join(cwd, ".polycode", "personas", "terse.md"),
      "# Terse\n\nReply in 3 bullets. No preamble.\n",
    );
    const list = loadPersonas(cwd);
    expect(lookupPersona(list, "terse")?.instructions).toMatch(/3 bullets/);
    expect(lookupPersona(list, "Terse")?.description).toBe("Terse");
  });

  it("skips directories pretending to be persona files", () => {
    const cwd = join(tmpdir(), `poly-persona-dir-${Date.now()}`);
    dirs.push(cwd);
    mkdirSync(join(cwd, ".polycode", "personas", "nested.md"), { recursive: true });
    expect(lookupPersona(loadPersonas(cwd), "nested")).toBeUndefined();
  });

  it("does not follow a persona symlink out of the personas dir", () => {
    const cwd = join(tmpdir(), `poly-persona-link-${Date.now()}`);
    dirs.push(cwd);
    mkdirSync(cwd, { recursive: true });
    const secret = join(cwd, "id_rsa");
    writeFileSync(secret, "SSH SECRET KEY MATERIAL\n");
    mkdirSync(join(cwd, ".polycode", "personas"), { recursive: true });
    try {
      symlinkSync(secret, join(cwd, ".polycode", "personas", "helpful.md"));
    } catch {
      return; // Windows without symlink privilege — directory case above still covers non-files
    }
    expect(lookupPersona(loadPersonas(cwd), "helpful")).toBeUndefined();
  });

  it("loads user personas from POLYCODE_CONFIG_DIR", () => {
    const prev = process.env.POLYCODE_CONFIG_DIR;
    const cfg = join(tmpdir(), `poly-cfg-${Date.now()}`);
    const cwd = join(tmpdir(), `poly-empty-${Date.now()}`);
    dirs.push(cfg, cwd);
    process.env.POLYCODE_CONFIG_DIR = cfg;
    try {
      mkdirSync(join(cfg, "personas"), { recursive: true });
      mkdirSync(cwd, { recursive: true });
      writeFileSync(join(cfg, "personas", "user.md"), "# U\n\nFrom user config.\n");
      expect(lookupPersona(loadPersonas(cwd), "user")?.instructions).toMatch(/user config/);
    } finally {
      if (prev == null) delete process.env.POLYCODE_CONFIG_DIR;
      else process.env.POLYCODE_CONFIG_DIR = prev;
    }
  });
});
