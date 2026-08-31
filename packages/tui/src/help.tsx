import React from "react";
import { Box, Text, useInput } from "ink";
import { theme, sym } from "./theme.js";
import { SLASH_COMMANDS, SLASH_GROUPS } from "./commands.js";

export function Help({
  skills = [],
  onClose,
}: {
  skills?: Array<{ name: string }>;
  onClose: () => void;
}) {
  useInput((ch, key) => {
    if (key.escape || ch === "q") onClose();
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      marginTop={1}
    >
      <Text>
        <Text color={theme.accent}>{sym.spark} </Text>
        <Text bold>Commands</Text>
        <Text color={theme.dim}>  esc close · tab complete · ↑↓ history</Text>
      </Text>
      <Text color={theme.dim}>
        Ask about this repo. In ask mode y = once, a = allow that tool for the session. Typos like /hepl are not
        sent.
      </Text>
      <Text> </Text>
      {SLASH_GROUPS.map((g) => {
        const names = SLASH_COMMANDS.filter((c) => c.group === g.id).map((c) => `/${c.name}`);
        return (
          <Text key={g.id}>
            <Text color={theme.accent}>{g.title.padEnd(8)}</Text>
            <Text color={theme.dim}>{names.join("  ")}</Text>
          </Text>
        );
      })}
      {skills.length ? (
        <Text>
          <Text color={theme.accent}>{"Skills".padEnd(8)}</Text>
          <Text color={theme.dim}>{skills.slice(0, 8).map((s) => `/${s.name}`).join("  ")}</Text>
        </Text>
      ) : null}
      <Text> </Text>
      <Text color={theme.dim}>Ctrl+C interrupt · Ctrl+B background children · Ctrl+\ dashboard · /loop 5m …</Text>
    </Box>
  );
}
