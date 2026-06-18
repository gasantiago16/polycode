import React, { useCallback, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import {
  Agent,
  PermissionEngine,
  type PermissionMode,
  type Provider,
  type ToolSpec,
} from "@polycode/core";
import { configured, backendName } from "@polycode/secrets";

type LineKind = "system" | "user" | "assistant" | "tool" | "error";
interface Line {
  kind: LineKind;
  text: string;
}

export interface AppProps {
  provider: Provider;
  tools: ToolSpec[];
  cwd: string;
  system?: string;
  /** Supplied by the CLI so `/model openai:gpt-5` can rebuild a Provider. */
  onModelSwitch?: (arg: string) => Provider;
  /** Re-open the secure key setup screen (`/login`). */
  onLogin?: () => void;
}

interface PendingPerm {
  tool: ToolSpec;
  input: unknown;
  resolve: (allow: boolean) => void;
}

export function App({ provider, tools, cwd, system, onModelSwitch, onLogin }: AppProps) {
  const { exit } = useApp();
  const [lines, setLines] = useState<Line[]>([
    {
      kind: "system",
      text: `polycode — ${provider.id}:${provider.model} — /help /model /mode /exit`,
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [perm, setPerm] = useState<PendingPerm | null>(null);
  const [modelLabel, setModelLabel] = useState(`${provider.id}:${provider.model}`);

  const add = (line: Line) => setLines((prev) => [...prev, line]);
  const appendAssistant = (t: string) =>
    setLines((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.kind === "assistant") {
        return [...prev.slice(0, -1), { ...last, text: last.text + t }];
      }
      return [...prev, { kind: "assistant", text: t }];
    });

  const promptPermission = useCallback(
    (req: { tool: ToolSpec; input: unknown }) =>
      new Promise<boolean>((resolve) => setPerm({ ...req, resolve })),
    [],
  );

  const engineRef = useRef(new PermissionEngine("ask", promptPermission));
  const agentRef = useRef(new Agent(provider, tools, engineRef.current, { system, cwd }));

  // Answer a pending permission prompt with y/n.
  useInput(
    (ch, key) => {
      if (!perm) return;
      if (ch.toLowerCase() === "y") {
        perm.resolve(true);
        setPerm(null);
      } else if (ch.toLowerCase() === "n" || key.escape) {
        perm.resolve(false);
        setPerm(null);
      }
    },
    { isActive: !!perm },
  );

  const drive = async () => {
    setBusy(true);
    try {
      for await (const ev of agentRef.current.run()) {
        switch (ev.type) {
          case "text_delta":
            appendAssistant(ev.text);
            break;
          case "tool_call":
            add({ kind: "tool", text: `→ ${ev.call.name} ${compact(ev.call.input)}` });
            break;
          case "tool_result":
            add({
              kind: "tool",
              text: `  ${ev.result.isError ? "✗" : "✓"} ${oneLine(ev.result.output)}`,
            });
            break;
          case "tool_denied":
            add({ kind: "tool", text: `  ✗ denied (${ev.reason ?? "permission"})` });
            break;
          case "error":
            add({ kind: "error", text: `error: ${ev.error}` });
            break;
          // reasoning_delta / stop / turn_complete: ignored in this minimal view
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (value: string) => {
    const v = value.trim();
    setInput("");
    if (!v) return;

    if (v === "/exit" || v === "/quit") return exit();
    if (v === "/help") {
      add({
        kind: "system",
        text: "/model <provider:model> · /mode <plan|ask|acceptEdits|yolo> · /login · /keys · /exit",
      });
      return;
    }
    if (v === "/login") {
      if (onLogin) return onLogin();
      return add({ kind: "error", text: "key setup unavailable" });
    }
    if (v === "/keys") {
      const have = configured();
      add({
        kind: "system",
        text: `keys (${backendName()}): ${have.length ? have.join(", ") : "none — run /login"}`,
      });
      return;
    }
    if (v.startsWith("/mode ")) {
      const mode = v.slice(6).trim() as PermissionMode;
      engineRef.current.setMode(mode);
      add({ kind: "system", text: `mode → ${engineRef.current.getMode()}` });
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
    agentRef.current.pushUser(v);
    await drive();
  };

  return (
    <Box flexDirection="column">
      {lines.map((l, i) => (
        <Text key={i} color={colorFor(l.kind)}>
          {prefixFor(l.kind)}
          {l.text}
        </Text>
      ))}

      {perm ? (
        <Box marginTop={1}>
          <Text color="yellow">
            Allow {perm.tool.name} [{perm.tool.permission}]? {compact(perm.input)} (y/n)
          </Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color="cyan">{busy ? "… " : "› "}</Text>
          <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
          <Text dimColor> {modelLabel}</Text>
        </Box>
      )}
    </Box>
  );
}

function colorFor(k: LineKind): string {
  return { system: "gray", user: "white", assistant: "green", tool: "blue", error: "red" }[k];
}
function prefixFor(k: LineKind): string {
  return { system: "", user: "› ", assistant: "", tool: "", error: "" }[k];
}
function oneLine(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 100 ? t.slice(0, 100) + "…" : t;
}
function compact(input: unknown): string {
  const s = JSON.stringify(input);
  return s && s.length > 80 ? s.slice(0, 80) + "…" : s ?? "";
}
