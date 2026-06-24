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
} from "./types.js";
import { PermissionEngine } from "./permissions.js";

/** Events the UI / server consume: canonical stream events plus tool lifecycle. */
export type AgentUIEvent =
  | CanonicalEvent
  | { type: "tool_executing"; call: ToolCallPart }
  | { type: "tool_result"; result: ToolResultPart; display?: string }
  | { type: "tool_denied"; call: ToolCallPart; reason?: string }
  | { type: "turn_complete"; usage?: { inputTokens: number; outputTokens: number } };

export interface AgentOptions {
  system?: string;
  sandbox: Sandbox;
  /** Hard cap on model turns per run() to stop runaway tool loops (default 50). */
  maxSteps?: number;
  /** Retries for transient provider errors that hit before any output (default 2). */
  maxRetries?: number;
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
  private messages: CanonicalMessage[] = [];

  constructor(
    private provider: Provider,
    private tools: ToolSpec[],
    private permissions: PermissionEngine,
    private opts: AgentOptions,
  ) {}

  /** Runtime model switching (/model) swaps the provider without losing history. */
  setProvider(provider: Provider): void {
    this.provider = provider;
  }
  getProvider(): Provider {
    return this.provider;
  }

  pushUser(text: string): void {
    this.messages.push({ role: "user", content: [{ type: "text", text }] });
  }

  history(): readonly CanonicalMessage[] {
    return this.messages;
  }

  async *run(signal?: AbortSignal): AsyncGenerator<AgentUIEvent> {
    const toolMap = new Map(this.tools.map((t) => [t.name, t]));
    const maxSteps = this.opts.maxSteps ?? 50;
    const maxRetries = this.opts.maxRetries ?? 2;
    let steps = 0;

    while (true) {
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
      yield { type: "turn_complete", usage };

      if (stop !== "tool_use" || pending.length === 0) {
        return;
      }

      // Permission-gate + execute. Consecutive parallel-safe (read-only) tools
      // run concurrently — they're "safe" class, so they never prompt and can't
      // overlap permission dialogs; everything else runs sequentially. Results
      // are appended in call order regardless, so the model sees them in order.
      const ctx: ToolContext = { sandbox: this.opts.sandbox, signal };
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
        const events: AgentUIEvent[] = [{ type: "tool_executing", call }];
        let result: ToolResultPart;
        let display: string | undefined;
        try {
          const r = await tool.run(call.input, ctx);
          result = {
            type: "tool_result",
            id: call.id,
            name: call.name,
            output: r.output,
            isError: r.isError,
          };
          display = r.display; // UI-only; never enters `result`/model messages
        } catch (err) {
          result = errorResult(call, String(err));
        }
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
