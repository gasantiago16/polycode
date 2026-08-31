import React from "react";
import { Box, Text } from "ink";
import { theme } from "./theme.js";

/**
 * Lightweight Markdown → Ink renderer (no deps). Handles fenced code blocks,
 * headings, bullet/numbered lists, inline `code` and **bold**. Good enough for
 * streaming assistant output; not a full CommonMark implementation.
 */
export function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <Box flexDirection="column">
      {blocks.map((b, i) =>
        b.type === "code" ? (
          <Box
            key={i}
            flexDirection="column"
            // Open fences (still streaming) must not use a round border — growing
            // bordered boxes reflow the live region every token.
            borderStyle={b.open ? undefined : "round"}
            borderColor={b.open ? undefined : "gray"}
            paddingX={b.open ? 0 : 1}
          >
            {(b.lines.length ? b.lines : [" "]).map((l, j) => (
              <Text key={j} color={theme.code}>
                {l || " "}
              </Text>
            ))}
          </Box>
        ) : (
          <Text key={i}>{inline(b.text)}</Text>
        ),
      )}
    </Box>
  );
}

type Block = { type: "text"; text: string } | { type: "code"; lines: string[]; open?: boolean };

/** Exported for UX tests. */
export function parseMarkdown(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.split("\n");
  let inCode = false;
  let code: string[] = [];
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inCode) {
        out.push({ type: "code", lines: code });
        code = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) code.push(line);
    else out.push({ type: "text", text: line });
  }
  if (inCode) out.push({ type: "code", lines: code, open: true });
  return out;
}

function inline(line: string): React.ReactNode {
  const h = line.match(/^(#{1,6})\s+(.*)$/);
  if (h) {
    return (
      <Text bold color={theme.accent}>
        {h[2]}
      </Text>
    );
  }

  let prefix = "";
  let content = line;
  const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
  const numbered = line.match(/^(\s*)(\d+\.)\s+(.*)$/);
  if (bullet) {
    prefix = `${bullet[1]}• `;
    content = bullet[2];
  } else if (numbered) {
    prefix = `${numbered[1]}${numbered[2]} `;
    content = numbered[3];
  }

  return (
    <Text>
      {prefix}
      {tokenize(content)}
    </Text>
  );
}

function tokenize(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[2] != null) {
      out.push(
        <Text key={k++} bold>
          {m[2]}
        </Text>,
      );
    } else {
      out.push(
        <Text key={k++} color={theme.code}>
          {m[3]}
        </Text>,
      );
    }
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
