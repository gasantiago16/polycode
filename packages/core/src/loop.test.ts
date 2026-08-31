import { describe, expect, it } from "vitest";
import { MIN_LOOP_MS, formatLoopInterval, parseLoopCommand, parseLoopInterval } from "./loop.js";

describe("parseLoopInterval", () => {
  it("parses s/m/h/d", () => {
    expect(parseLoopInterval("60s")).toBe(60_000);
    expect(parseLoopInterval("5m")).toBe(300_000);
    expect(parseLoopInterval("2h")).toBe(7_200_000);
    expect(parseLoopInterval("1d")).toBe(86_400_000);
    expect(parseLoopInterval("nope")).toBeNull();
  });
});

describe("parseLoopCommand", () => {
  it("lists, stops, and starts", () => {
    expect(parseLoopCommand("/loop")).toEqual({ op: "list" });
    expect(parseLoopCommand("/loop stop")).toEqual({ op: "stop", id: undefined });
    expect(parseLoopCommand("/loop stop l2")).toEqual({ op: "stop", id: "l2" });
    expect(parseLoopCommand("/loop 5m check tests")).toEqual({
      op: "start",
      intervalMs: 300_000,
      prompt: "check tests",
    });
    expect(parseLoopCommand("/loop keep an eye on CI")).toEqual({
      op: "start",
      intervalMs: 300_000,
      prompt: "keep an eye on CI",
    });
  });

  it("rejects intervals under the minimum", () => {
    const r = parseLoopCommand("/loop 1s too fast");
    expect(r.op).toBe("usage");
    expect(formatLoopInterval(MIN_LOOP_MS)).toBe("15s");
  });
});
