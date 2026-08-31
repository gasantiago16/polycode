import { afterEach, describe, expect, it } from "vitest";
import {
  configureProviders,
  defaultModel,
  makeProvider,
  parseModelArg,
  resetProviderRuntime,
  resolvedCompatEndpoint,
  setPolicy,
} from "./index.js";

afterEach(() => {
  resetProviderRuntime();
  delete process.env.NVIDIA_BASE_URL;
});

describe("parseModelArg", () => {
  it("parses slash-containing NVIDIA ids", () => {
    expect(parseModelArg("nvidia:nvidia/nemotron-3-super-120b-a12b")).toEqual({
      provider: "nvidia",
      model: "nvidia/nemotron-3-super-120b-a12b",
    });
  });
  it("parses muse, qwen, anthropic", () => {
    expect(parseModelArg("muse:muse-spark-1.2").provider).toBe("muse");
    expect(parseModelArg("qwen:qwen3-coder-plus").provider).toBe("qwen");
    expect(parseModelArg("anthropic:claude-sonnet-4-5").provider).toBe("anthropic");
  });
  it("rejects unknown providers", () => {
    expect(() => parseModelArg("foo:bar")).toThrow(/unknown provider/);
  });
});

describe("training-tier policy", () => {
  it("refuses muse contributor unless opted in", () => {
    expect(() =>
      makeProvider({ provider: "muse", model: "muse-spark-1.2-contributor" }),
    ).toThrow(/training-tier|contributor/i);
  });
  it("allows contributor after allowTrainingTiers", () => {
    setPolicy({ allowTrainingTiers: true });
    const p = makeProvider({ provider: "muse", model: "muse-spark-1.2-contributor" });
    expect(p.id).toBe("muse");
    expect(p.model).toBe("muse-spark-1.2-contributor");
  });
  it("honors a company allowlist", () => {
    setPolicy({ allowedProviders: ["openai", "google"] });
    expect(() => makeProvider({ provider: "muse", model: "muse-spark-1.2" })).toThrow(/allowlist/);
    expect(makeProvider({ provider: "google", model: "gemini-2.5-flash" }).id).toBe("google");
  });
});

describe("openai-compat endpoints", () => {
  it("uses NVIDIA_BASE_URL for on-prem NIM", () => {
    process.env.NVIDIA_BASE_URL = "http://127.0.0.1:8000/v1";
    expect(resolvedCompatEndpoint("nvidia")?.baseURL).toBe("http://127.0.0.1:8000/v1");
  });
  it("defaults Muse to api.meta.ai", () => {
    expect(resolvedCompatEndpoint("muse")?.baseURL).toBe("https://api.meta.ai/v1");
  });
  it("wires a custom openai-compat provider from config", () => {
    configureProviders({
      custom: [
        {
          id: "local-nim",
          baseURL: "http://127.0.0.1:8000/v1",
          envKey: "NVIDIA_API_KEY",
        },
      ],
    });
    const spec = parseModelArg("local-nim:meta/llama-3.3-70b-instruct");
    expect(spec).toEqual({ provider: "local-nim", model: "meta/llama-3.3-70b-instruct" });
    expect(resolvedCompatEndpoint("local-nim")?.baseURL).toBe("http://127.0.0.1:8000/v1");
    const p = makeProvider(spec);
    expect(p.id).toBe("local-nim");
  });
});

describe("makeProvider constructs without network", () => {
  it("builds anthropic, muse, qwen, nvidia", () => {
    for (const spec of [
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      { provider: "muse", model: "muse-spark-1.2" },
      { provider: "qwen", model: "qwen3-coder-plus" },
      { provider: "nvidia", model: "nvidia/nemotron-3-nano-30b-a3b" },
    ]) {
      const p = makeProvider(spec);
      expect(p.id).toBe(spec.provider);
      expect(p.capabilities().supportsTools).toBe(true);
      expect(p.capabilities().contextWindow).toBeGreaterThan(1000);
    }
  });
});

describe("defaultModel", () => {
  it("returns pinned cheap ids", () => {
    expect(defaultModel("google", "cheap")).toBe("gemini-2.5-flash");
    expect(defaultModel("muse", "strong")).toBe("muse-spark-1.2");
  });
});
