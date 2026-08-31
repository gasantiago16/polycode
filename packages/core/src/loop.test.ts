import { describe, expect, it } from "vitest";
import {
  MAX_LOOP_MS,
  MIN_LOOP_MS,
  formatLoopInterval,
  nextLoopId,
  parseLoopCommand,
  parseLoopInterval,
} from "./loop.js";

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

  it("rejects intervals that would overflow setInterval", () => {
    const r = parseLoopCommand("/loop 25d say ping");
    expect(r).toMatchObject({ op: "usage" });
    expect(parseLoopInterval("25d")).toBeNull();
    expect(parseLoopInterval("24h")).toBe(MAX_LOOP_MS);
    expect(parseLoopCommand("/loop 1d tick")).toMatchObject({ op: "start", intervalMs: MAX_LOOP_MS });
  });
});

describe("nextLoopId", () => {
  it("never reuses an id after stop", () => {
    const seq = { current: 0 };
    expect(nextLoopId(seq)).toBe("l1");
    expect(nextLoopId(seq)).toBe("l2");
    // stop l1 — seq is monotonic so the next start is l3, not a second l2
    expect(nextLoopId(seq)).toBe("l3");
  });
});
