import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { formatChildLine, type ChildRun, type Persona } from "@polycode/core";
import { theme, sym } from "./theme.js";

export function Dashboard({
  runs,
  personas = [],
  onRefresh,
  onKill,
  onPeek,
  onAttach,
  onClose,
  graphLine,
}: {
  runs: ChildRun[];
  personas?: Persona[];
  onRefresh: () => void;
  onKill: (id: string) => void;
  onPeek: (id: string) => ChildRun | null;
  onAttach: (id: string) => void;
  onClose: () => void;
  graphLine?: string;
}) {
  const [sel, setSel] = useState(0);
  const [peekId, setPeekId] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(onRefresh, 400);
    return () => clearInterval(t);
  }, [onRefresh]);

  const n = runs.length;
  const peek = peekId ? onPeek(peekId) : null;
  useEffect(() => {
    if (n === 0) setSel(0);
    else if (sel >= n) setSel(n - 1);
  }, [n, sel]);

  useInput((ch, key) => {
    if (peekId) {
      if (key.escape || ch === "q") setPeekId(null);
      else if (ch === "a") onAttach(peekId);
      else if (ch === "x") onKill(peekId);
      return;
    }
    if (key.escape || ch === "q") onClose();
    else if (key.upArrow || ch === "k") setSel((s) => (n ? (s + n - 1) % n : 0));
    else if (key.downArrow || ch === "j") setSel((s) => (n ? (s + 1) % n : 0));
    else if ((key.return || ch === "p") && runs[sel]) setPeekId(runs[sel].id);
    else if (ch === "a" && runs[sel]) onAttach(runs[sel].id);
    else if (ch === "x" && runs[sel]) onKill(runs[sel].id);
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
        <Text bold>Dashboard</Text>
        <Text color={theme.dim}>
          {peek
            ? "  peek · a attach · x kill · esc back"
            : `  ${n} child${n === 1 ? "" : "ren"} · enter peek · a attach · x kill · esc close`}
        </Text>
      </Text>
      <Text> </Text>
      {graphLine && !peek ? <Text color={theme.dim}>{graphLine}</Text> : null}
      {peek ? (
        <Box flexDirection="column">
          <Text color={theme.warning}>{formatChildLine(peek)}</Text>
          <Text color={theme.dim}>
            {(peek.output || "(no output yet)").split("\n").slice(0, 18).join("\n")}
          </Text>
        </Box>
      ) : n === 0 ? (
        <Text color={theme.dim}>no child agents yet — the parent can call several task tools in one turn</Text>
      ) : (
        runs.map((r, i) => {
          const color =
            r.status === "running"
              ? theme.warning
              : r.status === "completed"
                ? theme.success
                : theme.error;
          return (
            <Text key={r.id} color={i === sel ? theme.accent : color}>
              {i === sel ? "❯ " : "  "}
              {formatChildLine(r)}
            </Text>
          );
        })
      )}
      {personas.length && !peek ? (
        <Text color={theme.dim}>
          {"\n"}personas: {personas.map((p) => p.name).join(", ")}
        </Text>
      ) : null}
    </Box>
  );
}
