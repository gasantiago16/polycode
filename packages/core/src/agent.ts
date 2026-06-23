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
  | { type: "tool_result"; result: ToolResultPart }
  | { type: "tool_denied"; call: ToolCallPart; reason?: string }
  | { type: "turn_complete"; usage?: { inputTokens: number; outputTokens: number } };

export interface AgentOptions {
  system?: string;
  sandbox: Sandbox;
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

    while (true) {
      const assistantContent: ContentPart[] = [];
      const pending: ToolCallPart[] = [];
      let textBuf = "";
      let stop: StopReason = "end_turn";
      let usage: { inputTokens: number; outputTokens: number } | undefined;

      for await (const ev of this.provider.stream({
        system: this.opts.system,
        messages: this.messages,
        tools: this.tools,
        signal,
      })) {
        switch (ev.type) {
          case "text_delta":
            textBuf += ev.text;
            yield ev;
            break;
          case "reasoning_delta":
            // Reasoning is surfaced to the UI but not replayed into history,
            // since reasoning blocks are not portable across providers.
            yield ev;
            break;
          case "tool_call":
            pending.push(ev.call);
            assistantContent.push(ev.call);
            yield ev;
            break;
          case "stop":
            stop = ev.reason;
            usage = ev.usage;
            yield ev;
            break;
          case "error":
            yield ev;
            return;
        }
      }

      if (textBuf) assistantContent.unshift({ type: "text", text: textBuf });
      this.messages.push({ role: "assistant", content: assistantContent });

      if (stop !== "tool_use" || pending.length === 0) {
        yield { type: "turn_complete", usage };
        return;
      }

      // Permission-gate + execute. Sequential for now so permission prompts
      // never overlap; parallelSafe tools can later be batched with Promise.all.
      const ctx: ToolContext = { sandbox: this.opts.sandbox, signal };
      const results: ToolResultPart[] = [];

      for (const call of pending) {
        const tool = toolMap.get(call.name);
        if (!tool) {
          results.push(errorResult(call, `unknown tool: ${call.name}`));
          continue;
        }

        const decision = await this.permissions.check(tool, call.input);
        if (!decision.allow) {
          yield { type: "tool_denied", call, reason: decision.reason };
          results.push(errorResult(call, `Denied: ${decision.reason ?? "permission"}`));
          continue;
        }

        yield { type: "tool_executing", call };
        try {
          const r = await tool.run(call.input, ctx);
          const res: ToolResultPart = {
            type: "tool_result",
            id: call.id,
            name: call.name,
            output: r.output,
            isError: r.isError,
          };
          results.push(res);
          yield { type: "tool_result", result: res };
        } catch (err) {
          const res = errorResult(call, String(err));
          results.push(res);
          yield { type: "tool_result", result: res };
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
