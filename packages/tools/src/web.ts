import { assertPublicHttpUrl, assertSafeHttpUrl, type ToolSpec } from "@polycode/core";

const MAX_BYTES = 80_000;
const FETCH_MS = 15_000;

/** @deprecated use assertSafeHttpUrl — kept as a name alias for tests. */
export function assertSafeUrl(raw: string): URL {
  return assertSafeHttpUrl(raw);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchSafe(
  raw: string,
  fetchImpl: typeof fetch = fetch,
  lookupFn?: Parameters<typeof assertPublicHttpUrl>[1],
): Promise<{ url: string; text: string }> {
  const url = await assertPublicHttpUrl(raw, lookupFn);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetchImpl(url.toString(), {
      signal: ctrl.signal,
      redirect: "error",
      headers: { "user-agent": "polycode-web-fetch/0.1" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const sliced = buf.subarray(0, MAX_BYTES);
    const ctype = res.headers.get("content-type") ?? "";
    let text = sliced.toString("utf8");
    if (/html/i.test(ctype) || /<html/i.test(text.slice(0, 200))) text = htmlToText(text);
    if (buf.length > MAX_BYTES) text += `\n…[truncated at ${MAX_BYTES} bytes]`;
    return { url: url.toString(), text };
  } finally {
    clearTimeout(t);
  }
}

export const webFetch: ToolSpec = {
  name: "web_fetch",
  description:
    "Fetch a public http(s) URL from the host process (not the docker bash network). Blocked: file://, localhost, RFC1918, link-local, DNS-to-private. Returns text/markdown, size-capped. Redirects are not followed.",
  permission: "dangerous",
  parallelSafe: true,
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Public http or https URL" },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async run(input: { url: string }) {
    try {
      const { url, text } = await fetchSafe(input.url);
      return { output: `url: ${url}\n\n${text}` };
    } catch (e) {
      return { output: String(e), isError: true };
    }
  },
};
