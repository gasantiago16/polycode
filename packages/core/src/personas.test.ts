import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
});
