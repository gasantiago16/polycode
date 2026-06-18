import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import {
  PROVIDERS,
  setKey,
  getKey,
  backendName,
  storeLocation,
  label,
  type Backend,
  type ProviderId,
} from "@polycode/secrets";

export interface SetupProps {
  onDone: () => void;
}

/**
 * First-run (and `/login`) key capture. Input is masked, keys go straight to
 * the secure store, and nothing is echoed, logged, or written to the repo.
 */
export function Setup({ onDone }: SetupProps) {
  const [idx, setIdx] = useState(0);
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<Partial<Record<ProviderId, Backend>>>({});
  const provider = PROVIDERS[idx];

  useInput((_input, key) => {
    if (key.escape) onDone(); // finish setup early
  });

  const submit = (raw: string) => {
    const k = raw.trim();
    setValue("");
    if (k) {
      const backend = setKey(provider, k);
      setSaved((s) => ({ ...s, [provider]: backend }));
    }
    if (idx < PROVIDERS.length - 1) setIdx(idx + 1);
    else onDone();
  };

  return (
    <Box flexDirection="column">
      <Text color="cyan">polycode setup — paste an API key for each provider.</Text>
      <Text dimColor>Enter to save/skip · Esc to finish. Stored in {backendName()}; never shown or committed.</Text>
      <Text dimColor>Location: {storeLocation()}</Text>

      <Box marginTop={1} flexDirection="column">
        {PROVIDERS.map((p) => {
          const status = saved[p]
            ? `✓ saved → ${saved[p]}`
            : getKey(p)
              ? "✓ already set"
              : "—";
          return (
            <Text key={p} color={p === provider ? "yellow" : "gray"}>
              {p === provider ? "› " : "  "}
              {label(p).padEnd(16)} [{status}]
            </Text>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color="cyan">{label(provider)} key: </Text>
        <TextInput value={value} onChange={setValue} onSubmit={submit} mask="•" />
      </Box>
    </Box>
  );
}
