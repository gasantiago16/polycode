import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { bundledSkillsDir, expandSkill, loadSkills, parseSkillMd } from "./index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("parseSkillMd", () => {
  it("reads name, folded description, and body", () => {
    const s = parseSkillMd(
      `---\nname: forme\ndescription: >\n  Write a FOR doc.\n---\n\n# Hi\n$ARGUMENTS\n`,
      "/x",
      "bundled",
    );
    expect(s?.name).toBe("forme");
    expect(s?.description).toMatch(/FOR doc/);
    expect(s?.body).toContain("$ARGUMENTS");
  });
});

describe("loadSkills", () => {
  it("loads bundled forme and lets project override", () => {
    const cwd = join(tmpdir(), `poly-skills-${Date.now()}`);
    mkdirSync(join(cwd, ".polycode", "skills", "forme"), { recursive: true });
    dirs.push(cwd);
    writeFileSync(
      join(cwd, ".polycode", "skills", "forme", "SKILL.md"),
      `---\nname: forme\ndescription: project override\n---\n\nPROJECT\n`,
    );
    const skills = loadSkills({ cwd, bundledDir: bundledSkillsDir(), grokCompat: false });
    const forme = skills.find((s) => s.name === "forme");
    expect(forme?.source).toBe("project");
    expect(forme?.body).toContain("PROJECT");
    expect(skills.some((s) => s.name === "matsumura-style")).toBe(true);
    expect(skills.some((s) => s.name === "deep-research-review")).toBe(true);
  });
});

describe("expandSkill", () => {
  it("substitutes $ARGUMENTS", () => {
    const s = parseSkillMd(`---\nname: x\ndescription: d\n---\n\nQ: $ARGUMENTS\n`, "/x", "bundled")!;
    expect(expandSkill(s, "landing burn")).toContain("landing burn");
  });
});
