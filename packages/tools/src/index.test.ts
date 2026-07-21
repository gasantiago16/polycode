import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalSandbox } from "@polycode/sandbox";
import { edit, glob, multiEdit, read } from "./index.js";

const dirs: string[] = [];
async function fixture(text: string) {
  const root = await mkdtemp(join(tmpdir(), "polycode-tools-"));
  dirs.push(root);
  await writeFile(join(root, "file.txt"), text);
  return { root, ctx: { sandbox: new LocalSandbox(root) } };
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

describe("editing tools", () => {
  it("refuses an ambiguous edit and preserves the file", async () => {
    const { root, ctx } = await fixture("same\nsame\n");
    const result = await edit.run({ path: "file.txt", old_string: "same", new_string: "new" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("not unique");
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("same\nsame\n");
  });

  it("treats replacement dollar signs literally", async () => {
    const { root, ctx } = await fixture("price TOKEN");
    await edit.run({ path: "file.txt", old_string: "TOKEN", new_string: "$&-$1" }, ctx);
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("price $&-$1");
  });

  it("rolls back multi_edit when a later edit fails", async () => {
    const { root, ctx } = await fixture("alpha beta");
    const result = await multiEdit.run({ path: "file.txt", edits: [
      { old_string: "alpha", new_string: "A" },
      { old_string: "missing", new_string: "B" },
    ] }, ctx);
    expect(result.isError).toBe(true);
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("alpha beta");
  });

  it("supports numbered partial reads", async () => {
    const { ctx } = await fixture("one\ntwo\nthree\nfour");
    const result = await read.run({ path: "file.txt", offset: 2, limit: 2 }, ctx);
    expect(result.output).toContain("lines 2-3 of 4");
    expect(result.output).toContain("2\ttwo");
    expect(result.output).toContain("offset 4");
  });

  it("matches top-level and nested files with globstar", async () => {
    const { root, ctx } = await fixture("x");
    await ctx.sandbox.writeFile("top.ts", "");
    await ctx.sandbox.writeFile("src/nested.ts", "");
    const result = await glob.run({ pattern: "**/*.ts" }, ctx);
    expect(result.output.split("\n").sort()).toEqual(["src/nested.ts", "top.ts"]);
    expect(root).toBeTruthy();
  });
});
