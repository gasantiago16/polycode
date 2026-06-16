# polycode

A terminal coding agent with a Claude Code–style interface, built **provider-agnostic**:
the same agent engine drives **OpenAI**, **Google Gemini**, and **xAI (Grok)** — with
runtime model switching, smart routing, and an optional hosted server mode.

> Status: **scaffold**. The architecture, types, loop, providers, tools, TUI, and server
> are wired end-to-end. Model IDs and a couple of SDK field names are flagged to confirm
> before first real run (see notes below).

## Architecture

```
TUI (Ink)  ── input · streaming render · permission prompt · /slash commands
   │
Agent loop (core)  ── provider-blind: stream → tool calls → permission gate →
   │                  execute → feed results back → repeat until end_turn
Provider (core interface)  ── stream(req) → AsyncIterable<CanonicalEvent>
   │
AI SDK adapter (providers)  ── canonical ⇄ OpenAI / Gemini / xAI
Router (router)  ── classify turn → pick model tier (cheap/strong/long)
Tools (tools)  ── read · write · edit · bash · grep · glob (+ permission class)
Server (server)  ── same engine over HTTP+SSE for hosted mode
```

The agent loop, tools, permission engine, and UI only ever see **canonical** types
(`CanonicalMessage`, `CanonicalEvent`, `ToolSpec`, `Provider`). Every provider quirk —
message shapes, tool-call formats, stop reasons, reasoning channels — is normalized inside
the AI SDK adapter and never leaks upward. That seam is what makes "multiple API models" work.

## Packages

| Package | Role |
|---|---|
| `@polycode/core` | Canonical types, permission engine, agent loop |
| `@polycode/providers` | AI SDK adapter + OpenAI/Gemini/xAI factory |
| `@polycode/router` | Smart routing (tier classifier) |
| `@polycode/tools` | File + shell tools with permission classes |
| `@polycode/tui` | Ink terminal UI |
| `@polycode/server` | HTTP+SSE hosted-mode wrapper |
| `@polycode/cli` | Entry point (local TUI or `--serve`) |

## Quick start

```bash
pnpm install
cp .env.example .env                       # add OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / XAI_API_KEY
cp polycode.config.example.json polycode.config.json
pnpm dev                                    # launch the TUI (local mode)
pnpm dev -- --model openai:gpt-5            # force a model
pnpm dev -- --tier cheap                    # force a routing tier
pnpm serve -- --port 8787                   # hosted mode (POST /chat, SSE)
pnpm typecheck
```

In the TUI: `/model <provider:model>` · `/mode <plan|ask|acceptEdits|yolo>` · `/help` · `/exit`.

## Smart routing

`@polycode/router` classifies each turn → a tier from your config:
- **cheap** → `google:gemini-2.5-flash` (simple edits, lookups)
- **strong** → `openai:gpt-5` (reasoning, multi-file, planning)
- **long** → `google:gemini-2.5-pro` (whole-repo context)

`xai:grok-*` can be slotted into any tier. Swap the heuristic in `router/src/index.ts`
for a model-driven classifier later.

## Permission modes (Claude Code–style)

- `plan` — read-only; refuses any mutating/dangerous tool
- `ask` — auto-allow safe tools; prompt for mutating/dangerous
- `acceptEdits` — auto-allow safe + file edits; prompt for dangerous (e.g. `bash`)
- `yolo` — allow everything (sandboxes / CI only)

## Before first real run — confirm these

1. **Model IDs** in `polycode.config.json` (`gpt-5`, `gemini-2.5-*`, `grok-*`) against current
   OpenAI / Google / xAI docs — they're placeholders.
2. **AI SDK version**: `pnpm add ai @ai-sdk/openai @ai-sdk/google @ai-sdk/xai` to pin current.
   The adapter's `fullStream` part field names (`text-delta`, `reasoning-delta`, `tool-call`,
   `finish`) track AI SDK v5 — re-verify if you bump majors.
3. **Capability numbers** in `providers/src/index.ts` (context window / max output) are estimates.

## Deploy

- **Local CLI**: `pnpm build` → publish `@polycode/cli` to npm → `npx`/global install (native, like Claude Code).
- **Hosted service**: containerize the `server` package (`pnpm serve`); add auth + a sandbox for tool execution.
- **Tool sandbox**: for untrusted use, run `bash`/`write`/`edit` inside a container rather than the host cwd.
