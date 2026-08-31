import { describe, expect, it } from "vitest";
import { DEFAULT_STATUS_TEMPLATE, formatStatusLine, type StatusLineVars } from "./statusline.js";

const base: StatusLineVars = {
  model: "openai:gpt-5.5",
  mode: "ask",
  route: "off",
  sandbox: "local",
  ctxUsed: 0,
  ctxWindow: 128_000,
  sessionTokens: 0,
  mcpOk: 0,
  mcpTotal: 0,
  mcpDeferred: 0,
  cost: "$0.00",
  cwd: "/proj/polycode",
};

describe("formatStatusLine", () => {
  it("matches the built-in default when idle", () => {
    expect(formatStatusLine(DEFAULT_STATUS_TEMPLATE, base)).toBe(
      "openai:gpt-5.5 · ask · route:off · sandbox:local",
    );
  });

  it("appends ctx, session tokens, and mcp when present", () => {
    const line = formatStatusLine(DEFAULT_STATUS_TEMPLATE, {
      ...base,
      ctxUsed: 12_000,
      sessionTokens: 40_000,
      mcpOk: 2,
      mcpTotal: 3,
    });
    expect(line).toContain("ctx 12k/128k");
    expect(line).toContain("Σ 40k tok");
    expect(line).toContain("mcp:2/3");
  });

  it("substitutes a custom template", () => {
    expect(formatStatusLine("$model $mode $cwd", { ...base, cwd: "/tmp/app" })).toBe(
      "openai:gpt-5.5 ask app",
    );
  });
});
