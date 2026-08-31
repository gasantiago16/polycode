import { describe, expect, it, vi } from "vitest";
import { assertSafeUrl, fetchSafe, htmlToText, webFetch } from "./web.js";

describe("assertSafeUrl", () => {
  it("allows public https", () => {
    expect(assertSafeUrl("https://example.com/a").host).toBe("example.com");
  });
  it.each([
    "file:///etc/passwd",
    "http://127.0.0.1/secret",
    "http://localhost:8080/",
    "http://10.0.0.4/",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://0.0.0.0/",
  ])("blocks %s", (u) => {
    expect(() => assertSafeUrl(u)).toThrow(/blocked|protocol/);
  });
});

describe("htmlToText", () => {
  it("strips tags and scripts", () => {
    expect(htmlToText("<html><script>alert(1)</script><p>Hi &amp; bye</p></html>")).toBe("Hi & bye");
  });
});

describe("fetchSafe / web_fetch", () => {
  it("does not follow redirects and caps output", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response("hello world", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }) as unknown as typeof fetch;
    const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
    const r = await fetchSafe("https://example.com/x", fetchImpl, publicDns);
    expect(r.text).toBe("hello world");
    expect(fetchImpl).toHaveBeenCalled();
    const init = (fetchImpl as any).mock.calls[0][1];
    expect(init.redirect).toBe("error");
  });

  it("does not fetch when DNS maps to a private address", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      fetchSafe("https://evil.example", fetchImpl, async () => [{ address: "127.0.0.1", family: 4 }]),
    ).rejects.toThrow(/blocked resolved/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("web_fetch reports blocked URLs as tool errors", async () => {
    const r = await webFetch.run({ url: "http://127.0.0.1/" }, { sandbox: {} as any });
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/blocked/);
  });
});
