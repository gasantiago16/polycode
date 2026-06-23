import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import {
  Agent,
  PermissionEngine,
  type PermissionMode,
  type Provider,
  type Sandbox,
  type ToolSpec,
} from "@polycode/core";
import { Banner } from "./banner.js";
import { Markdown } from "./markdown.js";
import { theme, sym, WORK_VERBS } from "./theme.js";

type Entry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; result?: string; isError?: boolean; denied?: boolean; reason?: string }
  | { kind: "system"; text: string }
  | { kind: "error"; text: string };

export interface AppProps {
  provider: Provider;
  tools: ToolSpec[];
  sandbox: Sandbox;
  cwd: string;
  system?: string;
  onModelSwitch?: (arg: string) => Provider;
  onOpenSettings?: () => void;
  route?: (text: string) => Promise<{ provider: Provider; tier: string; label: string }>;
  autoRoute?: boolean;
}

interface PendingPerm {
  tool: ToolSpec;
  input: unknown;
  resolve: (allow: boolean) => void;
}

export function App({
  provider,
  tools,
  sandbox,
  cwd,
  system,
  onModelSwitch,
  onOpenSettings,
  route,
  autoRoute: autoRouteDefault,
}: AppProps) {
  const { exit } = useApp();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [verb, setVerb] = useState<string>(WORK_VERBS[0]);
  const [perm, setPerm] = useState<PendingPerm | null>(null);
  const [modelLabel, setModelLabel] = useState(`${provider.id}:${provider.model}`);
  const [mode, setMode] = useState<PermissionMode>("ask");
  const [autoRoute, setAutoRoute] = useState(!!autoRouteDefault && !!route);

  const add = (e: Entry) => setEntries((p) => [...p, e]);
  const appendAssistant = (t: string) =>
    setEntries((p) => {
      const last = p[p.length - 1];
      if (last && last.kind === "assistant") {
        return [...p.slice(0, -1), { ...last, text: last.text + t }];
      }
      return [...p, { kind: "assistant", text: t }];
    });
  const setToolResult = (id: string, result: string, isError?: boolean) =>
    setEntries((p) =>
      p.map((e) => (e.kind === "tool" && e.id === id ? { ...e, result, isError } : e)),
    );
  const setToolDenied = (id: string, reason?: string) =>
    setEntries((p) =>
      p.map((e) => (e.kind === "tool" && e.id === id ? { ...e, denied: true, reason } : e)),
    );

  const promptPermission = useCallback(
    (req: { tool: ToolSpec; input: unknown }) =>
      new Promise<boolean>((resolve) => setPerm({ ...req, resolve })),
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

  // answer permission prompt
  useInput(
    (ch, key) => {
      if (!perm) return;
      if (ch.toLowerCase() === "y" || key.return) {
        perm.resolve(true);
        setPerm(null);
      } else if (ch.toLowerCase() === "n" || key.escape) {
        perm.resolve(false);
        setPerm(null);
      }
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
            setToolResult(ev.result.id, ev.result.output, ev.result.isError);
            break;
          case "tool_denied":
            setToolDenied(ev.call.id, ev.reason);
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
    }
  };

  const handleSubmit = async (raw: string) => {
    const v = raw.trim();
    setInput("");
    if (!v) return;

    if (v === "/exit" || v === "/quit") return exit();
    if (v === "/help") {
      add({
        kind: "system",
        text: "/model <provider:model> · /mode <plan|ask|acceptEdits|yolo> · /route <auto|off> · /settings · /keys · /clear · /exit",
      });
      return;
    }
    if (v === "/settings" || v === "/login") {
      if (onOpenSettings) return onOpenSettings();
      return add({ kind: "error", text: "settings unavailable" });
    }
    if (v === "/clear") {
      setEntries([]);
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
        agentRef.current.setProvider(next);
        setModelLabel(`${next.id}:${next.model}`);
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
        agentRef.current.setProvider(r.provider);
        setModelLabel(r.label);
        add({ kind: "system", text: `routed → ${r.tier} (${r.label})` });
      } catch (e) {
        add({ kind: "error", text: `route failed: ${String(e)}` });
      }
    }

    setVerb(WORK_VERBS[Math.floor(Math.random() * WORK_VERBS.length)]);
    agentRef.current.pushUser(v);
    const controller = new AbortController();
    abortRef.current = controller;
    await drive(controller.signal);
  };

  const sandboxLabel = sandbox.root.startsWith("docker:") ? "docker" : "local";

  return (
    <Box flexDirection="column">
      <Banner cwd={cwd} model={modelLabel} />

      {entries.map((e, i) => (
        <EntryView key={i} entry={e} />
      ))}

      {perm ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.warning}
          paddingX={1}
          marginTop={1}
        >
          <Text color={theme.warning}>Permission required</Text>
          <Text>
            {sym.bullet} {perm.tool.name}(<Text color={theme.dim}>{compact(perm.input)}</Text>){" "}
            <Text color={theme.dim}>[{perm.tool.permission}]</Text>
          </Text>
          <Text color={theme.dim}>y/enter allow · n/esc deny</Text>
        </Box>
      ) : (
        <>
          <Box borderStyle="round" borderColor={busy ? theme.accentDim : theme.accent} paddingX={1} marginTop={1}>
            <Text color={theme.accent}>{sym.prompt} </Text>
            <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder="ask anything · / for commands" />
          </Box>
          <Text color={theme.dim}>
            {busy ? (
              <Text color={theme.accent}>
                <Spinner type="dots" /> {verb}… <Text color={theme.dim}>({elapsed}s · esc to interrupt)</Text>
              </Text>
            ) : (
              <Text>
                {"  "}{modelLabel} · {mode} · route:{autoRoute ? "on" : "off"} · sandbox:{sandboxLabel}
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
            <Text bold>{cap(e.name)}</Text>(<Text color={theme.dim}>{compact(e.input)}</Text>)
          </Text>
          {e.denied ? (
            <Text color={theme.error}>
              {"  "}
              {sym.branch} denied: {e.reason ?? "permission"}
            </Text>
          ) : e.result != null ? (
            <Text color={e.isError ? theme.error : theme.dim}>
              {"  "}
              {sym.branch} {oneLine(e.result)}
            </Text>
          ) : (
            <Text color={theme.dim}>
              {"  "}
              {sym.branch} …
            </Text>
          )}
        </Box>
      );
    case "system":
      return <Text color={theme.dim}>{"  "}{e.text}</Text>;
    case "error":
      return <Text color={theme.error}>{e.text}</Text>;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function oneLine(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 100 ? t.slice(0, 100) + "…" : t;
}
function compact(input: unknown): string {
  const s = JSON.stringify(input);
  if (!s) return "";
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}
