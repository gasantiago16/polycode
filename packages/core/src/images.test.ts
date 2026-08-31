import { describe, expect, it } from "vitest";
import { expandUserMessage, isImagePath, loadImagePart } from "./images.js";
import type { Sandbox } from "./types.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function sb(): Sandbox {
  return {
    root: "t",
    async readFile(rel) {
      if (rel === "src/a.ts") return "export const a = 1;\n";
      throw new Error("missing");
    },
    async readFileBytes(rel) {
      if (rel === "shot.png") return PNG;
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
}

describe("images", () => {
  it("recognizes image extensions", () => {
    expect(isImagePath("shot.PNG")).toBe(true);
    expect(isImagePath("src/a.ts")).toBe(false);
  });

  it("loads a png and expands @image separately from @file", async () => {
    const img = await loadImagePart("shot.png", sb());
    expect(img.type).toBe("image");
    expect(img.mediaType).toBe("image/png");
    expect(img.data.length).toBeGreaterThan(10);
    const { text, extras } = await expandUserMessage("see @src/a.ts and @shot.png", sb());
    expect(text).toContain('path="src/a.ts"');
    expect(text).toContain("[image shot.png]");
    expect(extras).toHaveLength(1);
    expect(extras[0].type).toBe("image");
  });
});
