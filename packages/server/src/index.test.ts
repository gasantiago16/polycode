import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { resolveHostedMode, startServer } from "./index.js";
import type { Sandbox } from "@polycode/core";

const sandbox: Sandbox = {
  root: "test",
  async readFile() {
    return "";
  },
  async writeFile() {},
  async exec() {
    return { stdout: "", stderr: "", code: 0 };
  },
  async execFile() {
    return { stdout: "", stderr: "", code: 0 };
  },
  async *walk() {},
  async dispose() {},
};

const cfg = {
  tiers: {
    cheap: { provider: "google" as const, model: "gemini-2.5-flash" },
    strong: { provider: "google" as const, model: "gemini-2.5-flash" },
    long: { provider: "google" as const, model: "gemini-2.5-flash" },
  },
  routing: { strategy: "heuristic" as const },
};

const servers: Server[] = [];
afterEach(
  () =>
    new Promise<void>((resolve) => {
      const s = servers.pop();
      if (!s) return resolve();
      s.close(() => resolve());
    }),
);

function listen(opts: Parameters<typeof startServer>[0]): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = startServer({ ...opts, port: 0, host: "127.0.0.1" });
    servers.push(server);
    server.on("listening", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("resolveHostedMode", () => {
  it("never allows yolo unless insecure; ask becomes plan", () => {
    expect(resolveHostedMode(true, "local")).toBe("yolo");
    expect(resolveHostedMode(false, "local")).toBe("plan");
    expect(resolveHostedMode(false, "docker:abc")).toBe("acceptEdits");
    expect(resolveHostedMode(false, "local", "yolo")).toBe("plan");
    expect(resolveHostedMode(false, "local", "ask")).toBe("plan");
    expect(resolveHostedMode(false, "local", "acceptEdits")).toBe("acceptEdits");
  });
});

describe("hosted server auth", () => {
  it("refuses to start without a token unless insecure", () => {
    expect(() =>
      startServer({ cfg, port: 0, sandbox, host: "127.0.0.1" }),
    ).toThrow(/POLYCODE_AUTH_TOKEN|authToken/);
  });

  it("returns 401 without a bearer token", async () => {
    const { port } = await listen({ cfg, port: 0, sandbox, authToken: "secret" });
    const res = await fetch(`http://127.0.0.1:${port}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("accepts X-Api-Key", async () => {
    const { port } = await listen({
      cfg,
      port: 0,
      sandbox,
      authToken: "secret",
      hosted: { rateLimit: { max: 5, concurrent: 2, windowMs: 60_000 } },
    });
    const res = await fetch(`http://127.0.0.1:${port}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "secret" },
      body: JSON.stringify({ message: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("health is public and reports mode", async () => {
    const { port } = await listen({ cfg, port: 0, sandbox, authToken: "secret" });
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; auth: boolean; mode: string };
    expect(j.ok).toBe(true);
    expect(j.auth).toBe(true);
    expect(j.mode).toBe("plan");
  });

  it("rate-limits repeated unauthenticated posts", async () => {
    const { port } = await listen({
      cfg,
      port: 0,
      sandbox,
      authToken: "secret",
      hosted: { rateLimit: { max: 2, concurrent: 2, windowMs: 60_000 } },
    });
    const post = () =>
      fetch(`http://127.0.0.1:${port}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      });
    expect((await post()).status).toBe(401);
    expect((await post()).status).toBe(401);
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("requires auth on /ide and stores a context snapshot", async () => {
    const { port } = await listen({ cfg, port: 0, sandbox, authToken: "secret" });
    expect((await fetch(`http://127.0.0.1:${port}/ide`)).status).toBe(401);
    const put = await fetch(`http://127.0.0.1:${port}/ide/context`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer secret" },
      body: JSON.stringify({ file: "src/a.ts", selection: "foo" }),
    });
    expect(put.status).toBe(200);
    const got = await fetch(`http://127.0.0.1:${port}/ide/context`, {
      headers: { authorization: "Bearer secret" },
    });
    const j = (await got.json()) as { context: { file: string } };
    expect(j.context.file).toBe("src/a.ts");
  });

  it("rejects oversized bodies", async () => {
    const { port } = await listen({
      cfg,
      port: 0,
      sandbox,
      authToken: "secret",
      hosted: { maxBodyBytes: 32, rateLimit: { max: 10, concurrent: 2 } },
    });
    const res = await fetch(`http://127.0.0.1:${port}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer secret" },
      body: "x".repeat(200),
    });
    expect(res.status).toBe(413);
  });
});
