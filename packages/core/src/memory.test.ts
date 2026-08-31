import { describe, expect, it } from "vitest";
import { appendMemory, readMemory, replaceMemory, MEMORY_PATH } from "./memory.js";
import type { Sandbox } from "./types.js";

function memSandbox(start = ""): { sandbox: Sandbox; files: Map<string, string> } {
  const files = new Map<string, string>();
  if (start) files.set(MEMORY_PATH, start);
  const sandbox: Sandbox = {
    root: "t",
    async readFile(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error("missing");
      return v;
    },
    async writeFile(p, c) {
      files.set(p, c);
    },
    async exec() {
      return { stdout: "", stderr: "", code: 0 };
    },
    async execFile() {
      return { stdout: "", stderr: "", code: 0 };
    },
    async *walk() {},
    async dispose() {},
  };
  return { sandbox, files };
}

describe("memory", () => {
  it("appends a dated note and replace overwrites", async () => {
    const { sandbox, files } = memSandbox();
    const r = await appendMemory(sandbox, "prefer docker sandbox", new Date("2026-08-31"));
    expect(r.path).toBe(MEMORY_PATH);
    expect(await readMemory(sandbox)).toContain("## 2026-08-31");
    expect(files.get(MEMORY_PATH)).toContain("prefer docker sandbox");
    await replaceMemory(sandbox, "only this");
    expect((await readMemory(sandbox)).trim()).toBe("only this");
  });

  it("rejects empty append", async () => {
    const { sandbox } = memSandbox();
    await expect(appendMemory(sandbox, "   ")).rejects.toThrow(/empty/);
  });
});
