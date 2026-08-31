import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalSandbox } from "./index.js";

const cleanup: string[] = [];
async function temp(prefix: string) {
  const p = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(p);
  return p;
}
afterEach(async () => { await Promise.all(cleanup.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

describe("LocalSandbox path containment", () => {
  it("reads and writes inside the project", async () => {
    const root = await temp("polycode-root-");
    const sb = new LocalSandbox(root);
    await sb.writeFile("src/a.txt", "hello");
    expect(await sb.readFile("src/a.txt")).toBe("hello");
    expect(await readFile(join(root, "src", "a.txt"), "utf8")).toBe("hello");
  });

  it.each(["../outside.txt", "a/../../outside.txt"])("rejects lexical escape %s", async (path) => {
    const root = await temp("polycode-root-");
    await expect(new LocalSandbox(root).readFile(path)).rejects.toThrow("escapes project root");
  });

  it("protects .polycode metadata", async () => {
    const root = await temp("polycode-root-");
    await expect(new LocalSandbox(root).writeFile(".polycode/sessions/x.json", "secret")).rejects.toThrow("not accessible");
  });

  it("allows cranky review files under .polycode/reviews/", async () => {
    const root = await temp("polycode-root-");
    const sb = new LocalSandbox(root);
    await sb.writeFile(".polycode/reviews/a.md", "# ok");
    expect(await sb.readFile(".polycode/reviews/a.md")).toBe("# ok");
  });

  it("allows curated memory at .polycode/memory.md", async () => {
    const root = await temp("polycode-root-");
    const sb = new LocalSandbox(root);
    await sb.writeFile(".polycode/memory.md", "note\n");
    expect(await sb.readFile(".polycode/memory.md")).toBe("note\n");
    const bytes = await sb.readFileBytes(".polycode/memory.md");
    expect(Buffer.from(bytes).toString("utf8")).toBe("note\n");
  });

  it("rejects .env, .git, and .ssh file ops", async () => {
    const root = await temp("polycode-root-");
    const sb = new LocalSandbox(root);
    await expect(sb.readFile(".env")).rejects.toThrow("not accessible");
    await expect(sb.readFile(".git/config")).rejects.toThrow("not accessible");
    await expect(sb.writeFile(".ssh/id_rsa", "x")).rejects.toThrow("not accessible");
  });

  it("omits .env from walk", async () => {
    const root = await temp("polycode-root-");
    await writeFile(join(root, ".env"), "SECRET=1");
    await writeFile(join(root, ".env.local"), "SECRET=2");
    await writeFile(join(root, "ok.txt"), "x");
    const sb = new LocalSandbox(root);
    const files: string[] = [];
    for await (const f of sb.walk()) files.push(f);
    expect(files).toContain("ok.txt");
    expect(files.some((f) => f.toLowerCase().includes(".env"))).toBe(false);
  });

  it("refuses shell that mentions .env without running it", async () => {
    const root = await temp("polycode-root-");
    const sb = new LocalSandbox(root);
    const r = await sb.exec("cat .env");
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/protected path/);
  });

  it("rejects reads and writes through a link that leaves the project", async () => {
    const root = await temp("polycode-root-");
    const outside = await temp("polycode-outside-");
    await mkdir(join(outside, "data"));
    await writeFile(join(outside, "data", "secret.txt"), "secret");
    await symlink(join(outside, "data"), join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    const sb = new LocalSandbox(root);
    await expect(sb.readFile("escape/secret.txt")).rejects.toThrow("through a link");
    await expect(sb.writeFile("escape/new.txt", "bad")).rejects.toThrow("through a link");
  });
});
