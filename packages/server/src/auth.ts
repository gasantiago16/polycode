import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

function sha(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** Constant-time compare so token length / mismatch timing does not leak. */
export function tokenEquals(got: string, expected: string): boolean {
  if (!expected) return false;
  return timingSafeEqual(sha(got), sha(expected));
}

/** Bearer token or `X-Api-Key`. Bearer wins if both are present. */
export function extractToken(req: IncomingMessage): string {
  const auth = req.headers.authorization ?? "";
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  const key = req.headers["x-api-key"];
  if (typeof key === "string") return key.trim();
  if (Array.isArray(key) && key[0]) return String(key[0]).trim();
  return "";
}

export function bearerOk(req: IncomingMessage, expected?: string | string[]): boolean {
  const tokens = Array.isArray(expected) ? expected : expected ? [expected] : [];
  if (!tokens.length) return false;
  const got = extractToken(req);
  if (!got) return false;
  return tokens.some((t) => tokenEquals(got, t));
}

export const MIN_AUTH_TOKEN_LENGTH = 16;

export function normalizeAuthTokens(raw: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const t of raw) {
    const s = t?.trim();
    if (!s) continue;
    if (s.length < MIN_AUTH_TOKEN_LENGTH) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}
