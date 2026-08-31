import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { execFile } from "node:child_process";
import { childProcessEnv } from "@polycode/core";
import {
  PROVIDERS,
  setKey,
  keySource,
  importFromEnv,
  keyUrl,
  label,
  backendName,
  configured,
  hydrateEnv,
  type ProviderId,
} from "@polycode/secrets";
import { theme, sym } from "./theme.js";

export interface SettingsProps {
  onDone: () => void;
  /** First launch with no keys stored — extra onboarding copy. */
  firstRun?: boolean;
  /** Ping the provider with a tiny request to confirm the key works. */
  validate?: (p: ProviderId) => Promise<boolean>;
  /** Agentic key provisioning hook (MCP/tool). Returns a status line. */
  onAgentic?: (p: ProviderId) => Promise<string> | string;
}

type Check = "ok" | "bad" | "checking";

export function Settings({ onDone, validate, onAgentic, firstRun }: SettingsProps) {
  const [sel, setSel] = useState(0);
  const [phase, setPhase] = useState<"menu" | "entry">("menu");
  const [value, setValue] = useState("");
  const [checks, setChecks] = useState<Partial<Record<ProviderId, Check>>>({});
  const [note, setNote] = useState(
    firstRun
      ? "Add at least one key (xAI/Grok is fine). Enter pastes. i imports XAI_API_KEY / GROK_API_KEY from .env. Saving a key starts the app."
      : "Paste a key, import from your environment, or open a provider's key page.",
  );
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);

  const provider = PROVIDERS[sel];
  const ready = configured().length > 0;

  const finish = () => {
    hydrateEnv();
    onDone();
  };

  const runValidate = async (p: ProviderId) => {
    if (!validate) return setNote("validation unavailable");
    setChecks((c) => ({ ...c, [p]: "checking" }));
    const ok = await validate(p).catch(() => false);
    setChecks((c) => ({ ...c, [p]: ok ? "ok" : "bad" }));
    setNote(`${label(p)}: ${ok ? "key works ✓" : "key failed ✗"}`);
  };

  useInput(
    (input, key) => {
      const isEnter = key.return || input === "\r";
      if (key.upArrow || input === "k") setSel((s) => (s + PROVIDERS.length - 1) % PROVIDERS.length);
      else if (key.downArrow || input === "j") setSel((s) => (s + 1) % PROVIDERS.length);
      else if (isEnter) {
        setValue("");
        setPhase("entry");
      } else if (input === "i") {
        const imported = importFromEnv();
        refresh();
        if (!imported.length) {
          setNote("no keys in environment. Put XAI_API_KEY or GROK_API_KEY in .env, or enter to paste.");
          return;
        }
        hydrateEnv();
        setNote(`imported ${imported.map(label).join(", ")}`);
        if (firstRun) finish();
      } else if (input === "o") {
        openUrl(keyUrl(provider));
        setNote(`opened ${keyUrl(provider)}`);
      } else if (input === "v") {
        void runValidate(provider);
      } else if (input === "c" && ready) {
        finish();
      } else if (input === "a") {
        if (!onAgentic) return setNote("agentic provisioning not wired yet");
        Promise.resolve(onAgentic(provider)).then(setNote).catch((e) => setNote(String(e)));
      } else if (key.escape || input === "q") {
        if (firstRun && !configured().length) {
          setNote("Need a key first. Enter to paste, or i to import from .env.");
          return;
        }
        finish();
      }
    },
    { isActive: phase === "menu" },
  );

  useInput(
    (_ch, key) => {
      if (key.escape) {
        setValue("");
        setPhase("menu");
        setNote("cancelled paste");
      }
    },
    { isActive: phase === "entry" },
  );

  const submit = async (raw: string) => {
    const k = raw.trim();
    setValue("");
    setPhase("menu");
    if (!k) return;
    const backend = setKey(provider, k);
    hydrateEnv();
    refresh();
    setNote(`${label(provider)} saved → ${backend}`);
    if (firstRun) {
      finish();
      return;
    }
    if (validate) await runValidate(provider);
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text>
        <Text color={theme.accent}>{sym.spark} </Text>
        <Text bold>{firstRun ? "polycode — add an API key to start" : "polycode settings — API keys"}</Text>
      </Text>
      <Text color={theme.dim}>
        store: {backendName()} · ↑↓ select · enter paste · i import .env · o open-page
        {ready ? " · c start" : ""} · esc {firstRun && !ready ? "needs a key" : "done"}
      </Text>
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
    execFile(cmd, args, { env: childProcessEnv() }, () => {});
  } catch {
    /* ignore */
  }
}
