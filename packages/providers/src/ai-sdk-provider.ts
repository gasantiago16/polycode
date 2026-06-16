import {
  streamText,
  tool as aiTool,
  jsonSchema,
  type ModelMessage,
  type LanguageModel,
  type ToolSet,
} from "ai";
import type {
  Provider,
  GenerateRequest,
  CanonicalEvent,
  Capabilities,
  ToolSpec,
  ToolResultPart,
  StopReason,
} from "@polycode/core";

export interface AiSdkProviderOptions {
  id: string;
  modelId: string;
  model: LanguageModel;
  capabilities: Capabilities;
}

/**
 * Wraps the Vercel AI SDK as a canonical Provider. This is the only place that
 * knows about AI SDK shapes — swap it for a hand-rolled adapter per provider if
 * you ever need provider-specific features the SDK doesn't expose.
 *
 * NOTE: field names below track AI SDK v5 `fullStream` parts. If you bump the
 * SDK, re-verify `text-delta`/`reasoning-delta`/`tool-call`/`finish` shapes.
 */
export function createAiSdkProvider(opts: AiSdkProviderOptions): Provider {
  return {
    id: opts.id,
    model: opts.modelId,
    capabilities: () => opts.capabilities,

    async *stream(req: GenerateRequest): AsyncIterable<CanonicalEvent> {
      const result = streamText({
        model: opts.model,
        system: req.system,
        messages: toModelMessages(req),
        tools: toAiTools(req.tools), // definitions only — no `execute`; we run them
        abortSignal: req.signal,
        maxOutputTokens: req.maxOutputTokens,
        providerOptions: reasoningOptions(opts.id, req.reasoningEffort),
      });

      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-delta":
            yield { type: "text_delta", text: (part as any).text };
            break;
          case "reasoning-delta":
            yield { type: "reasoning_delta", text: (part as any).text };
            break;
          case "tool-call":
            yield {
              type: "tool_call",
              call: {
                type: "tool_call",
                id: (part as any).toolCallId,
                name: (part as any).toolName,
                input: (part as any).input,
              },
            };
            break;
          case "error":
            yield { type: "error", error: String((part as any).error) };
            return;
          case "finish": {
            const u = (part as any).totalUsage;
            yield {
              type: "stop",
              reason: mapFinish((part as any).finishReason),
              usage: u
                ? { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0 }
                : undefined,
            };
            break;
          }
          default:
            // text-start/end, reasoning-start/end, tool-input-delta, etc. — ignore
            break;
        }
      }
    },
  };
}

function toAiTools(tools: ToolSpec[]): ToolSet {
  const out: ToolSet = {};
  for (const t of tools) {
    out[t.name] = aiTool({
      description: t.description,
      inputSchema: jsonSchema(t.parameters as any),
      // intentionally no `execute`: the Agent gates + runs tools itself
    });
  }
  return out;
}

function toModelMessages(req: GenerateRequest): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of req.messages) {
    if (m.role === "user") {
      out.push({
        role: "user",
        content: m.content
          .filter((p) => p.type === "text")
          .map((p) => ({ type: "text", text: (p as any).text })),
      });
    } else if (m.role === "assistant") {
      const content: any[] = [];
      for (const p of m.content) {
        if (p.type === "text") content.push({ type: "text", text: p.text });
        else if (p.type === "tool_call")
          content.push({ type: "tool-call", toolCallId: p.id, toolName: p.name, input: p.input });
      }
      out.push({ role: "assistant", content });
    } else if (m.role === "tool") {
      out.push({
        role: "tool",
        content: m.content
          .filter((p): p is ToolResultPart => p.type === "tool_result")
          .map((r) => ({
            type: "tool-result",
            toolCallId: r.id,
            toolName: r.name,
            // AI SDK v5 typed tool output
            output: { type: "text", value: r.output },
          })),
      });
    } else if (m.role === "system") {
      out.push({
        role: "system",
        content: m.content.map((p) => (p as any).text ?? "").join(""),
      });
    }
  }
  return out;
}

function mapFinish(reason: string): StopReason {
  switch (reason) {
    case "tool-calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content-filter":
      return "refusal";
    case "stop":
      return "end_turn";
    default:
      return "end_turn";
  }
}

/** Map our generic reasoning knob to each provider's native param. */
function reasoningOptions(
  id: string,
  effort?: "low" | "medium" | "high",
): Record<string, any> | undefined {
  if (!effort) return undefined;
  if (id === "openai") return { openai: { reasoningEffort: effort } };
  if (id === "xai") return { xai: { reasoningEffort: effort } };
  if (id === "google") return { google: { thinkingConfig: { includeThoughts: true } } };
  return undefined;
}
