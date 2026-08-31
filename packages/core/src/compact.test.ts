import { describe, expect, it, vi } from "vitest";
import {
  ELIDE_MARK,
  compactMessages,
  contextBreakdown,
  elideOldToolResults,
  estimateTokens,
  groupTurns,
  originalTask,
  overThreshold,
  reducedEnough,
} from "./compact.js";
import type { CanonicalMessage, ToolResultPart } from "./types.js";

function user(text: string): CanonicalMessage {
  return { role: "user", content: [{ type: "text", text }] };
}
function assistant(text: string): CanonicalMessage {
  return { role: "assistant", content: [{ type: "text", text }] };
}
function tool(id: string, name: string, output: string): CanonicalMessage {
  const p: ToolResultPart = { type: "tool_result", id, name, output };
  return { role: "tool", content: [p] };
}

describe("estimateTokens", () => {
  it("is chars/4 rounded up", () => {
    expect(estimateTokens([user("abcd")])).toBe(1);
    expect(estimateTokens([user("abcde")])).toBe(2);
  });
});

describe("elideOldToolResults", () => {
  it("leaves the last K tool messages intact and marks older ones", () => {
    const msgs = [
      user("task"),
      tool("1", "read", "line1\nHUGE BODY ".repeat(20)),
      tool("2", "read", "keep-me-2"),
      tool("3", "read", "keep-me-3"),
    ];
    const out = elideOldToolResults(msgs, 2);
    const outputs = out
      .filter((m) => m.role === "tool")
      .map((m) => (m.content[0] as ToolResultPart).output);
    expect(outputs[0]).toContain(ELIDE_MARK);
    expect(outputs[0]).not.toContain("HUGE BODY HUGE BODY");
    expect(outputs[1]).toBe("keep-me-2");
    expect(outputs[2]).toBe("keep-me-3");
  });

  it("is a no-op when there are few tool messages", () => {
    const msgs = [user("t"), tool("1", "read", "only")];
    expect((elideOldToolResults(msgs, 6)[1].content[0] as ToolResultPart).output).toBe("only");
  });
});

describe("groupTurns / originalTask", () => {
  it("splits on user messages and keeps the first task", () => {
    const msgs = [user("do X"), assistant("ok"), user("now Y"), assistant("done")];
    expect(groupTurns(msgs)).toHaveLength(2);
    expect(originalTask(msgs)).toBe("do X");
  });
});

describe("compactMessages", () => {
  it("pass 1 reduces a bloated tool history under a tiny window", async () => {
    const fat = "x".repeat(800);
    const messages = [user("task"), tool("1", "read", fat), tool("2", "read", fat), tool("3", "read", "recent")];
    const { stats, messages: out } = await compactMessages({
      messages,
      contextWindow: 200,
      reason: "auto",
      config: { keepRecentToolResults: 1, thresholdPercent: 85 },
    });
    expect(stats.pass).toBe("elide");
    expect(stats.after).toBeLessThan(stats.before);
    expect((out[3].content[0] as ToolResultPart).output).toBe("recent");
  });

  it("pass 2 summarizes the middle turns and keeps the original task plus suffix", async () => {
    const turns: CanonicalMessage[] = [user("ship the landing burn")];
    for (let i = 0; i < 12; i++) {
      turns.push(user(`step ${i}`), assistant(`did ${i}`));
    }
    const summarize = vi.fn(async () => "kept the landing burn and steps 0-3");
    const { stats, messages: out } = await compactMessages({
      messages: turns,
      contextWindow: 50,
      reason: "auto",
      config: { keepRecentTurns: 3, summarize, thresholdPercent: 10 },
    });
    expect(stats.pass).toBe("summarize");
    expect(summarize).toHaveBeenCalledOnce();
    expect(originalTask(out)).toBe("ship the landing burn");
    const texts = out.map((m) =>
      m.content.map((p) => (p.type === "text" ? p.text : "")).join(""),
    );
    expect(texts.some((t) => t.includes("<compacted-history>"))).toBe(true);
    expect(texts.some((t) => t.includes("step 11") || t.includes("did 11"))).toBe(true);
  });

  it("keeps the prior messages when the summarizer throws", async () => {
    const messages = [user("task")];
    for (let i = 0; i < 10; i++) messages.push(user(`u${i}`), assistant(`a${i}`));
    const { pass, after, before } = (
      await compactMessages({
        messages,
        contextWindow: 20,
        reason: "auto",
        config: {
          keepRecentTurns: 2,
          summarize: async () => {
            throw new Error("nope");
          },
        },
      })
    ).stats;
    expect(pass).toBe("none"); // nothing to elide; summarizer threw so prefix stays
    expect(after).toBe(before);
  });

  it("honors a manual focus string inside the summary payload", async () => {
    const messages = [user("task")];
    for (let i = 0; i < 10; i++) messages.push(user(`u${i}`), assistant(`a${i}`));
    const { messages: out } = await compactMessages({
      messages,
      contextWindow: 20,
      reason: "manual",
      focus: "keep the tool names",
      config: { keepRecentTurns: 2, summarize: async () => "summary body" },
    });
    const blob = JSON.stringify(out);
    expect(blob).toContain("keep the tool names");
    expect(blob).toContain("summary body");
  });
});

describe("overThreshold / reducedEnough / contextBreakdown", () => {
  it("triggers at 85% of the window", () => {
    expect(overThreshold(85, 100, 85)).toBe(true);
    expect(overThreshold(84, 100, 85)).toBe(false);
  });
  it("requires a 10% shrink", () => {
    expect(reducedEnough(100, 89)).toBe(true);
    expect(reducedEnough(100, 91)).toBe(false);
  });
  it("splits system / messages / tool output", () => {
    const b = contextBreakdown({
      messages: [user("hi"), tool("1", "read", "abcdef")],
      system: "sys",
      toolSchemaChars: 8,
      contextWindow: 1000,
    });
    expect(b.window).toBe(1000);
    expect(b.toolOutput).toBeGreaterThan(0);
    expect(b.total).toBeGreaterThan(b.messages);
  });
});
