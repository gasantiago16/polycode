import { afterEach, describe, expect, it } from "vitest";
import { childProcessEnv, isSecretEnvName } from "./env.js";

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

describe("childProcessEnv", () => {
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
});
