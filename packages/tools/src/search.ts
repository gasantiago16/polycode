import type { ToolSpec } from "@polycode/core";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export type SearchFn = (query: string) => Promise<SearchHit[]>;

export function pickSearchBackend(env: NodeJS.ProcessEnv = process.env): { name: string; search: SearchFn } | null {
  if (env.TAVILY_API_KEY) {
    return { name: "tavily", search: (q) => tavilySearch(q, env.TAVILY_API_KEY!, fetch) };
  }
  if (env.BRAVE_API_KEY) {
    return { name: "brave", search: (q) => braveSearch(q, env.BRAVE_API_KEY!, fetch) };
  }
  return null;
}

export async function tavilySearch(query: string, key: string, fetchImpl: typeof fetch): Promise<SearchHit[]> {
  const res = await fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: key, query, max_results: 8, search_depth: "basic" }),
  });
  if (!res.ok) throw new Error(`tavily HTTP ${res.status}`);
  const json = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (json.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.content ?? "").slice(0, 280),
  }));
}

export async function braveSearch(query: string, key: string, fetchImpl: typeof fetch): Promise<SearchHit[]> {
  const u = new URL("https://api.search.brave.com/res/v1/web/search");
  u.searchParams.set("q", query);
  u.searchParams.set("count", "8");
  const res = await fetchImpl(u, { headers: { Accept: "application/json", "X-Subscription-Token": key } });
  if (!res.ok) throw new Error(`brave HTTP ${res.status}`);
  const json = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (json.web?.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.description ?? "").slice(0, 280),
  }));
}

export function formatHits(hits: SearchHit[]): string {
  if (!hits.length) return "(no results)";
  return hits
    .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
    .join("\n\n");
}

export const webSearch: ToolSpec = {
  name: "web_search",
  description:
    "Search the public web (Tavily if TAVILY_API_KEY is set, else Brave if BRAVE_API_KEY is set). Host-side, not docker bash. Returns titles, URLs, snippets. Then web_fetch the primaries.",
  permission: "dangerous",
  parallelSafe: true,
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Search query" } },
    required: ["query"],
    additionalProperties: false,
  },
  async run(input: { query: string }) {
    const backend = pickSearchBackend();
    if (!backend) {
      return {
        output:
          "web_search is not configured. Set TAVILY_API_KEY or BRAVE_API_KEY (host env / .env). Docker bash stays offline.",
        isError: true,
      };
    }
    try {
      const hits = await backend.search(input.query);
      return { output: `backend: ${backend.name}\nquery: ${input.query}\n\n${formatHits(hits)}` };
    } catch (e) {
      return { output: String(e), isError: true };
    }
  },
};
