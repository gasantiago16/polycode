import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { childProcessEnv } from "@polycode/core";

export interface LspServerConfig {
  language: string;
  command: string;
  args?: string[];
  extensions?: string[];
}

export type LspAction = "hover" | "definition" | "references" | "documentSymbol";

function jailed(root: string, rel: string): string {
  const abs = resolve(root, rel);
  const r = relative(root, abs);
  if (r === ".." || r.startsWith(".." + sep) || isAbsolute(r)) {
    throw new Error(`path escapes project root: ${rel}`);
  }
  return abs;
}

function encode(msg: object): Buffer {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  return Buffer.concat([header, body]);
}

async function rpc(
  command: string,
  args: string[],
  cwd: string,
  exchange: (send: (msg: object) => void, wait: (id: number) => Promise<unknown>) => Promise<unknown>,
  timeoutMs = 8_000,
): Promise<unknown> {
  const child = spawn(command, args, {
    cwd,
    env: childProcessEnv(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let buf = Buffer.alloc(0);
  const pending = new Map<number, (v: unknown) => void>();
  const onData = (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buf.subarray(0, headerEnd).toString("utf8");
      const m = header.match(/Content-Length:\s*(\d+)/i);
      if (!m) {
        buf = buf.subarray(headerEnd + 4);
        continue;
      }
      const len = Number(m[1]);
      const start = headerEnd + 4;
      if (buf.length < start + len) return;
      const json = buf.subarray(start, start + len).toString("utf8");
      buf = buf.subarray(start + len);
      try {
        const msg = JSON.parse(json) as { id?: number; result?: unknown; error?: unknown };
        if (msg.id != null && pending.has(msg.id)) {
          const resolve = pending.get(msg.id)!;
          pending.delete(msg.id);
          resolve(msg.error ? { error: msg.error } : msg.result);
        }
      } catch {
        /* ignore malformed */
      }
    }
  };
  child.stdout?.on("data", onData);

  const send = (msg: object) => {
    child.stdin?.write(encode(msg));
  };
  let nextId = 1;
  const wait = (id: number) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`lsp timed out (${timeoutMs}ms)`));
      }, timeoutMs);
      pending.set(id, (v) => {
        clearTimeout(t);
        resolve(v);
      });
    });

  try {
    return await exchange(
      send,
      async (want) => {
        const id = want || nextId++;
        return wait(id);
      },
    );
  } finally {
    try {
      child.stdin?.end();
    } catch {
      /* ignore */
    }
    child.kill();
  }
}

export function matchServer(servers: LspServerConfig[], path: string): LspServerConfig | undefined {
  const ext = extname(path).toLowerCase();
  const langGuess =
    ext === ".ts" || ext === ".tsx" ? "typescript" : ext === ".js" || ext === ".jsx" ? "javascript" : ext.slice(1);
  return servers.find((s) => {
    if (s.extensions?.some((e) => e.toLowerCase() === ext || e.toLowerCase() === ext.slice(1))) return true;
    return s.language.toLowerCase() === langGuess || s.language.toLowerCase() === ext.slice(1);
  });
}

export async function lspQuery(opts: {
  root: string;
  servers: LspServerConfig[];
  action: LspAction;
  path: string;
  line?: number;
  character?: number;
}): Promise<string> {
  const abs = jailed(opts.root, opts.path);
  if (!existsSync(abs)) throw new Error(`file not found: ${opts.path}`);
  const server = matchServer(opts.servers, opts.path);
  if (!server) {
    const langs = opts.servers.map((s) => s.language).join(", ") || "(none)";
    return `no LSP server matches ${opts.path} (configured: ${langs}). Add .polycode/lsp.json.`;
  }
  const text = readFileSync(abs, "utf8");
  const uri = pathToFileURL(abs).href;
  const line = Math.max(0, Math.floor(opts.line ?? 1) - 1);
  const character = Math.max(0, Math.floor(opts.character ?? 1) - 1);
  const pos = { line, character };

  try {
    const result = await rpc(server.command, server.args ?? [], dirname(abs), async (send, wait) => {
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          processId: process.pid,
          rootUri: pathToFileURL(opts.root).href,
          capabilities: {
            textDocument: { hover: {}, definition: {}, references: {}, documentSymbol: {} },
          },
        },
      });
      await wait(1);
      send({ jsonrpc: "2.0", method: "initialized", params: {} });
      send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: { uri, languageId: server.language, version: 1, text },
        },
      });
      const method =
        opts.action === "hover"
          ? "textDocument/hover"
          : opts.action === "definition"
            ? "textDocument/definition"
            : opts.action === "references"
              ? "textDocument/references"
              : "textDocument/documentSymbol";
      const params =
        opts.action === "documentSymbol"
          ? { textDocument: { uri } }
          : { textDocument: { uri }, position: pos, context: { includeDeclaration: true } };
      send({ jsonrpc: "2.0", id: 2, method, params });
      const out = await wait(2);
      send({ jsonrpc: "2.0", id: 3, method: "shutdown", params: null });
      await wait(3).catch(() => undefined);
      send({ jsonrpc: "2.0", method: "exit" });
      return out;
    });
    if (result == null) return "(empty LSP result)";
    return JSON.stringify(result, null, 2).slice(0, 60_000);
  } catch (e) {
    return `lsp ${server.command} failed: ${String(e)}`;
  }
}

export function loadLspConfig(cwd: string): LspServerConfig[] {
  const file = join(cwd, ".polycode", "lsp.json");
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { servers?: LspServerConfig[] } | LspServerConfig[];
    const list = Array.isArray(raw) ? raw : raw.servers ?? [];
    return list.filter((s) => s && typeof s.language === "string" && typeof s.command === "string");
  } catch {
    return [];
  }
}
