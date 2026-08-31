import type {
  Provider,
  ToolSpec,
  ToolContext,
  Sandbox,
  CanonicalMessage,
  CanonicalEvent,
  ContentPart,
  ToolCallPart,
  ToolResultPart,
  StopReason,
  SpawnChildInput,
  ToolRunResult,
  TodoItem,
} from "./types.js";
import { PermissionEngine } from "./permissions.js";
import {
  compactMessages,
  contextBreakdown,
  estimateTokens,
  formatContextBreakdown,
  overThreshold,
  reducedEnough,
  type CompactConfig,
  type CompactReason,
  type CompactStats,
  type ContextBreakdown,
} from "./compact.js";
import {
  clipChildOutput,
  parseChildType,
  systemForChild,
  toolsForChild,
} from "./subagent.js";
import { redactSecrets } from "./redact.js";
import { formatCost, type ModelUsage } from "./cost.js";
import { runHooks, type HookSet } from "./hooks.js";

/** Events the UI / server consume: canonical stream events plus tool lifecycle. */
export type AgentUIEvent =
  | CanonicalEvent
  | { type: "tool_executing"; call: ToolCallPart }
  | { type: "tool_result"; result: ToolResultPart; display?: string }
  | { type: "tool_denied"; call: ToolCallPart; reason?: string }
  | { type: "turn_complete"; usage?: { inputTokens: number; outputTokens: number } }
  | { type: "compacted"; stats: CompactStats };

export interface AgentOptions {
  system?: string;
  sandbox: Sandbox;
  /** Hard cap on model turns per run() to stop runaway tool loops (default 50). */
  maxSteps?: number;
  /** Retries for transient provider errors that hit before any output (default 2). */
  maxRetries?: number;
  /** Seed the conversation (e.g. resuming a saved session). */
  initialMessages?: CanonicalMessage[];
  /** Two-pass context compaction (Grok-shaped). Default enabled. */
  compact?: CompactConfig;
  /** Child agents cannot spawn children (depth 1). */
  isChild?: boolean;
  initialTodos?: TodoItem[];
  initialUsage?: ModelUsage[];
  /** Create an isolated sandbox (git worktree) for a child agent. */
  openWorktree?: () => Promise<{ sandbox: Sandbox; path: string }>;
  /** Lifecycle hooks (PreToolUse nonzero denies the tool). */
  hooks?: HookSet;
}

interface FileCheckpoint {
  messageLength: number;
  files: Record<string, string | null>;
}

/**
 * Provider-blind agentic loop.
 *
 * One `provider.stream()` call == one model turn. We deliberately do NOT let
 * the provider auto-execute tools; we collect tool calls, run them through the
 * permission engine, execute, append results, and loop — so gating, rendering,
 * and (later) parallel scheduling all stay under our control.
 */
export class Agent {
  private messages: CanonicalMessage[];
  /** After a failed/no-op auto-compact, skip auto until a successful one. */
  private compactSuppressed = false;
  private usage: ModelUsage[] = [];
  private todos: TodoItem[] = [];
  private checkpoints: FileCheckpoint[] = [];
  private createdWorktrees: string[] = [];
  private sessionStart?: Promise<void>;
  private sessionEnded = false;

  constructor(
    private provider: Provider,
    private tools: ToolSpec[],
    private permissions: PermissionEngine,
    private opts: AgentOptions,
  ) {
    // Deep-copy: the seed is owned by the caller (e.g. a loaded session); a
    // shallow copy would share content objects and risk cross-mutation.
    this.messages = opts.initialMessages ? structuredClone(opts.initialMessages) : [];
    this.todos = opts.initialTodos ? structuredClone(opts.initialTodos) : [];
    this.usage = opts.initialUsage ? structuredClone(opts.initialUsage) : [];
  }

  /** Runtime model switching (/model) swaps the provider without losing history. */
  setProvider(provider: Provider): void {
    this.provider = provider;
  }
  getProvider(): Provider {
    return this.provider;
  }

  pushUser(text: string, extra: ContentPart[] = []): void {
    const content: ContentPart[] = [{ type: "text", text }];
    for (const p of extra) {
      if (p.type === "image") content.push(p);
    }
    this.messages.push({ role: "user", content });
  }

  /**
   * UserPromptSubmit hook then pushUser. If blocked, the prompt is not appended.
   */
  async submitPrompt(
    text: string,
    extra: ContentPart[] = [],
  ): Promise<{ blocked: boolean; reason?: string }> {
    const r = await this.fireHooks("UserPromptSubmit", { prompt: text });
    if (r.blocked) return r;
    this.pushUser(text, extra);
    return r;
  }

  sessionWorktrees(): readonly string[] {
    return this.createdWorktrees;
  }

  async startSession(): Promise<void> {
    if (this.opts.isChild) return;
    this.sessionStart ??= this.fireHooks("SessionStart", {}).then(() => undefined);
    await this.sessionStart;
  }

  async endSession(): Promise<void> {
    if (this.opts.isChild || this.sessionEnded) return;
    this.sessionEnded = true;
    await this.fireHooks("SessionEnd", {});
  }

  private async fireHooks(
    event: Parameters<typeof runHooks>[1],
    ctx: Parameters<typeof runHooks>[3],
  ): Promise<{ blocked: boolean; reason?: string }> {
    if (!this.opts.hooks) return { blocked: false };
    try {
      return await runHooks(this.opts.hooks, event, this.opts.sandbox, ctx);
    } catch (e) {
      if (event === "PreToolUse" || event === "UserPromptSubmit") {
        return { blocked: true, reason: String(e) };
      }
      return { blocked: false };
    }
  }

  history(): readonly CanonicalMessage[] {
    return this.messages;
  }

  contextView(): ContextBreakdown {
    return contextBreakdown({
      messages: this.messages,
      system: this.opts.system,
      toolSchemaChars: this.tools.reduce((n, t) => n + t.name.length + t.description.length + JSON.stringify(t.parameters).length, 0),
      contextWindow: this.provider.capabilities().contextWindow,
    });
  }

  formatContext(): string {
    return formatContextBreakdown(this.contextView());
  }

  usageLedger(): readonly ModelUsage[] {
    return this.usage;
  }

  formatCost(): string {
    return formatCost(this.usage);
  }

  listTodos(): readonly TodoItem[] {
    return this.todos;
  }

  /**
   * Restore files from the last mutating-tool checkpoint and truncate history
   * to just before that assistant turn.
   */
  async rewind(): Promise<{ files: string[]; dropped: number } | null> {
    const cp = this.checkpoints.pop();
    if (!cp) return null;
    const dropped = this.messages.length - cp.messageLength;
    this.messages = this.messages.slice(0, cp.messageLength);
    const files: string[] = [];
    for (const [path, body] of Object.entries(cp.files)) {
      if (body === null) continue; // created file; leave it rather than delete
      try {
        await this.opts.sandbox.writeFile(path, body);
        files.push(path);
      } catch {
        /* best-effort */
      }
    }
    return { files, dropped };
  }

  private async captureCheckpoint(calls: ToolCallPart[]): Promise<void> {
    const files: Record<string, string | null> = {};
    for (const c of calls) {
      const path = (c.input as { path?: string } | undefined)?.path;
      if (typeof path !== "string" || path in files) continue;
      try {
        files[path] = await this.opts.sandbox.readFile(path);
      } catch {
        files[path] = null;
      }
    }
    if (!Object.keys(files).length) return;
    this.checkpoints.push({ messageLength: Math.max(0, this.messages.length - 1), files });
    if (this.checkpoints.length > 20) this.checkpoints.shift();
  }

  /** Run a depth-1 child loop. Parent history gets only the returned text. */
  async spawnChild(input: SpawnChildInput, signal?: AbortSignal): Promise<ToolRunResult> {
    if (this.opts.isChild) {
      return { output: "nested task is not allowed (max depth 1)", isError: true };
    }
    let type;
    try {
      type = parseChildType(input.subagent_type);
    } catch (e) {
      return { output: String(e), isError: true };
    }
    let childSandbox = this.opts.sandbox;
    let worktreeNote = "";
    if (input.isolation === "worktree") {
      if (!this.opts.openWorktree) {
        return { output: "worktree isolation is not configured in this session", isError: true };
      }
      try {
        const wt = await this.opts.openWorktree();
        childSandbox = wt.sandbox;
        this.createdWorktrees.push(wt.path);
        worktreeNote = `\n\n[worktree ${wt.path} — not merged. /worktree apply <id> to copy onto the parent tree]`;
      } catch (e) {
        return { output: `worktree failed: ${String(e)}`, isError: true };
      }
    }
    await this.fireHooks("SubagentStart", { prompt: input.prompt, subagentType: type });
    const child = new Agent(this.provider, toolsForChild(type, this.tools), this.permissions, {
      sandbox: childSandbox,
      system: systemForChild(type, this.opts.system),
      compact: this.opts.compact,
      maxSteps: 30,
      isChild: true,
      hooks: this.opts.hooks,
    });
    child.pushUser(input.prompt);
    try {
      for await (const _ev of child.run(signal)) {
        /* parent does not ingest child stream — isolation is the point */
      }
    } catch (e) {
      if (signal?.aborted) return { output: "child interrupted", isError: true };
      return { output: `child failed: ${String(e)}`, isError: true };
    } finally {
      await this.fireHooks("SubagentStop", { prompt: input.prompt, subagentType: type });
    }
    const last = [...child.history()].reverse().find((m) => m.role === "assistant");
    const text = last
      ? last.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("")
          .trim()
      : "";
    return { output: clipChildOutput(text || "(child produced no text)") + worktreeNote };
  }

  /**
   * Run two-pass compaction now. Manual always applies; auto no-ops when under
   * the threshold or sticky-suppressed. Returns null if nothing ran.
   */
  async compactNow(reason: CompactReason = "manual", focus?: string): Promise<CompactStats | null> {
    const cfg = this.opts.compact;
    if (cfg?.enabled === false) return null;
    const window = this.provider.capabilities().contextWindow;
    const before = estimateTokens(this.messages);
    if (reason === "auto") {
      if (this.compactSuppressed) return { before, after: before, reason, pass: "none", suppressed: true };
      if (!overThreshold(before, window, cfg?.thresholdPercent)) return null;
    }
    try {
      const { messages, stats } = await compactMessages({
        messages: this.messages,
        contextWindow: window,
        reason,
        focus,
        config: cfg,
        system: this.opts.system,
      });
      const enough = reducedEnough(stats.before, stats.after);
      if (enough || reason === "manual") {
        this.messages = messages;
        this.compactSuppressed = false;
        return { ...stats, after: estimateTokens(this.messages) };
      }
      this.compactSuppressed = true;
      return { ...stats, suppressed: true };
    } catch {
      if (reason === "auto") this.compactSuppressed = true;
      return { before, after: before, reason, pass: "none", suppressed: true };
    }
  }

  async *run(signal?: AbortSignal): AsyncGenerator<AgentUIEvent> {
    const toolMap = new Map(this.tools.map((t) => [t.name, t]));
    const maxSteps = this.opts.maxSteps ?? 50;
    const maxRetries = this.opts.maxRetries ?? 2;
    let steps = 0;
    await this.startSession();

    try {
    while (true) {
      const compacted = await this.compactNow("auto");
      if (compacted && compacted.pass !== "none") {
        yield { type: "compacted", stats: compacted };
      }

      if (steps++ >= maxSteps) {
        yield {
          type: "error",
          error: `step limit reached (${maxSteps} model turns) — stopping to avoid a runaway loop`,
        };
        return;
      }

      const assistantContent: ContentPart[] = [];
      const pending: ToolCallPart[] = [];
      let textBuf = "";
      let stop: StopReason = "end_turn";
      let usage: { inputTokens: number; outputTokens: number } | undefined;
      let fatal = false;

      // One model turn. Retry transient provider errors (rate limits, dropped
      // connections) that hit BEFORE we've emitted anything this turn; once text
      // or tool calls have streamed we can't cleanly replay, so we surface it.
      for (let attempt = 0; ; attempt++) {
        let produced = false;
        let errored: string | undefined;

        try {
          for await (const ev of this.provider.stream({
            system: this.opts.system,
            messages: this.messages,
            tools: this.tools,
            signal,
          })) {
            switch (ev.type) {
              case "text_delta":
                textBuf += ev.text;
                produced = true;
                yield ev;
                break;
              case "reasoning_delta":
                // Surfaced to the UI but not replayed into history — reasoning
                // blocks are not portable across providers.
                produced = true;
                yield ev;
                break;
              case "tool_call":
                pending.push(ev.call);
                assistantContent.push(ev.call);
                produced = true;
                yield ev;
                break;
              case "stop":
                stop = ev.reason;
                usage = ev.usage;
                yield ev;
                break;
              case "error":
                errored = ev.error;
                break;
            }
          }
        } catch (e) {
          if (signal?.aborted) throw e; // user interrupt — let it propagate
          errored = String(e);
        }

        if (!errored) break; // turn finished cleanly

        if (!produced && attempt < maxRetries && isTransient(errored)) {
          await delay(backoffMs(attempt));
          textBuf = "";
          assistantContent.length = 0;
          pending.length = 0;
          continue; // re-stream the same turn
        }

        yield { type: "error", error: errored };
        fatal = true;
        break;
      }

      if (fatal) return;

      if (textBuf) assistantContent.unshift({ type: "text", text: textBuf });
      this.messages.push({ role: "assistant", content: assistantContent });

      // Settled turn → emit usage exactly once. The retry loop above has already
      // collapsed any replayed `stop` events, so a UI can sum per-turn usage
      // here without double-counting a retried turn.
      if (usage) {
        const key = `${this.provider.id}:${this.provider.model}`;
        const row = this.usage.find((u) => u.model === key);
        if (row) {
          row.inputTokens += usage.inputTokens;
          row.outputTokens += usage.outputTokens;
        } else {
          this.usage.push({
            model: key,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          });
        }
      }
      yield { type: "turn_complete", usage };

      if (stop !== "tool_use" || pending.length === 0) {
        return;
      }

      // Permission-gate + execute. Consecutive parallel-safe (read-only) tools
      // run concurrently — they're "safe" class, so they never prompt and can't
      // overlap permission dialogs; everything else runs sequentially. Results
      // are appended in call order regardless, so the model sees them in order.
      const ctx: ToolContext = {
        sandbox: this.opts.sandbox,
        signal,
        todos: {
          list: () => this.todos,
          replace: (items) => {
            this.todos = items;
          },
        },
      };
      if (!this.opts.isChild) {
        ctx.spawnChild = (input) => this.spawnChild(input, signal);
      }
      const mutating = pending.filter((c) => {
        const t = toolMap.get(c.name);
        return t && t.permission !== "safe";
      });
      if (mutating.length) await this.captureCheckpoint(mutating);
      const results: ToolResultPart[] = [];

      const execOne = async (
        call: ToolCallPart,
      ): Promise<{ events: AgentUIEvent[]; result: ToolResultPart }> => {
        const tool = toolMap.get(call.name);
        if (!tool) {
          const result = errorResult(call, `unknown tool: ${call.name}`);
          return { events: [{ type: "tool_result", result }], result };
        }
        const decision = await this.permissions.check(tool, call.input);
        if (!decision.allow) {
          const result = errorResult(call, `Denied: ${decision.reason ?? "permission"}`);
          return { events: [{ type: "tool_denied", call, reason: decision.reason }], result };
        }
        const pre = await this.fireHooks("PreToolUse", { tool, input: call.input });
        if (pre.blocked) {
          const result = errorResult(call, `Denied: ${pre.reason ?? "hook"}`);
          return { events: [{ type: "tool_denied", call, reason: pre.reason }], result };
        }
        const events: AgentUIEvent[] = [{ type: "tool_executing", call }];
        let result: ToolResultPart;
        let display: string | undefined;
        try {
          const r = await tool.run(call.input, ctx);
          const redacted = redactSecrets(r.output);
          result = {
            type: "tool_result",
            id: call.id,
            name: call.name,
            output:
              redacted.count > 0
                ? `${redacted.text}\n[${redacted.count} secret(s) redacted]`
                : redacted.text,
            isError: r.isError,
          };
          display = r.display; // UI-only; never enters `result`/model messages
        } catch (err) {
          result = errorResult(call, String(err));
        }
        await this.fireHooks("PostToolUse", { tool, input: call.input, output: result.output });
        events.push({ type: "tool_result", result, display });
        return { events, result };
      };

      let idx = 0;
      while (idx < pending.length) {
        // Gather a run of consecutive read-only calls that are BOTH parallelSafe
        // and "safe" class — safe never prompts, so concurrency can't overlap
        // permission dialogs or run a mutation alongside reads.
        const batch: ToolCallPart[] = [];
        while (idx < pending.length) {
          const t = toolMap.get(pending[idx].name);
          if (t?.parallelSafe && t.permission === "safe") batch.push(pending[idx++]);
          else break;
        }

        if (batch.length > 1) {
          const outcomes = await Promise.all(batch.map(execOne));
          for (const o of outcomes) {
            for (const ev of o.events) yield ev;
            results.push(o.result);
          }
        } else {
          const call = batch.length === 1 ? batch[0] : pending[idx++];
          const { events, result } = await execOne(call);
          for (const ev of events) yield ev;
          results.push(result);
        }
      }

      this.messages.push({ role: "tool", content: results });
      // loop: feed tool results back to the model on the next turn
    }
    } finally {
      if (!this.opts.isChild) await this.fireHooks("Stop", {});
    }
  }
}

function errorResult(call: ToolCallPart, output: string): ToolResultPart {
  return { type: "tool_result", id: call.id, name: call.name, output, isError: true };
}

/** Heuristic: is this provider error worth retrying (vs. a hard 4xx/bad request)? */
function isTransient(msg: string): boolean {
  return /\b(429|500|502|503|504)\b|rate.?limit|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket hang ?up|overloaded|temporarily|unavailable/i.test(
    msg,
  );
}

/** Exponential backoff with jitter: ~0.5s, 1s, 2s, … */
function backoffMs(attempt: number): number {
  return 500 * 2 ** attempt + Math.floor(Math.random() * 250);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
