import React from "react";
import { Box, Text } from "ink";
import { theme, sym } from "./theme.js";

export interface BannerProps {
  cwd: string;
}

/**
 * Claude-Code-style rounded welcome box. Printed once into <Static>, so it must
 * NOT show mutable state (e.g. the model) — the live model is in the footer.
 */
export function Banner({ cwd }: BannerProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      marginBottom={1}
    >
      <Text>
        <Text color={theme.accent}>{sym.spark} </Text>
        <Text bold>Welcome to polycode</Text>
      </Text>
      <Text> </Text>
      <Text color={theme.dim}>
        {"  "}/help commands · /settings API keys · /model switch model · /exit quit
      </Text>
      <Text color={theme.dim}>
        {"  "}cwd: {cwd}
      </Text>
    </Box>
  );
}
