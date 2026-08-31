import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  addGitWorktree,
  applyGitWorktree,
  listGitWorktrees,
  removeGitWorktree,
  resolveGitWorktree,
} from "./worktree.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function gitOk(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!gitOk())("git worktree", () => {
  it("isolates writes from the parent tree", { timeout: 20_000 }, () => {
    const root = join(tmpdir(), `poly-wt-${Date.now()}`);
    mkdirSync(root);
    dirs.push(root);
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "t@t.test"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "t"], { cwd: root, stdio: "ignore" });
    writeFileSync(join(root, "a.txt"), "parent\n");
    execFileSync("git", ["add", "a.txt"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" });

    return addGitWorktree(root).then(async (wt) => {
      dirs.push(wt);
      writeFileSync(join(wt, "a.txt"), "child\n");
      writeFileSync(join(wt, "new.txt"), "untracked\n");
      expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("parent\n");
      expect(readFileSync(join(wt, "a.txt"), "utf8")).toBe("child\n");

      const listed = listGitWorktrees(root);
      expect(listed).toContain(wt);
      expect(resolveGitWorktree(root, wt.split(/[\\/]/).pop()!)).toBe(wt);
      expect(resolveGitWorktree(root, "../secret")).toBeNull();

      const applied = await applyGitWorktree(root, wt);
      expect(applied.files).toEqual(expect.arrayContaining(["a.txt", "new.txt"]));
      expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("child\n");
      expect(readFileSync(join(root, "new.txt"), "utf8")).toBe("untracked\n");

      await expect(applyGitWorktree(root, root)).rejects.toThrow(/outside/);

      await removeGitWorktree(root, wt);
      expect(existsSync(wt)).toBe(false);
    });
  });
});
