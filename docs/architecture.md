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

## Agent graphs

`@polycode/graph` is a small state machine **on top of** this loop, not a second agent
framework. Nodes are depth-1 child agents; edges are fixed or `if.field` conditionals;
each super-step is checkpointed under `.polycode/graph-runs/`. See [graph.md](graph.md).
It is intentionally **not** LangGraph — no LangChain messages, no extra model stack.

Before each `provider.stream`, the loop estimates tokens (`chars/4`) and, at 85% of
`capabilities().contextWindow`, runs two-pass compaction: elide old `tool_result` bodies,
then (if still over) summarize older turns with the cheap-tier provider into one
`<compacted-history>` message. The original task and the last N turns stay verbatim.
A failed shrink sticky-suppresses auto-compact until a successful one. `/compact [focus]`
and `/context` are the manual surface. Compaction is provider-local — it does not call
xAI's Compaction API — so Muse/OpenAI/Gemini get the same behavior.

`web_fetch` and `web_search` run in the **host** process (SSRF-blocked: no file://,
localhost, RFC1918, link-local). Search uses `TAVILY_API_KEY` or `BRAVE_API_KEY`.
Docker bash stays `--network none`. Skills load from `.polycode/skills`,
`~/.config/polycode/skills`, then bundled (`forme`, `matsumura-style`, `deep-research`).
`/deep-research` fans out three `researcher` children (web tools, no `task`) then
writes `docs/research/<slug>.md`. Mutating tools snapshot the prior file; `/rewind`
restores it and truncates history. Permission allow/deny patterns run before the
mode prompt. `@file.ts` mentions expand through the sandbox. MCP servers in
`.polycode/mcp.json` become `mcp__<server>__<tool>` ToolSpecs and use the same
permission engine (default `dangerous`). Connect failures are skipped. MCP
JSON schemas are **deferred** (`mcp_search` or first call hydrates; `/context`
shows the schema budget). The idle TUI status line is a `$token` template
(`/statusline`, `statusLine` in config).
User messages may include `ImagePart`s (`/image path` or `@shot.png`). The AI SDK adapter
sends them as vision `image` parts. Compaction estimates ~800 tokens each and clones
them intact in kept turns.

Curated project memory (`.polycode/memory.md`) is injected as `<memory>` by
`gatherContext` and updated via the `memory` tool or `/memory add`.

`task` may set `isolation: "worktree"` for a detached git worktree under
`.polycode/worktrees/` (not merged back). `/worktree list|apply|remove` is the
manual surface; apply copies changed + untracked files onto the parent tree.
`/deep-research` and `/workflow <name>` run a budgeted TypeScript workflow
(optional parallel panel, sequential `steps`, synthesize) from bundled JSON or
`.polycode/workflows/*.json`. Lifecycle hooks (`PreToolUse`, `PostToolUse`,
`UserPromptSubmit`, `SessionStart`/`End`, `SubagentStart`/`Stop`, `Stop`) run
through the sandbox; a nonzero `PreToolUse` or `UserPromptSubmit` denies.

Child loops (`task`, `/explore`, `/review`) construct a fresh `Agent` with the same
sandbox and permission engine, a curated toolset that **excludes `task`** (depth 1),
and their own compaction. Only the child's final text returns to the parent. Review
children may write only under `.polycode/reviews/`.

## Local vs hosted — one engine

`@polycode/core` is transport-agnostic. The Ink TUI imports it directly for local use; the
`@polycode/server` package wraps the identical engine behind `POST /chat` (SSE) with bearer
auth, rate limits, a no-prompt permission policy, and an IDE bridge (`/ide/context`
prepended onto `/chat`). Plugin bundles under `.polycode/plugins/` contribute skills,
agents, hooks, MCP, and LSP configs. Runtime
`/model` switching and router-driven selection both work by swapping the `Provider` the loop
holds — no other change.
