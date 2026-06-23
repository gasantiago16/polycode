# Architecture

## Layers

```
TUI (Ink)        input · streaming render · masked key setup · permission prompt · /slash
   │
Agent loop       provider-blind: stream → tool calls → permission gate → execute →
(core)           feed results back → repeat until end_turn
   │
Provider         interface: stream(req) → AsyncIterable<CanonicalEvent>
(core interface)
   │
AI SDK adapter   canonical ⇄ OpenAI / Gemini / xAI  (the only AI-SDK-aware code)
(providers)
   │
Router           classify a turn → pick a model tier (cheap / strong / long)
Tools            read · write · edit · bash · grep · glob  (+ permission class)
Secrets          env/.env → OS keychain → 0600 file
Server           the same engine over HTTP+SSE (hosted mode)
```

## The canonical model (why multi-model works)

The agent loop, tools, permission engine, and UI **never** see a provider-specific shape.
Everything is normalized to canonical types in `@polycode/core`:

- `CanonicalMessage` — `role` + `ContentPart[]` (`text` | `reasoning` | `tool_call` | `tool_result`)
- `CanonicalEvent` — the streaming union: `text_delta` | `reasoning_delta` | `tool_call` | `stop` | `error`
- `ToolSpec` — `name`, `description`, JSON-Schema `parameters`, `permission` class, `parallelSafe`, `run()`
- `Provider` — `id`, `model`, `capabilities()`, `stream(req)`, optional `countTokens()`
- `Capabilities` — context window, max output, tool/reasoning/caching/vision/parallel flags

A provider adapter translates **both directions**: canonical request → provider call, and
provider stream/messages → canonical events/messages. Add a provider by writing one adapter;
nothing in the loop, tools, or UI changes.

## Provider differences the adapter hides

| Concern | OpenAI | Gemini | xAI |
|---|---|---|---|
| Tool call args | JSON **string** | object | JSON string |
| Tool result shape | `tool` role msg | `functionResponse` | `tool` role msg |
| Stop reason | `stop`/`tool_calls`/`length` | `STOP`/`MAX_TOKENS` | `stop`/`tool_calls` |
| Reasoning | reasoning effort + summary | thinking / budget | reasoning effort |
| Caching | automatic | explicit context cache | automatic |

All of these collapse into the canonical `CanonicalEvent` / `Capabilities` surface.

## The agent loop

One `provider.stream()` call == one model turn. The loop deliberately does **not** let the
provider auto-execute tools — it collects tool calls, runs them through the permission
engine, executes (sequentially for now so prompts don't overlap), appends results, and
loops until `stop_reason` is `end_turn`.

```
pushUser(text)
└─ run():
   loop:
     stream a turn ──▶ emit text_delta / reasoning_delta / tool_call / stop
     if stop != tool_use: emit turn_complete; return
     for each tool_call:
        permission.check() ──▶ allow? execute : deny
        emit tool_executing / tool_result / tool_denied
     append tool results as a tool message
```

This keeps gating, rendering, and (later) parallel scheduling under our control rather than
the SDK's.

## Local vs hosted — one engine

`@polycode/core` is transport-agnostic. The Ink TUI imports it directly for local use; the
`@polycode/server` package wraps the identical engine behind `POST /chat` (SSE). Runtime
`/model` switching and router-driven selection both work by swapping the `Provider` the loop
holds — no other change.
