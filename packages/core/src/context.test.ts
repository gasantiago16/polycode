import { describe, expect, it } from "vitest";
import { gatherContext } from "./context.js";
import { MEMORY_PATH } from "./memory.js";
import type { Sandbox } from "./types.js";

describe("gatherContext", () => {
  it("inlines curated memory when present", async () => {
    const sandbox: Sandbox = {
      root: "t",
      async readFile(p) {
        if (p === MEMORY_PATH) return "ship isolation=worktree for child edits\n";
        throw new Error("missing");
      },
      async writeFile() {},
      async exec() {
        return { stdout: "", stderr: "", code: 1 };
      },
      async execFile() {
        return { stdout: "", stderr: "", code: 1 };
      },
      async *walk() {},
      async dispose() {},
    };
    const ctx = await gatherContext({ cwd: "/proj", sandbox, now: new Date("2026-08-31"), platform: "win32" });
    expect(ctx).toContain("<memory");
    expect(ctx).toContain("isolation=worktree");
    expect(ctx).toContain("Working directory: /proj");
  });
});
