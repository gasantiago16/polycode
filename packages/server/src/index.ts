import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Agent, PermissionEngine, type Sandbox } from "@polycode/core";
import { Router, type RouterConfig } from "@polycode/router";
import { tools } from "@polycode/tools";

export interface ServerOptions {
  cfg: RouterConfig;
  port: number;
  /** Tool-execution sandbox (use a `docker` sandbox for untrusted hosted use). */
  sandbox: Sandbox;
}

/**
 * Minimal hosted-mode surface: the SAME agent engine, exposed over HTTP+SSE.
 * POST /chat {"message": "..."} streams AgentUIEvent frames as Server-Sent Events.
 *
 * Scaffold caveat: this runs tools in "yolo" mode. Tool execution is contained
 * by the provided sandbox (pass a `docker` sandbox for untrusted use), but you
 * still need per-request auth and per-session permission policy before exposing it.
 */
export function startServer({ cfg, port, sandbox }: ServerOptions): void {
  const router = new Router(cfg);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "POST" && req.url === "/chat") {
      const body = await readBody(req);
      const message = (safeJson(body)?.message ?? "").toString();

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      const { tier, provider } = await router.route(message);
      sse(res, "meta", { tier, model: `${provider.id}:${provider.model}`, routing: router.strategy });

      const engine = new PermissionEngine("yolo", async () => true);
      const agent = new Agent(provider, tools, engine, { system: cfg.system, sandbox });
      agent.pushUser(message);

      try {
        for await (const ev of agent.run()) sse(res, "event", ev);
      } catch (err) {
        sse(res, "event", { type: "error", error: String(err) });
      }
      sse(res, "done", {});
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });

  server.listen(port, () => {
    console.log(`polycode server → http://localhost:${port}  (POST /chat)`);
    console.log(`  routing: ${router.strategy} · sandbox: ${sandbox.root}`);
  });
}

function sse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => resolve(buf));
  });
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
