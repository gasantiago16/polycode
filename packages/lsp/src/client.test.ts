import { describe, expect, it } from "vitest";
import { matchServer } from "./client.js";

describe("matchServer", () => {
  const servers = [
    { language: "typescript", command: "typescript-language-server", extensions: [".ts", ".tsx"] },
    { language: "python", command: "pylsp", extensions: [".py"] },
  ];
  it("picks by extension then language", () => {
    expect(matchServer(servers, "src/a.ts")?.language).toBe("typescript");
    expect(matchServer(servers, "app.py")?.language).toBe("python");
    expect(matchServer(servers, "README.md")).toBeUndefined();
  });
});
