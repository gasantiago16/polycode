import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import {
  Agent,
  PermissionEngine,
  type PermissionMode,
  type PermissionChoice,
  type Provider,
  type Sandbox,
  type ToolSpec,
} from "@polycode/core";
import { hydrateEnv, type ProviderId } from "@polycode/secrets";
import { Banner } from "./banner.js";
import { Settings } from "./settings.js";
import { Markdown } from "./markdown.js";
import { theme, sym, WORK_VERBS } from "./theme.js";

const MAX_RESULT_LINES = 8; // plain tool output shown before "+N lines"
const MAX_DIFF_LINES = 22; // diff lines shown before "+N lines"
const ARG_WIDTH = 72; // tool-call argument display width

type Entry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      result?: string;
      isError?: boolean;
      display?: string;
      denied?: boolean;
      reason?: string;
    }
  | { kind: "system"; text: string }
  | { kind: "error"; text: string };

type StaticRow = { kind: "banner" } | { kind: "row"; entry: Entry };

export interface AppProps {
  provider: Provider;
  tools: ToolSpec[];
  sandbox: Sandbox;
  cwd: string;
  system?: string;
  onModelSwitch?: (arg: string) => Provider;
  route?: (text: string) => Promise<{ provider: Provider; tier: string; label: string }>;
  autoRoute?: boolean;
  /** Validate a provider's stored key (for the in-session settings overlay). */
  validate?: (p: ProviderId) => Promise<boolean>;
  /** Agentic key-provisioning hook (for the in-session settings overlay). */
  onAgentic?: (p: ProviderId) => Promise<string> | string;
}

interface PendingPerm {
  tool: ToolSpec;
  input: unknown;
  resolve: (choice: PermissionChoice) => void;
}

export function App({
  provider,
  tools,
  sandbox,
  cwd,
  system,
  onModelSwitch,
  route,
  autoRoute: autoRouteDefault,
  validate,
  onAgentic,
}: AppProps) {
  const { exit } = useApp();
  const [entries, setEntries] = useState<Entry[]>([]);
  // Authoritative copy updated synchronously, so we can read it mid-event-loop
  // (React's functional updaters run later/batched). All mutations go through update().
  const entriesRef = useRef<Entry[]>([]);
  // Entries [0, committed) are finalized → rendered in <Static> (printed once,
  // never repainted). The tail [committed, …) is the live, in-progress turn.
  const [committed, setCommitted] = useState(0);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [verb, setVerb] = useState<string>(WORK_VERBS[0]);
  const [perm, setPerm] = useState<PendingPerm | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [modelLabel, setModelLabel] = useState(`${provider.id}:${provider.model}`);
  const [mode, setMode] = useState<PermissionMode>("ask");
  const [autoRoute, setAutoRoute] = useState(!!autoRouteDefault && !!route);
  const [ctxWindow, setCtxWindow] = useState(provider.capabilities().contextWindow);
  const [ctxTokens, setCtxTokens] = useState(0); // last turn's input tokens (≈ live context)
  const [sessionTok, setSessionTok] = useState({ in: 0, out: 0 });

  const update = (fn: (prev: Entry[]) => Entry[]) => {
    const next = fn(entriesRef.current);
    entriesRef.current = next;
    setEntries(next);
  };
  const commit = () => setCommitted(entriesRef.current.length);

  const add = (e: Entry) => update((p) => [...p, e]);
  const appendAssistant = (t: string) =>
    update((p) => {
      const last = p[p.length - 1];
      if (last && last.kind === "assistant") {
        return [...p.slice(0, -1), { ...last, text: last.text + t }];
      }
      return [...p, { kind: "assistant", text: t }];
    });
  const setToolResult = (id: string, result: string, isError?: boolean, display?: string) =>
    update((p) =>
      p.map((e) => (e.kind === "tool" && e.id === id ? { ...e, result, isError, display } : e)),
    );
  const setToolDenied = (id: string, reason?: string) =>
    update((p) =>
      p.map((e) => (e.kind === "tool" && e.id === id ? { ...e, denied: true, reason } : e)),
    );

  const promptPermission = useCallback(
    (req: { tool: ToolSpec; input: unknown }) =>
      new Promise<PermissionChoice>((resolve) => setPerm({ ...req, resolve })),
    [],
  );

  const engineRef = useRef(new PermissionEngine("ask", promptPermission));
  const agentRef = useRef(new Agent(provider, tools, engineRef.current, { system, sandbox }));
  const abortRef = useRef<AbortController | null>(null);

  // elapsed-time ticker while busy
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  // answer permission prompt: y/enter=once · a=always (session) · n/esc=deny
  useInput(
    (ch, key) => {
      if (!perm) return;
      const c = ch.toLowerCase();
      if (c === "y" || key.return) perm.resolve("once");
      else if (c === "a") perm.resolve("always");
      else if (c === "n" || key.escape) perm.resolve("deny");
      else return;
      setPerm(null);
    },
    { isActive: !!perm },
  );

  // esc to interrupt a running turn
  useInput(
    (_ch, key) => {
      if (key.escape) abortRef.current?.abort();
    },
    { isActive: busy && !perm },
  );

  const drive = async (signal: AbortSignal) => {
    setBusy(true);
    try {
      for await (const ev of agentRef.current.run(signal)) {
        switch (ev.type) {
          case "text_delta":
            appendAssistant(ev.text);
            break;
          case "tool_call":
            add({ kind: "tool", id: ev.call.id, name: ev.call.name, input: ev.call.input });
            break;
          case "tool_result":
            setToolResult(ev.result.id, ev.result.output, ev.result.isError, ev.display);
            break;
          case "tool_denied":
            setToolDenied(ev.call.id, ev.reason);
            break;
          case "turn_complete":
            // One event per settled model turn (the agent collapses retries), so
            // summing here is correct even across tool round-trips; the last
            // turn's input tokens act as the live-context gauge.
            if (ev.usage) {
              setCtxTokens(ev.usage.inputTokens);
              setSessionTok((s) => ({
                in: s.in + ev.usage!.inputTokens,
                out: s.out + ev.usage!.outputTokens,
              }));
            }
            break;
          case "error":
            add({ kind: "error", text: `error: ${ev.error}` });
            break;
        }
      }
    } catch (e) {
      if (signal.aborted) add({ kind: "system", text: "interrupted" });
      else add({ kind: "error", text: String(e) });
    } finally {
      setBusy(false);
      commit(); // finished turn → move it into <Static> so it stops repainting
    }
  };

  const switchTo = (next: Provider, label: string) => {
    agentRef.current.setProvider(next);
    setModelLabel(label);
    setCtxWindow(next.capabilities().contextWindow);
  };

  const handleSubmit = async (raw: string) => {
    const v = raw.trim();
    setInput("");
    if (!v) return;
    if (v === "/exit" || v === "/quit") return exit(); // always allowed
    if (busy) return; // a turn is streaming — ignore other submits (esc to interrupt)
    if (v === "/help") {
      add({
        kind: "system",
        text: "/model <provider:model> · /mode <plan|ask|acceptEdits|yolo> · /route <auto|off> · /settings · /keys · /clear · /exit",
      });
      return;
    }
    if (v === "/settings" || v === "/login") {
      setShowSettings(true); // overlay — App stays mounted, history is preserved
      return;
    }
    if (v === "/clear") {
      // Resets the conversation + context. Scrollback above stays — it was
      // already flushed to <Static>, and a raw ANSI clear desyncs Ink's buffer.
      entriesRef.current = [];
      setEntries([]);
      setCommitted(0);
      return;
    }
    if (v === "/keys") {
      add({ kind: "system", text: "open /settings to view and manage keys" });
      return;
    }
    if (v.startsWith("/mode ")) {
      const m = v.slice(6).trim() as PermissionMode;
      engineRef.current.setMode(m);
      setMode(engineRef.current.getMode());
      add({ kind: "system", text: `mode → ${engineRef.current.getMode()}` });
      return;
    }
    if (v.startsWith("/route")) {
      const sub = v.slice(6).trim();
      if (!route) return add({ kind: "error", text: "routing unavailable" });
      const on = sub === "off" ? false : sub === "status" ? autoRoute : true;
      setAutoRoute(on);
      add({ kind: "system", text: `auto-route ${on ? "on" : "off"}` });
      return;
    }
    if (v.startsWith("/model ")) {
      const arg = v.slice(7).trim();
      if (!onModelSwitch) return add({ kind: "error", text: "model switching unavailable" });
      try {
        const next = onModelSwitch(arg);
        switchTo(next, `${next.id}:${next.model}`);
        add({ kind: "system", text: `model → ${next.id}:${next.model}` });
      } catch (e) {
        add({ kind: "error", text: String(e) });
      }
      return;
    }

    add({ kind: "user", text: v });

    if (autoRoute && route) {
      try {
        const r = await route(v);
        switchTo(r.provider, r.label);
        add({ kind: "system", text: `routed → ${r.tier} (${r.label})` });
      } catch (e) {
        add({ kind: "error", text: `route failed: ${String(e)}` });
      }
    }

    commit(); // user prompt → Static before the (repainting) turn begins
    setVerb(WORK_VERBS[Math.floor(Math.random() * WORK_VERBS.length)]);
    agentRef.current.pushUser(v);
    const controller = new AbortController();
    abortRef.current = controller;
    await drive(controller.signal);
  };

  const sandboxLabel = sandbox.root.startsWith("docker:") ? "docker" : "local";
  const staticRows: StaticRow[] = [
    { kind: "banner" },
    ...entries.slice(0, committed).map((entry) => ({ kind: "row" as const, entry })),
  ];
  const liveEntries = entries.slice(committed);

  return (
    <Box flexDirection="column">
      {/* Finished turns: printed once to scrollback, never repainted → no flicker. */}
      <Static items={staticRows}>
        {(row, i) =>
          row.kind === "banner" ? (
            <Banner key="banner" cwd={cwd} />
          ) : (
            <EntryView key={i} entry={row.entry} />
          )
        }
      </Static>

      {/* Live region: the in-progress turn + composer (the only repainting part). */}
      {liveEntries.map((e, i) => (
        <EntryView key={committed + i} entry={e} />
      ))}

      {showSettings ? (
        <Settings
          validate={validate}
          onAgentic={onAgentic}
          onDone={() => {
            hydrateEnv();
            setShowSettings(false);
            add({
              kind: "system",
              text: "settings saved · run /model to apply a changed key to the active provider",
            });
          }}
        />
      ) : perm ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.warning}
          paddingX={1}
          marginTop={1}
        >
          <Text color={theme.warning}>Permission required</Text>
          <Text>
            {sym.bullet} <Text bold>{cap(perm.tool.name)}</Text>(
            <Text color={theme.dim}>{trunc(formatToolCall(perm.tool.name, perm.input), ARG_WIDTH)}</Text>
            ) <Text color={theme.dim}>[{perm.tool.permission}]</Text>
          </Text>
          <Text color={theme.dim}>
            <Text color={theme.success}>y</Text>/enter allow once ·{" "}
            <Text color={theme.success}>a</Text> allow for session ·{" "}
            <Text color={theme.error}>n</Text>/esc deny
          </Text>
        </Box>
      ) : (
        <>
          <Box
            borderStyle="round"
            borderColor={busy ? theme.accentDim : theme.accent}
            paddingX={1}
            marginTop={1}
          >
            <Text color={theme.accent}>{sym.prompt} </Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder="ask anything · / for commands"
            />
          </Box>
          <Text color={theme.dim}>
            {busy ? (
              <Text color={theme.accent}>
                <Spinner type="dots" /> {verb}…{" "}
                <Text color={theme.dim}>({elapsed}s · esc to interrupt)</Text>
              </Text>
            ) : (
              <Text>
                {"  "}
                {modelLabel} · {mode} · route:{autoRoute ? "on" : "off"} · sandbox:{sandboxLabel}
                {ctxTokens > 0 ? ` · ctx ${fmtK(ctxTokens)}/${fmtK(ctxWindow)}` : ""}
                {sessionTok.in + sessionTok.out > 0
                  ? ` · Σ ${fmtK(sessionTok.in + sessionTok.out)} tok`
                  : ""}
              </Text>
            )}
          </Text>
        </>
      )}
    </Box>
  );
}

function EntryView({ entry: e }: { entry: Entry }) {
  switch (e.kind) {
    case "user":
      return (
        <Text>
          <Text color={theme.accent}>{sym.prompt} </Text>
          {e.text}
        </Text>
      );
    case "assistant":
      return (
        <Box flexDirection="row">
          <Text color={theme.accent}>{sym.bullet} </Text>
          <Box flexDirection="column">
            <Markdown text={e.text} />
          </Box>
        </Box>
      );
    case "tool":
      return (
        <Box flexDirection="column">
          <Text>
            <Text color={theme.tool}>{sym.bullet} </Text>
            <Text bold>{cap(e.name)}</Text>(
            <Text color={theme.dim}>{trunc(formatToolCall(e.name, e.input), ARG_WIDTH)}</Text>)
          </Text>
          {e.denied ? (
            <Text color={theme.error}>
              {"  "}
              {sym.branch} denied: {e.reason ?? "permission"}
            </Text>
          ) : e.display != null ? (
            <DiffView display={e.display} />
          ) : e.result != null ? (
            <ToolOutput output={e.result} isError={e.isError} />
          ) : (
            <Text color={theme.dim}>
              {"  "}
              {sym.branch} …
            </Text>
          )}
        </Box>
      );
    case "system":
      return (
        <Text color={theme.dim}>
          {"  "}
          {e.text}
        </Text>
      );
    case "error":
      return <Text color={theme.error}>{e.text}</Text>;
  }
}

/** Multi-line tool output under the ⎿ branch, capped with a "+N lines" hint. */
function ToolOutput({ output, isError }: { output: string; isError?: boolean }) {
  const all = output.replace(/\s+$/, "").split("\n");
  const shown = all.slice(0, MAX_RESULT_LINES);
  const more = all.length - shown.length;
  const color = isError ? theme.error : theme.dim;
  return (
    <Box flexDirection="column">
      {shown.map((ln, i) => (
        <Text key={i} color={color}>
          {i === 0 ? `  ${sym.branch} ` : "    "}
          {ln}
        </Text>
      ))}
      {more > 0 ? (
        <Text color={theme.dim}>
          {"    "}… +{more} lines
        </Text>
      ) : null}
    </Box>
  );
}

/** Colored unified diff (+ green / - red / context dim) under the ⎿ branch. */
function DiffView({ display }: { display: string }) {
  const all = display.split("\n");
  const shown = all.slice(0, MAX_DIFF_LINES);
  const more = all.length - shown.length;
  return (
    <Box flexDirection="column">
      {shown.map((ln, i) => {
        const color = ln.startsWith("+")
          ? theme.success
          : ln.startsWith("-")
            ? theme.error
            : theme.dim;
        return (
          <Text key={i} color={color}>
            {i === 0 ? `  ${sym.branch} ` : "    "}
            {ln}
          </Text>
        );
      })}
      {more > 0 ? (
        <Text color={theme.dim}>
          {"    "}… +{more} lines
        </Text>
      ) : null}
    </Box>
  );
}

/** Claude-Code-style tool header arg: `Read(path)` not `Read({"path":…})`. */
function formatToolCall(name: string, input: unknown): string {
  const a = (input ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
  let primary = "";
  switch (name) {
    case "read":
    case "write":
    case "edit":
    case "multi_edit":
    case "ls":
      primary = s("path");
      break;
    case "grep":
      primary = [s("pattern"), a.glob ? `glob=${String(a.glob)}` : ""].filter(Boolean).join(" ");
      break;
    case "glob":
      primary = s("pattern");
      break;
    case "bash":
      primary = s("command");
      break;
  }
  // Fall back to raw input so a malformed/dangerous call is never shown blank.
  return primary || compact(input);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function trunc(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}
function compact(input: unknown): string {
  const s = JSON.stringify(input);
  return s ?? "";
}
function fmtK(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k < 10 ? k.toFixed(1) : Math.round(k).toString()) + "k";
}
