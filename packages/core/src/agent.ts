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
  ChildRun,
} from "./types.js";
import { PermissionEngine, type PermissionMode } from "./permissions.js";
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
  isReadOnlyTask,
  parseChildType,
  systemForChild,
  taskWantsWorktree,
  toolsForChild,
} from "./subagent.js";
import { redactSecrets } from "./redact.js";
import { formatCost, type ModelUsage } from "./cost.js";
import { runHooks, type HookSet } from "./hooks.js";
import { lookupPersona, type Persona } from "./personas.js";

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
  personas?: Persona[];
  /** Fired when a background child settles (completed / failed / killed). */
  onChildSettled?: (run: ChildRun) => void;
}

const MAX_RUNNING_CHILDREN = 8;
const MAX_WAIT_CHILD_MS = 10 * 60 * 1000;
const MAX_RESUME_MESSAGES = 24;
const MAX_FINISHED_CHILDREN = 32;

interface ChildHandle {
  snap: ChildRun;
  agent?: Agent;
  abort: AbortController;
  done: Promise<void>;
  sandbox: Sandbox;
  unlinkParent?: () => void;
  settledHook?: boolean;
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
  private children = new Map<string, ChildHandle>();
  private childSeq = 0;
  private demoteTurn = false;
  /** Parallel `task` batches spawn on forkSilent so they cannot share the TUI prompt. */
  private silentChildSpawns = false;

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

  listChildren(): ChildRun[] {
    return [...this.children.values()].map((h) => ({ ...h.snap }));
  }

  /** Live output for peek — running children stream into the child agent history. */
  peekChild(id: string): ChildRun | null {
    const h = this.children.get(id);
    if (!h) return null;
    if (!h.agent) return { ...h.snap };
    const live = redactSecrets(clipChildOutput(finalAssistantText(h.agent) || h.snap.output || "")).text;
    return { ...h.snap, output: live };
  }

  replacePermissions(engine: PermissionEngine): void {
    this.permissions.invalidatePrompts();
    this.permissions = engine;
  }

  /**
   * Unlink running children from the parent abort signal so Ctrl+B can free the
   * composer without killing the team. Returns ids still running.
   */
  detachRunningChildren(): string[] {
    this.demoteTurn = true;
    const ids: string[] = [];
    const mode = this.permissions.getMode();
    const silentWrite = mode === "yolo" || mode === "acceptEdits";
    for (const h of this.children.values()) {
      if (h.snap.status !== "running") continue;
      h.unlinkParent?.();
      h.unlinkParent = undefined;
      const readOnly = h.snap.subagentType === "explore" || h.snap.subagentType === "researcher";
      if (!readOnly && !silentWrite) {
        h.abort.abort();
        if (h.snap.status === "running") {
          h.snap.status = "killed";
          h.snap.error = true;
          h.snap.output = "child interrupted";
          h.snap.endedAt = Date.now();
        }
        this.hookChildSettled(h);
        continue;
      }
      h.agent?.replacePermissions(this.permissions.forkSilent());
      this.hookChildSettled(h);
      ids.push(h.snap.id);
    }
    return ids;
  }

  private hookChildSettled(h: ChildHandle): void {
    if (h.settledHook) return;
    h.settledHook = true;
    void h.done.then(() => this.opts.onChildSettled?.({ ...h.snap }));
  }

  async startSession(): Promise<void> {
    if (this.opts.isChild) return;
    this.sessionStart ??= this.fireHooks("SessionStart", {}).then(() => undefined);
    await this.sessionStart;
  }

  async endSession(): Promise<void> {
    if (this.opts.isChild || this.sessionEnded) return;
    this.sessionEnded = true;
    for (const h of this.children.values()) {
      if (h.snap.status === "running") h.abort.abort();
    }
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

    let resume: ChildHandle | undefined;
    if (input.resume_from) {
      resume = this.children.get(input.resume_from);
      if (!resume) return { output: `unknown child "${input.resume_from}"`, isError: true };
      if (resume.snap.status === "running") {
        return { output: `child ${resume.snap.id} is still running — wait or kill it first`, isError: true };
      }
    }

    let type: string;
    try {
      type = resume
        ? resume.snap.subagentType
        : parseChildType(input.subagent_type);
      if (input.resume_from && input.subagent_type) {
        const want = parseChildType(input.subagent_type);
        if (want !== type) {
          return {
            output: `resume_from ${input.resume_from} is type ${type}, not ${want}`,
            isError: true,
          };
        }
      }
    } catch (e) {
      return { output: String(e), isError: true };
    }

    const persona = lookupPersona(this.opts.personas, input.persona ?? resume?.snap.persona);
    if ((input.persona || "").trim() && !persona) {
      const names = (this.opts.personas ?? []).map((p) => p.name).join(", ") || "(none)";
      return { output: `unknown persona "${input.persona}" (loaded: ${names})`, isError: true };
    }

    const parentMode = this.permissions.getMode();
    if (
      input.background &&
      !isReadOnlyTask({ subagent_type: type }) &&
      parentMode !== "yolo" &&
      parentMode !== "acceptEdits"
    ) {
      return {
        output: "background writers require /mode acceptEdits or yolo (background children cannot prompt)",
        isError: true,
      };
    }
    if (
      input.background &&
      type === "researcher" &&
      parentMode !== "yolo" &&
      parentMode !== "acceptEdits"
    ) {
      return {
        output: "background researcher requires /mode acceptEdits or yolo (web_* cannot prompt)",
        isError: true,
      };
    }

    const running = [...this.children.values()].filter((h) => h.snap.status === "running").length;
    if (running >= MAX_RUNNING_CHILDREN) {
      return { output: `too many running children (${running}/${MAX_RUNNING_CHILDREN})`, isError: true };
    }

    // Isolation is a property of the source child. Ignore input.isolation on resume.
    const isolation: "none" | "worktree" = resume
      ? resume.snap.isolation === "worktree"
        ? "worktree"
        : "none"
      : input.isolation === "worktree"
        ? "worktree"
        : "none";

    const id = this.newChildId();
    const abort = new AbortController();
    const gate = deferredVoid();
    const snap: ChildRun = {
      id,
      description: input.description,
      subagentType: type,
      isolation,
      persona: persona?.name,
      worktreePath: resume?.snap.worktreePath,
      status: "running",
      output: "",
      startedAt: Date.now(),
    };
    const handle: ChildHandle = {
      snap,
      abort,
      sandbox: resume?.sandbox ?? this.opts.sandbox,
      done: gate.promise,
    };
    if (signal && !input.background) {
      const onAbort = () => abort.abort();
      if (signal.aborted) abort.abort();
      else {
        signal.addEventListener("abort", onAbort);
        handle.unlinkParent = () => signal.removeEventListener("abort", onAbort);
      }
    }
    // Reserve the slot before any await so parallel spawnChild calls share one cap.
    this.children.set(id, handle);
    let committed = false;
    try {
      let childSandbox = handle.sandbox;
      let worktreePath = snap.worktreePath;
      let worktreeNote = "";
      if (isolation === "worktree" && !resume) {
        if (!this.opts.openWorktree) {
          return { output: "worktree isolation is not configured in this session", isError: true };
        }
        try {
          const wt = await this.opts.openWorktree();
          childSandbox = wt.sandbox;
          worktreePath = wt.path;
          snap.worktreePath = wt.path;
          this.createdWorktrees.push(wt.path);
          worktreeNote = `\n\n[worktree ${wt.path} — not merged. /worktree apply <id> to copy onto the parent tree]`;
        } catch (e) {
          return { output: `worktree failed: ${String(e)}`, isError: true };
        }
      } else if (worktreePath) {
        worktreeNote = `\n\n[worktree ${worktreePath} — not merged. /worktree apply <id> to copy onto the parent tree]`;
      }

      await this.fireHooks("SubagentStart", { prompt: input.prompt, subagentType: type });
      if (handle.snap.status !== "running") {
        committed = true;
        gate.resolve();
        return { output: handle.snap.output || `child ${id} ${handle.snap.status}`, isError: true };
      }
      const detachedFromParent = !!(signal && !input.background && !handle.unlinkParent);
      const silent = input.background || this.silentChildSpawns || detachedFromParent;
      const isolatedWrite = isolation === "worktree" && parentMode !== "plan";
      const childPerms = isolatedWrite
        ? this.permissions.forkIsolated()
        : silent
          ? this.permissions.forkSilent()
          : this.permissions.forkInteractive();
      const child = new Agent(this.provider, toolsForChild(type, this.tools), childPerms, {
        sandbox: childSandbox,
        system: systemForChild(type, this.opts.system, persona?.instructions),
        compact: this.opts.compact,
        maxSteps: 30,
        isChild: true,
        hooks: this.opts.hooks,
        initialMessages: resume?.agent ? cloneResumeHistory(resume.agent.history()) : undefined,
      });
      child.pushUser(input.prompt);

      handle.agent = child;
      handle.sandbox = childSandbox;
      const drive = this.driveChild(handle, worktreeNote);
      void drive.then(gate.resolve, (err) => {
        gate.resolve();
        void err;
      });
      committed = true;
    } finally {
      if (!committed) {
        gate.resolve();
        this.children.delete(id);
      }
    }

    if (input.background) {
      this.hookChildSettled(handle);
      return {
        output:
          `background child ${id} (${type}) running: ${input.description}\n` +
          `Use task_wait with id=${id} to collect, or /dashboard.`,
      };
    }
    if (signal) await abortableRace(handle.done, signal);
    else await handle.done;
    if (handle.snap.status === "running") {
      handle.unlinkParent?.();
      handle.unlinkParent = undefined;
      handle.agent?.replacePermissions(this.permissions.forkSilent());
      this.hookChildSettled(handle);
      return {
        output:
          `backgrounded ${id} (${type}): ${input.description}\n` +
          `Use task_wait or /dashboard. Ctrl+B detached this child from the parent turn.`,
      };
    }
    return { output: handle.snap.output, isError: handle.snap.error };
  }

  async waitChild(id?: string, timeoutMs = 0, signal?: AbortSignal): Promise<ToolRunResult> {
    if (!id) {
      const rows = this.listChildren();
      if (!rows.length) return { output: "no child agents in this session" };
      return { output: rows.map(formatChildLine).join("\n") };
    }
    const h = this.children.get(id);
    if (!h) return { output: `unknown child "${id}"`, isError: true };
    if (h.snap.status === "running") {
      const waitMs = clampWaitMs(timeoutMs);
      if (waitMs > 0) {
        await waitUntil(h.done, waitMs, signal);
      }
      if (h.snap.status === "running") {
        const live = this.peekChild(id) ?? h.snap;
        return { output: `${formatChildReport(live)}\n(still running)` };
      }
    }
    const live = this.peekChild(id) ?? h.snap;
    return {
      output: formatChildReport(live),
      isError: !!h.snap.error,
    };
  }

  killChild(id: string): ToolRunResult {
    const h = this.children.get(id);
    if (!h) return { output: `unknown child "${id}"`, isError: true };
    if (h.snap.status !== "running") return { output: `child ${id} already ${h.snap.status}` };
    h.abort.abort();
    return { output: `killed ${id} (${h.snap.description})` };
  }

  private newChildId(): string {
    this.childSeq += 1;
    return `c${this.childSeq.toString(16)}`;
  }

  private async driveChild(handle: ChildHandle, worktreeNote: string): Promise<void> {
    try {
      if (!handle.agent) throw new Error("child agent missing");
      let failMsg = "";
      for await (const ev of handle.agent.run(handle.abort.signal)) {
        if (ev.type === "error") failMsg = ev.error;
      }
      if (handle.snap.status === "running") {
        if (failMsg) {
          handle.snap.status = "failed";
          handle.snap.error = true;
          handle.snap.output = redactSecrets(`child failed: ${failMsg}`).text;
        } else {
          handle.snap.status = handle.abort.signal.aborted ? "killed" : "completed";
          const raw = clipChildOutput(finalAssistantText(handle.agent) || "(child produced no text)");
          handle.snap.output = redactSecrets(raw).text + worktreeNote;
          handle.snap.error = handle.snap.status !== "completed";
        }
      }
    } catch (e) {
      if (handle.snap.status === "running") {
        handle.snap.status = handle.abort.signal.aborted ? "killed" : "failed";
        handle.snap.error = true;
        handle.snap.output = redactSecrets(
          handle.abort.signal.aborted ? "child interrupted" : `child failed: ${String(e)}`,
        ).text;
      }
    } finally {
      if (!handle.snap.endedAt) handle.snap.endedAt = Date.now();
      await this.fireHooks("SubagentStop", {
        prompt: handle.snap.description,
        subagentType: handle.snap.subagentType,
      });
      this.gcChildren();
    }
  }

  private gcChildren(): void {
    const done = [...this.children.values()].filter((h) => h.snap.status !== "running");
    if (done.length <= MAX_FINISHED_CHILDREN) return;
    done.sort((a, b) => (a.snap.endedAt ?? 0) - (b.snap.endedAt ?? 0));
    for (const h of done.slice(0, done.length - MAX_FINISHED_CHILDREN)) this.children.delete(h.snap.id);
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
      let sawStop = false;
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
                break;
              case "stop":
                stop = ev.reason;
                usage = ev.usage;
                sawStop = true;
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
          sawStop = false;
          usage = undefined;
          stop = "end_turn";
          continue; // re-stream the same turn
        }

        yield { type: "error", error: errored };
        fatal = true;
        break;
      }

      if (fatal) return;

      if (textBuf) assistantContent.unshift({ type: "text", text: textBuf });
      stampParallelTaskWorktrees(pending);
      for (const call of pending) {
        yield { type: "tool_call", call };
      }
      if (sawStop) yield { type: "stop", reason: stop, usage };
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
        ctx.waitChild = (id, ms) => this.waitChild(id, ms, signal);
        ctx.killChild = (id) => this.killChild(id);
        ctx.listChildren = () => this.listChildren();
      }
      const mutating = pending.filter((c) => {
        const t = toolMap.get(c.name);
        return t && t.permission !== "safe";
      });
      if (mutating.length) await this.captureCheckpoint(mutating);
      const results: ToolResultPart[] = [];

      const gate = async (
        call: ToolCallPart,
      ): Promise<
        | { ok: true; tool: ToolSpec }
        | { ok: false; events: AgentUIEvent[]; result: ToolResultPart }
      > => {
        const tool = toolMap.get(call.name);
        if (!tool) {
          const result = errorResult(call, `unknown tool: ${call.name}`);
          return { ok: false, events: [{ type: "tool_result", result }], result };
        }
        const decision = await this.permissions.check(tool, call.input);
        if (!decision.allow) {
          const result = errorResult(call, `Denied: ${decision.reason ?? "permission"}`);
          return { ok: false, events: [{ type: "tool_denied", call, reason: decision.reason }], result };
        }
        const pre = await this.fireHooks("PreToolUse", { tool, input: call.input });
        if (pre.blocked) {
          const result = errorResult(call, `Denied: ${pre.reason ?? "hook"}`);
          return { ok: false, events: [{ type: "tool_denied", call, reason: pre.reason }], result };
        }
        return { ok: true, tool };
      };

      const runTool = async (
        call: ToolCallPart,
        tool: ToolSpec,
      ): Promise<{ events: AgentUIEvent[]; result: ToolResultPart }> => {
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
          display = r.display;
        } catch (err) {
          result = errorResult(call, String(err));
        }
        await this.fireHooks("PostToolUse", { tool, input: call.input, output: result.output });
        events.push({ type: "tool_result", result, display });
        return { events, result };
      };

      const execOne = async (call: ToolCallPart) => {
        const g = await gate(call);
        if (!g.ok) return { events: g.events, result: g.result };
        return runTool(call, g.tool);
      };

      let idx = 0;
      let backgrounded = false;
      const mode = this.permissions.getMode();
      while (idx < pending.length) {
        if (signal?.aborted && this.demoteTurn) {
          backgrounded = true;
          break;
        }
        // Consecutive read-only tools AND fan-out `task` children run together.
        // Only children that will not prompt may share a batch.
        const batch: ToolCallPart[] = [];
        while (idx < pending.length) {
          const call = pending[idx];
          const t = toolMap.get(call.name);
          if (canRunParallel(t, call, mode)) batch.push(pending[idx++]);
          else break;
        }

        if (batch.length > 1) {
          const allowed: Array<{ call: ToolCallPart; tool: ToolSpec }> = [];
          for (const call of batch) {
            const g = await gate(call);
            if (!g.ok) {
              for (const ev of g.events) yield ev;
              results.push(g.result);
            } else allowed.push({ call, tool: g.tool });
          }
          const hadTask = allowed.some((a) => a.call.name === "task");
          if (hadTask) this.silentChildSpawns = true;
          try {
            const outcomes = await Promise.all(allowed.map(({ call, tool }) => runTool(call, tool)));
            for (const o of outcomes) {
              for (const ev of o.events) yield ev;
              results.push(o.result);
            }
          } finally {
            this.silentChildSpawns = false;
          }
        } else {
          const call = batch.length === 1 ? batch[0] : pending[idx++];
          const { events, result } = await execOne(call);
          for (const ev of events) yield ev;
          results.push(result);
        }
      }

      if (backgrounded || (signal?.aborted && this.demoteTurn)) {
        while (idx < pending.length) {
          const skipped = errorResult(pending[idx++], "skipped — turn backgrounded (Ctrl+B)");
          results.push(skipped);
          yield { type: "tool_result", result: skipped };
        }
      }

      this.messages.push({ role: "tool", content: results });
      if (this.demoteTurn) {
        this.demoteTurn = false;
        return;
      }
      // loop: feed tool results back to the model on the next turn
    }
    } finally {
      this.demoteTurn = false;
      this.silentChildSpawns = false;
      if (!this.opts.isChild) await this.fireHooks("Stop", {});
    }
  }
}

function finalAssistantText(agent: Agent | undefined): string {
  if (!agent) return "";
  const last = [...agent.history()].reverse().find((m) => m.role === "assistant");
  if (!last) return "";
  return last.content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
}

function elapsed(run: ChildRun): string {
  const end = run.endedAt ?? Date.now();
  const s = Math.max(0, Math.round((end - run.startedAt) / 1000));
  return `${s}s`;
}

export function formatChildLine(run: ChildRun): string {
  const extra = run.worktreePath ? `  wt:${run.worktreePath}` : "";
  const persona = run.persona ? `  persona:${run.persona}` : "";
  return `${run.id}  ${run.status.padEnd(9)}  ${run.subagentType}  ${run.description}  ${elapsed(run)}${persona}${extra}`;
}

function formatChildReport(run: ChildRun): string {
  return `${formatChildLine(run)}\n${run.output || "(no output yet)"}`;
}

function canRunParallel(tool: ToolSpec | undefined, call: ToolCallPart, mode: PermissionMode): boolean {
  if (!tool) return false;
  if (tool.parallelSafe && tool.permission === "safe") return true;
  if (tool.name !== "task") return false;
  const silentOk = mode === "yolo" || mode === "acceptEdits";
  if (isReadOnlyTask(call.input)) {
    const type = String((call.input as { subagent_type?: string }).subagent_type ?? "general").toLowerCase();
    if (type === "researcher") return silentOk;
    return true;
  }
  if (taskWantsWorktree(call.input)) return silentOk;
  return false;
}

/** Two+ writable task children in one turn get isolated worktrees so they don't clobber. */
function stampParallelTaskWorktrees(pending: ToolCallPart[]): void {
  const tasks = pending.filter((c) => c.name === "task");
  if (tasks.length < 2) return;
  for (const c of tasks) {
    if (isReadOnlyTask(c.input) || taskWantsWorktree(c.input)) continue;
    c.input = { ...((c.input ?? {}) as Record<string, unknown>), isolation: "worktree" };
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

function clampWaitMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(Math.max(Math.floor(ms), 1), MAX_WAIT_CHILD_MS);
}

function cloneResumeHistory(messages: readonly CanonicalMessage[]): CanonicalMessage[] {
  let slice = messages.length > MAX_RESUME_MESSAGES ? messages.slice(-MAX_RESUME_MESSAGES) : [...messages];
  while (slice.length && slice[0].role === "tool") slice = slice.slice(1);
  return structuredClone(slice);
}

function deferredVoid(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Race `done` against abort; always remove the abort listener. */
function abortableRace(done: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => finish();
    signal.addEventListener("abort", onAbort);
    done.then(finish, finish);
  });
}

function waitUntil(done: Promise<void>, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => finish();
    done.then(finish, finish);
    if (timeoutMs > 0) timer = setTimeout(finish, timeoutMs);
    if (signal) signal.addEventListener("abort", onAbort);
  });
}
