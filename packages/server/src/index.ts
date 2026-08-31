import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import {
  Agent,
  PermissionEngine,
  type CompactConfig,
  type HookSet,
  type PermissionMode,
  type PermissionRule,
  type Sandbox,
  type ToolSpec,
} from "@polycode/core";
import { Router, type RouterConfig } from "@polycode/router";
import { tools as defaultTools } from "@polycode/tools";
import { bearerOk } from "./auth.js";
import { RateLimiter, type RateLimitConfig } from "./ratelimit.js";
import { formatIdeBlock, type IdeCatalog, type IdeSnapshot } from "./ide.js";

export { bearerOk, extractToken, tokenEquals, normalizeAuthTokens, MIN_AUTH_TOKEN_LENGTH } from "./auth.js";
export { RateLimiter, type RateLimitConfig } from "./ratelimit.js";
export { formatIdeBlock, type IdeCatalog, type IdeSnapshot } from "./ide.js";

export interface HostedLimits {
  rateLimit?: RateLimitConfig;
  maxBodyBytes?: number;
  maxMessageChars?: number;
  trustProxy?: boolean;
  corsOrigin?: string;
  maxTurnMs?: number;
}

export interface ServerOptions {
  cfg: RouterConfig;
  port: number;
  sandbox: Sandbox;
  /** Required for POST /chat unless `insecure` is true. One token or several. */
  authToken?: string | string[];
  /** Local scaffold only — skips bearer auth and uses yolo. */
  insecure?: boolean;
  tools?: ToolSpec[];
  compact?: CompactConfig;
  hooks?: HookSet;
  permissionRules?: PermissionRule[];
  /** Hosted permission mode. `ask` becomes `plan` (no UI). `yolo` requires insecure. */
  mode?: PermissionMode;
  openWorktree?: () => Promise<{ sandbox: Sandbox; path: string }>;
  hosted?: HostedLimits;
  /** Append-only JSONL audit path (no bodies). */
  auditPath?: string;
  host?: string;
  /** Editor bridge catalog (plugins/skills/tools). */
  ideCatalog?: IdeCatalog;
}

const DEFAULT_BODY = 1_000_000;
const DEFAULT_MESSAGE = 32_000;
const DEFAULT_TURN_MS = 5 * 60_000;

export function resolveHostedMode(
  insecure: boolean,
  sandboxRoot: string,
  requested?: PermissionMode,
): PermissionMode {
  if (insecure) return "yolo";
  const want = requested === "ask" ? "plan" : requested;
  if (want === "yolo") return "plan";
  if (want === "plan" || want === "acceptEdits") return want;
  return sandboxRoot.startsWith("docker:") ? "acceptEdits" : "plan";
}

export function startServer(opts: ServerOptions) {
  const {
    cfg,
    port,
    sandbox,
    authToken,
    insecure = false,
    tools = defaultTools,
    compact,
    hooks,
    permissionRules = [],
    openWorktree,
    hosted = {},
    auditPath,
    host = "127.0.0.1",
    ideCatalog,
  } = opts;
  let ideSnapshot: IdeSnapshot = {};
  const tokens = Array.isArray(authToken) ? authToken : authToken ? [authToken] : [];
  if (!insecure && !tokens.length) {
    throw new Error("hosted mode requires authToken / POLYCODE_AUTH_TOKEN (min 16 chars, or insecure: true)");
  }

  const mode = resolveHostedMode(insecure, sandbox.root, opts.mode);
  const router = new Router(cfg);
  const limiter = new RateLimiter(hosted.rateLimit ?? {});
  const maxBody = hosted.maxBodyBytes ?? DEFAULT_BODY;
  const maxMessage = hosted.maxMessageChars ?? DEFAULT_MESSAGE;
  const maxTurnMs = hosted.maxTurnMs ?? DEFAULT_TURN_MS;
  const cors = hosted.corsOrigin?.trim();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const requestId = randomBytes(8).toString("hex");
    res.setHeader("x-request-id", requestId);
    res.setHeader("x-content-type-options", "nosniff");
    if (cors) {
      res.setHeader("access-control-allow-origin", cors);
      res.setHeader("access-control-allow-headers", "authorization, content-type, x-api-key");
      res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    }

    if (req.method === "OPTIONS") {
      res.writeHead(cors ? 204 : 404);
      res.end();
      return;
    }

    const url = req.url ?? "/";
    const path = url.split("?")[0];

    if (req.method === "GET" && (path === "/health" || path === "/ready")) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, auth: !insecure, mode, requestId, ide: true }));
      return;
    }

    const idePath = path === "/ide" || path.startsWith("/ide/");
    if (idePath) {
      const ip = clientKey(req, hosted.trustProxy === true);
      if (!insecure && !bearerOk(req, tokens)) {
        const hit = limiter.note(ip);
        if (!hit.ok) {
          audit(auditPath, { type: "rate_limited", requestId, ip, reason: hit.reason });
          res.setHeader("retry-after", String(hit.retryAfterSec));
          json(res, 429, { error: "rate limited", reason: hit.reason, retryAfterSec: hit.retryAfterSec, requestId });
          return;
        }
        audit(auditPath, { type: "unauthorized", requestId, ip });
        json(res, 401, { error: "unauthorized", requestId });
        return;
      }

      if (req.method === "GET" && path === "/ide") {
        json(res, 200, {
          ok: true,
          requestId,
          endpoints: {
            "GET /ide": "this catalog",
            "GET /ide/context": "last editor snapshot",
            "POST /ide/context": "{ file, selection, language, diagnostics }",
            "GET /ide/catalog": "plugins, skills, tools, agents",
            "POST /chat": "agent turn (SSE); prepends <ide> snapshot",
          },
        });
        return;
      }
      if (req.method === "GET" && path === "/ide/context") {
        json(res, 200, { requestId, context: ideSnapshot });
        return;
      }
      if (req.method === "POST" && path === "/ide/context") {
        const body = await readBody(req, maxBody);
        if (body.oversize) {
          json(res, 413, { error: "payload too large", requestId });
          return;
        }
        const parsed = safeJson(body.text) ?? {};
        ideSnapshot = {
          file: typeof parsed.file === "string" ? parsed.file : undefined,
          selection: typeof parsed.selection === "string" ? parsed.selection : undefined,
          language: typeof parsed.language === "string" ? parsed.language : undefined,
          diagnostics: typeof parsed.diagnostics === "string" ? parsed.diagnostics : undefined,
        };
        json(res, 200, { ok: true, requestId, context: ideSnapshot });
        return;
      }
      if (req.method === "GET" && path === "/ide/catalog") {
        json(res, 200, { requestId, ...(ideCatalog ?? { plugins: [], skills: [], tools: tools.map((t) => t.name), agents: [] }) });
        return;
      }
    }

    if (req.method === "POST" && path === "/chat") {
      const ip = clientKey(req, hosted.trustProxy === true);
      if (!insecure && !bearerOk(req, tokens)) {
        const hit = limiter.note(ip);
        if (!hit.ok) {
          audit(auditPath, { type: "rate_limited", requestId, ip, reason: hit.reason });
          res.setHeader("retry-after", String(hit.retryAfterSec));
          json(res, 429, { error: "rate limited", reason: hit.reason, retryAfterSec: hit.retryAfterSec, requestId });
          return;
        }
        audit(auditPath, { type: "unauthorized", requestId, ip });
        json(res, 401, { error: "unauthorized", requestId });
        return;
      }

      const rl = limiter.check(ip);
      if (!rl.ok) {
        audit(auditPath, { type: "rate_limited", requestId, ip, reason: rl.reason });
        res.setHeader("retry-after", String(rl.retryAfterSec));
        json(res, 429, { error: "rate limited", reason: rl.reason, retryAfterSec: rl.retryAfterSec, requestId });
        return;
      }

      try {
        const body = await readBody(req, maxBody);
        if (body.oversize) {
          json(res, 413, { error: "payload too large", requestId });
          req.destroy();
          return;
        }
        const parsed = safeJson(body.text);
        let message = parsed && typeof parsed.message === "string" ? parsed.message : "";
        if (!message.trim()) {
          json(res, 400, { error: "message required", requestId });
          return;
        }
        if (message.length > maxMessage) {
          json(res, 400, { error: `message too long (max ${maxMessage} chars)`, requestId });
          return;
        }
        const ide = formatIdeBlock(ideSnapshot);
        if (ide) message = `${ide}\n\n${message}`;

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });

        const ac = new AbortController();
        const turnTimer = setTimeout(() => ac.abort(), maxTurnMs);
        req.on("close", () => ac.abort());

        const { tier, provider } = await router.route(message);
        sse(res, "meta", {
          requestId,
          tier,
          model: `${provider.id}:${provider.model}`,
          routing: router.strategy,
          mode,
        });
        audit(auditPath, {
          type: "chat",
          requestId,
          ip,
          model: `${provider.id}:${provider.model}`,
          chars: message.length,
        });

        const engine = new PermissionEngine(mode, async () => "deny", permissionRules);
        const agent = new Agent(provider, tools, engine, {
          system: cfg.system,
          sandbox,
          compact,
          hooks,
          openWorktree,
          maxSteps: 40,
        });
        const submitted = await agent.submitPrompt(message);
        if (submitted.blocked) {
          sse(res, "event", { type: "error", error: submitted.reason ?? "prompt blocked by hook" });
          sse(res, "done", { requestId });
          res.end();
          return;
        }

        try {
          for await (const ev of agent.run(ac.signal)) {
            if (ev.type === "tool_executing") {
              audit(auditPath, {
                type: "tool",
                requestId,
                tool: ev.call.name,
                allow: true,
                model: `${provider.id}:${provider.model}`,
              });
            } else if (ev.type === "tool_denied") {
              audit(auditPath, {
                type: "tool",
                requestId,
                tool: ev.call.name,
                allow: false,
                reason: ev.reason,
              });
            }
            sse(res, "event", ev);
          }
        } catch (err) {
          if (ac.signal.aborted) sse(res, "event", { type: "error", error: "turn aborted (timeout or disconnect)" });
          else sse(res, "event", { type: "error", error: String(err) });
        } finally {
          clearTimeout(turnTimer);
          await agent.endSession();
        }
        sse(res, "done", { requestId });
        res.end();
      } finally {
        limiter.finish(ip);
      }
      return;
    }

    json(res, 404, { error: "not found", requestId });
  });

  server.listen(port, host, () => {
    console.log(`polycode server → http://${host}:${port}  (POST /chat)`);
    console.log(
      `  routing: ${router.strategy} · sandbox: ${sandbox.root} · mode: ${mode} · auth: ${insecure ? "INSECURE" : "bearer"}`,
    );
  });
  return server;
}

function clientKey(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    const first = typeof xff === "string" ? xff.split(",")[0]?.trim() : "";
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function audit(path: string | undefined, entry: Record<string, unknown>): void {
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch {
    /* never crash a turn over audit */
  }
}

function sse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function readBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ text: string; oversize: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let n = 0;
    let oversize = false;
    let settled = false;
    const done = (text: string) => {
      if (settled) return;
      settled = true;
      resolve({ text, oversize });
    };
    req.on("data", (c: Buffer) => {
      n += c.length;
      if (n > maxBytes) {
        oversize = true;
        done("");
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => done(""));
  });
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
