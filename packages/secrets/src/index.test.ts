import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ENV_VAR, getKey, hydrateEnv, loadDotEnvFiles } from "./index.js";

const KEYS = ["XAI_API_KEY", "GROK_API_KEY", "MODEL_API_KEY", "MUSE_API_KEY", "OPENAI_API_KEY"] as const;
let snapshot: Record<string, string | undefined> = {};
beforeEach(() => {
  snapshot = {};
  for (const k of KEYS) {
    snapshot[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (snapshot[k] == null) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
});

describe("xAI / Grok env aliases", () => {
  it("accepts GROK_API_KEY as XAI_API_KEY", () => {
    process.env.GROK_API_KEY = "xai-from-grok-alias";
    expect(getKey("xai")).toBe("xai-from-grok-alias");
    hydrateEnv();
    expect(process.env.XAI_API_KEY).toBe("xai-from-grok-alias");
  });
});

describe("loadDotEnvFiles", () => {
  it("loads KEY=VALUE without clobbering existing env", () => {
    const dir = join(tmpdir(), `poly-dotenv-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".env"), 'GROK_API_KEY="xai-from-file"\nXAI_API_KEY=xai-primary\n');
    process.env.OPENAI_API_KEY = "keep-me";
    const loaded = loadDotEnvFiles([join(dir, ".env")]);
    expect(loaded.some((f) => f.endsWith(".env"))).toBe(true);
    expect(process.env.GROK_API_KEY).toBe("xai-from-file");
    expect(process.env.XAI_API_KEY).toBe("xai-primary");
    expect(process.env.OPENAI_API_KEY).toBe("keep-me");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("hydrateEnv aliases", () => {
  it("fills MODEL_API_KEY for Muse from the stored env name", () => {
    process.env[ENV_VAR.muse] = "muse-key";
    hydrateEnv();
    expect(process.env.MODEL_API_KEY).toBe("muse-key");
  });
});
