import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaintBuffer } from "./paint.js";
import { parseMarkdown } from "./markdown.js";

describe("streaming paint buffer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not flush 80 token deltas as 80 paints", () => {
    vi.useFakeTimers();
    const flushed: string[] = [];
    const paint = createPaintBuffer((c) => flushed.push(c), 100);
    for (let i = 0; i < 80; i++) paint.push("x");
    expect(flushed.length).toBe(0);
    vi.advanceTimersByTime(250);
    paint.flush();
    expect(flushed.length).toBeLessThanOrEqual(15);
    expect(flushed.join("")).toBe("x".repeat(80));
    expect(paint.paintCount).toBeLessThanOrEqual(15);
  });

  it("flush emits the remainder immediately (tool_call / stop)", () => {
    const flushed: string[] = [];
    const paint = createPaintBuffer((c) => flushed.push(c), 10_000);
    paint.push("hello");
    paint.flush();
    expect(flushed).toEqual(["hello"]);
  });
});

describe("streaming markdown fences", () => {
  it("marks an unclosed fence as open (no border)", () => {
    const blocks = parseMarkdown("intro\n```ts\nconst x = 1\n");
    const code = blocks.find((b) => b.type === "code");
    expect(code && code.type === "code" && code.open).toBe(true);
  });
  it("closed fences are not open", () => {
    const blocks = parseMarkdown("```ts\nconst x = 1\n```\n");
    const code = blocks.find((b) => b.type === "code");
    expect(code && code.type === "code" && !code.open).toBe(true);
  });
});
