import { describe, expect, it } from "vitest";
import { formatIdeBlock } from "./ide.js";

describe("formatIdeBlock", () => {
  it("is empty without a snapshot", () => {
    expect(formatIdeBlock(undefined)).toBe("");
    expect(formatIdeBlock({})).toBe("");
  });
  it("renders file and selection", () => {
    const block = formatIdeBlock({ file: "src/a.ts", language: "typescript", selection: "const x = 1" });
    expect(block).toContain("<ide>");
    expect(block).toContain("src/a.ts");
    expect(block).toContain("const x = 1");
  });
});
