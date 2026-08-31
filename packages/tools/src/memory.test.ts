import { describe, expect, it } from "vitest";
import { LocalSandbox } from "@polycode/sandbox";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { memory } from "./memory.js";
import { MEMORY_PATH } from "@polycode/core";

describe("memory tool", () => {
  it("appends then reads", async () => {
    const root = await mkdtemp(join(tmpdir(), "poly-mem-"));
    try {
      const ctx = { sandbox: new LocalSandbox(root) };
      const a = await memory.run({ action: "append", content: "use pnpm" }, ctx);
      expect(a.isError).toBeFalsy();
      const r = await memory.run({ action: "read" }, ctx);
      expect(r.output).toContain("use pnpm");
      expect(MEMORY_PATH).toBe(".polycode/memory.md");
      await memory.run({ action: "replace", content: "only" }, ctx);
      const again = await memory.run({ action: "read" }, ctx);
      expect(again.output.trim()).toBe("only");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
