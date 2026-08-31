import type { CanonicalMessage, ContentPart, ToolResultPart } from "./types.js";

export const ELIDE_MARK = "[elided in compaction]";

export const DEFAULT_THRESHOLD_PERCENT = 85;
export const DEFAULT_KEEP_RECENT_TOOL_RESULTS = 6;
export const DEFAULT_KEEP_RECENT_TURNS = 8;
/** Skip pass 2 unless elision left us at least this far over the threshold. */
export const MIN_REDUCTION_RATIO = 0.1;

export type CompactReason = "auto" | "manual";
export type CompactPass = "none" | "elide" | "summarize";

export interface CompactStats {
  before: number;
  after: number;
  reason: CompactReason;
  pass: CompactPass;
  suppressed?: boolean;
}

export interface ContextBreakdown {
  system: number;
  messages: number;
  toolOutput: number;
  toolSchemas: number;
  total: number;
  window: number;
}

export type SummarizeFn = (args: {
  prefix: CanonicalMessage[];
  focus?: string;
  originalTask: string;
}) => Promise<string>;

export interface CompactConfig {
  enabled?: boolean;
  /** Auto-compact when estimate ≥ this % of the context window (default 85). */
  thresholdPercent?: number;
  /** Intact trailing tool_result messages (default 6). */
  keepRecentToolResults?: number;
  /** Intact trailing user-turns (default 8). */
  keepRecentTurns?: number;
  /** Pass 2. If omitted, only tool elision runs. */
  summarize?: SummarizeFn;
}

export interface CompactRequest {
  messages: CanonicalMessage[];
  contextWindow: number;
  reason: CompactReason;
  focus?: string;
  config?: CompactConfig;
  system?: string;
  toolSchemaChars?: number;
}

/**
 * chars/4 estimator. Good enough to trigger compaction; providers may replace
 * it with countTokens later without changing the loop.
 */
export function estimateTokens(messages: CanonicalMessage[]): number {
  return charsToTokens(messagesChars(messages));
}

export function charsToTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}

export function contextBreakdown(opts: {
  messages: CanonicalMessage[];
  system?: string;
  toolSchemaChars?: number;
  contextWindow: number;
}): ContextBreakdown {
  const toolOutput = charsToTokens(toolOutputChars(opts.messages));
  const messages = estimateTokens(opts.messages);
  const system = charsToTokens(opts.system?.length ?? 0);
  const toolSchemas = charsToTokens(opts.toolSchemaChars ?? 0);
  const total = messages + system + toolSchemas;
  return {
    system,
    messages,
    toolOutput,
    toolSchemas,
    total,
    window: opts.contextWindow,
  };
}

export function formatContextBreakdown(b: ContextBreakdown): string {
  const pct = b.window > 0 ? Math.round((b.total / b.window) * 100) : 0;
  const free = Math.max(0, b.window - b.total);
  return [
    `ctx ${b.total}/${b.window} (${pct}%)`,
    `  system       ${b.system}`,
    `  messages     ${b.messages}`,
    `  tool output  ${b.toolOutput}`,
    `  tool schemas ${b.toolSchemas}`,
    `  free         ${free}`,
  ].join("\n");
}

function partChars(p: ContentPart): number {
  if (p.type === "text" || p.type === "reasoning") return p.text.length;
  if (p.type === "tool_result") return p.output.length + p.name.length;
  if (p.type === "tool_call") return p.name.length + JSON.stringify(p.input ?? {}).length;
  if (p.type === "image") return 3_200 + (p.path?.length ?? 0); // ~800 tokens
  return 0;
}

function messagesChars(messages: CanonicalMessage[]): number {
  let n = 0;
  for (const m of messages) for (const p of m.content) n += partChars(p);
  return n;
}

function toolOutputChars(messages: CanonicalMessage[]): number {
  let n = 0;
  for (const m of messages) {
    for (const p of m.content) {
      if (p.type === "tool_result") n += p.output.length;
    }
  }
  return n;
}

export function overThreshold(estimate: number, window: number, percent = DEFAULT_THRESHOLD_PERCENT): boolean {
  if (window <= 0) return false;
  return estimate >= (percent / 100) * window;
}

/** Clone, then elide old tool bodies. Last `keep` tool *messages* stay intact. */
export function elideOldToolResults(
  messages: CanonicalMessage[],
  keep = DEFAULT_KEEP_RECENT_TOOL_RESULTS,
): CanonicalMessage[] {
  const toolMsgIdx: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "tool") toolMsgIdx.push(i);
  }
  const keepFrom = toolMsgIdx.length <= keep ? -1 : toolMsgIdx[toolMsgIdx.length - keep];
  return messages.map((m, i) => {
    if (m.role !== "tool") return { role: m.role, content: m.content.map(clonePart) };
    if (i >= keepFrom && keepFrom !== -1) return { role: m.role, content: m.content.map(clonePart) };
    if (keepFrom === -1) return { role: m.role, content: m.content.map(clonePart) };
    return {
      role: "tool" as const,
      content: m.content.map((p) => (p.type === "tool_result" ? elideResult(p) : clonePart(p))),
    };
  });
}

function elideResult(p: ToolResultPart): ToolResultPart {
  if (p.output.includes(ELIDE_MARK)) return { ...p };
  const first = p.output.split(/\r?\n/, 1)[0] ?? "";
  const snippet = first.slice(0, 120);
  return {
    ...p,
    output: `${snippet}${snippet.length < first.length ? "…" : ""} ${ELIDE_MARK}`.trim(),
  };
}

function clonePart(p: ContentPart): ContentPart {
  if (p.type === "tool_call") return { type: "tool_call", id: p.id, name: p.name, input: p.input };
  if (p.type === "tool_result") {
    return { type: "tool_result", id: p.id, name: p.name, output: p.output, isError: p.isError };
  }
  if (p.type === "reasoning") return { type: "reasoning", text: p.text };
  if (p.type === "image") {
    return { type: "image", mediaType: p.mediaType, data: p.data, path: p.path };
  }
  return { type: "text", text: p.text };
}

/** A turn starts at each user message and runs until the next user message. */
export function groupTurns(messages: CanonicalMessage[]): CanonicalMessage[][] {
  const turns: CanonicalMessage[][] = [];
  let current: CanonicalMessage[] = [];
  for (const m of messages) {
    if (m.role === "user" && current.length > 0) {
      turns.push(current);
      current = [m];
    } else {
      current.push(m);
    }
  }
  if (current.length) turns.push(current);
  return turns;
}

export function originalTask(messages: CanonicalMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "";
  return first.content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

function flatten(turns: CanonicalMessage[][]): CanonicalMessage[] {
  return turns.flat();
}

/**
 * Two-pass compaction. Pass 1 elides old tool bodies. Pass 2 (if still over
 * threshold and a summarizer is provided) replaces the middle turns with one
 * synthetic user message. Always keeps the original task and the last N turns.
 */
export async function compactMessages(req: CompactRequest): Promise<{
  messages: CanonicalMessage[];
  stats: CompactStats;
}> {
  const cfg = req.config ?? {};
  const keepTools = cfg.keepRecentToolResults ?? DEFAULT_KEEP_RECENT_TOOL_RESULTS;
  const keepTurns = cfg.keepRecentTurns ?? DEFAULT_KEEP_RECENT_TURNS;
  const threshold = cfg.thresholdPercent ?? DEFAULT_THRESHOLD_PERCENT;
  const before = estimateTokens(req.messages);

  let pass: CompactPass = "none";
  let next = elideOldToolResults(req.messages, keepTools);
  if (estimateTokens(next) < before) pass = "elide";

  const stillOver = overThreshold(estimateTokens(next), req.contextWindow, threshold);
  if ((stillOver || req.reason === "manual") && cfg.summarize) {
    const turns = groupTurns(next);
    if (turns.length > keepTurns + 1) {
      const first = turns[0];
      const suffix = turns.slice(-keepTurns);
      const prefixTurns = turns.slice(1, turns.length - keepTurns);
      const firstAlreadyInSuffix = suffix[0] === first || turns.length - keepTurns <= 1;
      const prefix = flatten(firstAlreadyInSuffix ? turns.slice(0, turns.length - keepTurns) : prefixTurns);
      if (prefix.length > 0) {
        try {
          const summary = (await cfg.summarize({
            prefix,
            focus: req.focus,
            originalTask: originalTask(req.messages),
          })).trim();
          if (summary) {
            const summaryMsg: CanonicalMessage = {
              role: "user",
              content: [{ type: "text", text: formatSummaryMessage(summary, req.focus) }],
            };
            next = firstAlreadyInSuffix
              ? [summaryMsg, ...flatten(suffix)]
              : [...first, summaryMsg, ...flatten(suffix)];
            pass = "summarize";
          }
        } catch {
          // keep elided clone; caller decides sticky suppress
        }
      }
    }
  }

  const after = estimateTokens(next);
  return { messages: next, stats: { before, after, reason: req.reason, pass } };
}

export function formatSummaryMessage(summary: string, focus?: string): string {
  const focusLine = focus?.trim() ? `Focus kept: ${focus.trim()}\n` : "";
  return `<compacted-history>\n${focusLine}${summary}\n</compacted-history>`;
}

export function reducedEnough(before: number, after: number): boolean {
  if (before <= 0) return after < before;
  return (before - after) / before >= MIN_REDUCTION_RATIO;
}

export function summarizePrompt(args: {
  prefix: CanonicalMessage[];
  focus?: string;
  originalTask: string;
}): string {
  const body = args.prefix
    .map((m) => {
      const role = m.role;
      const text = m.content
        .map((p) => {
          if (p.type === "text") return p.text;
          if (p.type === "tool_result") return `tool ${p.name}: ${p.output.slice(0, 400)}`;
          if (p.type === "tool_call") return `call ${p.name}`;
          return "";
        })
        .filter(Boolean)
        .join("\n");
      return `${role}: ${text}`;
    })
    .join("\n\n")
    .slice(0, 24_000);
  const focus = args.focus?.trim() ? `\nPreserve especially: ${args.focus.trim()}\n` : "";
  return [
    "Summarize this coding-agent transcript for a future turn of the same task.",
    "Keep: the original task, file paths, decisions, errors, test results, todos.",
    "Drop: raw tool dumps, repeated file contents, chatter.",
    `Original task: ${args.originalTask || "(unknown)"}`,
    focus,
    "Transcript:",
    body,
  ].join("\n");
}
