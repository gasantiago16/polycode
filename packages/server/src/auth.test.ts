import { describe, expect, it } from "vitest";
import { bearerOk, extractToken, normalizeAuthTokens, tokenEquals } from "./auth.js";
import type { IncomingMessage } from "node:http";

function req(headers: Record<string, string | string[]>): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe("auth", () => {
  it("compares tokens in constant time and rejects mismatches", () => {
    expect(tokenEquals("secret", "secret")).toBe(true);
    expect(tokenEquals("secret", "Secret")).toBe(false);
    expect(tokenEquals("", "secret")).toBe(false);
    expect(tokenEquals("short", "much-longer-token")).toBe(false);
  });

  it("reads Bearer then X-Api-Key", () => {
    expect(extractToken(req({ authorization: "Bearer abc" }))).toBe("abc");
    expect(extractToken(req({ "x-api-key": "k" }))).toBe("k");
    expect(extractToken(req({ authorization: "Bearer a", "x-api-key": "k" }))).toBe("a");
    expect(extractToken(req({}))).toBe("");
  });

  it("accepts any of several tokens", () => {
    const tokens = ["token-one-16xxxx", "token-two-16xxxx"];
    expect(bearerOk(req({ authorization: "Bearer token-two-16xxxx" }), tokens)).toBe(true);
    expect(bearerOk(req({ authorization: "Bearer no-match-16chars" }), tokens)).toBe(false);
  });

  it("drops tokens shorter than 16 characters", () => {
    expect(normalizeAuthTokens(["short", "  ", "this-is-16-chars"])).toEqual(["this-is-16-chars"]);
  });
});
