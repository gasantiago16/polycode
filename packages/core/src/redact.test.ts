import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  it("scrubs common API key shapes", () => {
    const { text, count } = redactSecrets(
      "key sk-abcdefghijklmnopqrstuvwxyz123456 and xai-abcdefghijk and OPENAI_API_KEY=supersecretvalue",
    );
    expect(count).toBeGreaterThanOrEqual(2);
    expect(text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(text).not.toContain("supersecretvalue");
    expect(text).toContain("[REDACTED]");
  });
  it("scrubs PEM blocks", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIK\n-----END PRIVATE KEY-----";
    const { text, count } = redactSecrets(pem);
    expect(count).toBe(1);
    expect(text).toBe("[REDACTED PRIVATE KEY]");
  });
  it("leaves ordinary tool output alone", () => {
    const { text, count } = redactSecrets("read src/index.ts ok");
    expect(count).toBe(0);
    expect(text).toBe("read src/index.ts ok");
  });
});
