import { describe, expect, it, vi } from "vitest";
import { braveSearch, formatHits, pickSearchBackend, tavilySearch, webSearch } from "./search.js";

describe("pickSearchBackend", () => {
  it("prefers Tavily then Brave", () => {
    expect(pickSearchBackend({})).toBeNull();
    expect(pickSearchBackend({ TAVILY_API_KEY: "t", BRAVE_API_KEY: "b" })?.name).toBe("tavily");
    expect(pickSearchBackend({ BRAVE_API_KEY: "b" })?.name).toBe("brave");
  });
});

describe("search adapters", () => {
  it("parses Tavily JSON", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ title: "A", url: "https://a.example", content: "hello" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const hits = await tavilySearch("q", "key", fetchImpl);
    expect(hits[0]).toEqual({ title: "A", url: "https://a.example", snippet: "hello" });
  });
  it("parses Brave JSON", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ web: { results: [{ title: "B", url: "https://b.example", description: "world" }] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;
    const hits = await braveSearch("q", "key", fetchImpl);
    expect(hits[0].title).toBe("B");
  });
});

describe("web_search tool", () => {
  it("errors clearly when no key is set", async () => {
    const prevT = process.env.TAVILY_API_KEY;
    const prevB = process.env.BRAVE_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_API_KEY;
    const r = await webSearch.run({ query: "x" }, { sandbox: {} as any });
    if (prevT) process.env.TAVILY_API_KEY = prevT;
    if (prevB) process.env.BRAVE_API_KEY = prevB;
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/TAVILY_API_KEY|BRAVE_API_KEY/);
  });
});

describe("formatHits", () => {
  it("renders numbered rows", () => {
    expect(formatHits([{ title: "T", url: "https://t", snippet: "s" }])).toContain("https://t");
  });
});
