import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { execFile } from "node:child_process";
import {
  PROVIDERS,
  setKey,
  keySource,
  importFromEnv,
  keyUrl,
  label,
  backendName,
  type ProviderId,
} from "@polycode/secrets";
import { theme, sym } from "./theme.js";

export interface SettingsProps {
  onDone: () => void;
  /** Ping the provider with a tiny request to confirm the key works. */
  validate?: (p: ProviderId) => Promise<boolean>;
  /** Agentic key provisioning hook (MCP/tool). Returns a status line. */
  onAgentic?: (p: ProviderId) => Promise<string> | string;
}

type Check = "ok" | "bad" | "checking";

export function Settings({ onDone, validate, onAgentic }: SettingsProps) {
  const [sel, setSel] = useState(0);
  const [phase, setPhase] = useState<"menu" | "entry">("menu");
  const [value, setValue] = useState("");
  const [checks, setChecks] = useState<Partial<Record<ProviderId, Check>>>({});
  const [note, setNote] = useState("Paste a key, import from your environment, or open a provider's key page.");

  const provider = PROVIDERS[sel];

  const runValidate = async (p: ProviderId) => {
    if (!validate) return setNote("validation unavailable");
    setChecks((c) => ({ ...c, [p]: "checking" }));
    const ok = await validate(p).catch(() => false);
    setChecks((c) => ({ ...c, [p]: ok ? "ok" : "bad" }));
    setNote(`${label(p)}: ${ok ? "key works ✓" : "key failed ✗"}`);
  };

  useInput(
    (input, key) => {
      if (key.upArrow || input === "k") setSel((s) => (s + PROVIDERS.length - 1) % PROVIDERS.length);
      else if (key.downArrow || input === "j") setSel((s) => (s + 1) % PROVIDERS.length);
      else if (key.return) {
        setValue("");
        setPhase("entry");
      } else if (input === "i") {
        const imported = importFromEnv();
        setNote(imported.length ? `imported from env: ${imported.join(", ")}` : "no keys found in environment");
      } else if (input === "o") {
        openUrl(keyUrl(provider));
        setNote(`opened ${keyUrl(provider)}`);
      } else if (input === "v") {
        void runValidate(provider);
      } else if (input === "a") {
        if (!onAgentic) return setNote("agentic provisioning not wired yet");
        Promise.resolve(onAgentic(provider)).then(setNote).catch((e) => setNote(String(e)));
      } else if (key.escape || input === "q") {
        onDone();
      }
    },
    { isActive: phase === "menu" },
  );

  const submit = async (raw: string) => {
    const k = raw.trim();
    setValue("");
    setPhase("menu");
    if (!k) return;
    const backend = setKey(provider, k);
    setNote(`${label(provider)} saved → ${backend}`);
    if (validate) await runValidate(provider);
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text>
        <Text color={theme.accent}>{sym.spark} </Text>
        <Text bold>polycode settings — API keys</Text>
      </Text>
      <Text color={theme.dim}>store: {backendName()} · ↑↓ select · enter paste · i import-env · o open-page · v validate · a agentic · esc done</Text>
      <Text> </Text>

      {PROVIDERS.map((p, i) => {
        const src = keySource(p);
        const chk = checks[p];
        const active = i === sel;
        return (
          <Text key={p} color={active ? theme.accent : undefined}>
            {active ? "❯ " : "  "}
            {label(p).padEnd(16)}
            <Text color={src === "none" ? theme.dim : theme.success}>
              {src === "none" ? "— not set" : `set (${src})`}
            </Text>
            {chk === "ok" ? <Text color={theme.success}> {sym.check}</Text> : null}
            {chk === "bad" ? <Text color={theme.error}> {sym.cross}</Text> : null}
            {chk === "checking" ? (
              <Text color={theme.warning}>
                {" "}
                <Spinner type="dots" /> checking
              </Text>
            ) : null}
          </Text>
        );
      })}

      <Text> </Text>
      {phase === "entry" ? (
        <Box>
          <Text color={theme.accent}>{label(provider)} key: </Text>
          <TextInput value={value} onChange={setValue} onSubmit={submit} mask="•" />
        </Box>
      ) : (
        <Text color={theme.dim}>{note}</Text>
      )}
    </Box>
  );
}

function openUrl(url: string): void {
  let cmd: string;
  let args: string[];
  if (process.platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else if (process.platform === "darwin") {
    cmd = "open";
    args = [url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  try {
    execFile(cmd, args, () => {});
  } catch {
    /* ignore */
  }
}
