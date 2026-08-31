import { describe, expect, it } from "vitest";
import { expandAtMentions } from "./mentions.js";
import type { Sandbox } from "./types.js";

const sandbox: Sandbox = {
  root: "t",
  async readFile(rel) {
    if (rel === "src/a.ts") return "export const a = 1;\n";
    throw new Error("missing");
  },
  async writeFile() {},
  async exec() {
    return { stdout: "", stderr: "", code: 0 };
  },
  async execFile() {
    return { stdout: "", stderr: "", code: 0 };
  },
  async *walk() {},
  async dispose() {},
};

describe("expandAtMentions", () => {
  it("inlines existing files and leaves misses", async () => {
    const out = await expandAtMentions("see @src/a.ts and @nope.ts", sandbox);
    expect(out).toContain('path="src/a.ts"');
    expect(out).toContain("export const a = 1;");
    expect(out).toContain("@nope.ts");
  });
});
