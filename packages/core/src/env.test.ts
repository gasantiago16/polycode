import { afterEach, describe, expect, it } from "vitest";
import { childProcessEnv, isSecretEnvName, isUnsafeChildEnvName } from "./env.js";

const injected: string[] = [];
function setEnv(k: string, v: string) {
  process.env[k] = v;
  injected.push(k);
}
afterEach(() => {
  for (const k of injected.splice(0)) delete process.env[k];
});

describe("isSecretEnvName", () => {
  it.each([
    "OPENAI_API_KEY",
    "XAI_API_KEY",
    "POLYCODE_AUTH_TOKEN",
    "GITHUB_TOKEN",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_ACCESS_KEY_ID",
    "DATABASE_PASSWORD",
    "SSH_PRIVATE_KEY",
    "NPM_TOKEN",
  ])("flags %s", (name) => {
    expect(isSecretEnvName(name)).toBe(true);
  });

  it.each(["PATH", "HOME", "USERPROFILE", "NODE_ENV", "TERM", "POLYCODE_HOST"])("keeps %s", (name) => {
    expect(isSecretEnvName(name)).toBe(false);
  });
});

describe("isUnsafeChildEnvName", () => {
  it.each(["NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "LD_PRELOAD", "DYLD_LIBRARY_PATH"])(
    "flags %s",
    (name) => {
      expect(isUnsafeChildEnvName(name)).toBe(true);
    },
  );
});

describe("childProcessEnv", () => {
  it("strips NODE_OPTIONS so a repo .env cannot RCE child node", () => {
    setEnv("NODE_OPTIONS", "--require ./evil.js");
    const env = childProcessEnv();
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it("strips secrets and applies non-auth overrides", () => {
    setEnv("OPENAI_API_KEY", "sk-test");
    setEnv("POLYCODE_AUTH_TOKEN", "hosted-token-value");
    const env = childProcessEnv({
      FOO: "bar",
      POLYCODE_AUTH_TOKEN: "should-not-leak",
      MCP_TOKEN: "mcp-ok",
    });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.POLYCODE_AUTH_TOKEN).toBeUndefined();
    expect(env.FOO).toBe("bar");
    expect(env.MCP_TOKEN).toBe("mcp-ok");
    if (process.env.PATH) expect(env.PATH).toBe(process.env.PATH);
  });

  it("refuses NODE_OPTIONS even when passed as an MCP override", () => {
    const env = childProcessEnv({ NODE_OPTIONS: "--require ./pwn.js", FOO: "ok" });
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.FOO).toBe("ok");
  });
});
