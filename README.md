# polycode

A terminal coding agent with a Claude Code–style interface, built **provider-agnostic**:
the same agent engine drives **OpenAI**, **Google Gemini**, **xAI (Grok)**, **Meta Muse**,
**NVIDIA NIM**, **Qwen**, and **Anthropic** — with runtime model switching, smart routing,
and an optional hosted server mode.

> Status: **public, experimental local alpha (`0.1.0-alpha`)**. The local agent loop, tools,
> permissions, TUI, routing, and session persistence work end-to-end and have an automated
> regression suite. Provider compatibility still needs live verification. Hosted mode is an
> unsafe scaffold and must not be exposed to untrusted networks.

**Clone without a key:** `pnpm install && pnpm test && pnpm typecheck` (CI also builds on Node 20/22, Ubuntu / Windows / macOS). Live chat needs a gitignored `.env` or OS keychain.

## Supported baseline

- Node.js 20 and 22 on Windows, macOS, and Linux (enforced in CI).
- Local mode is the supported interactive path for this alpha.
- Docker mode fails closed when Docker is unavailable; it never silently executes on the host.
- Hosted mode has no authentication or tenant isolation and runs tools with broad permissions.
  Treat it as local development scaffolding only.

## Documentation

Full docs live in [`docs/`](docs/index.md) (Markdown) with a generated HTML copy in
[`docs/html/`](docs/html/index.html). Regenerate the HTML with `corepack pnpm docs`.

- [Overview](docs/index.md) · [Architecture](docs/architecture.md) · [Getting Started](docs/getting-started.md) · [Configuration](docs/configuration.md)
- [Providers & Models](docs/providers.md) · [Security & Keys](docs/security.md) · [CLI Reference](docs/cli.md) · [Packages](docs/packages.md)
- **[Continuity / Handoff](docs/continuity.md)** — current state, decisions, gotchas, next steps

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
pnpm test
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

1. **Model IDs** in `polycode.config.json` against current OpenAI / Google / xAI docs.
   Defaults are candidates, not a guaranteed compatibility matrix until live verification lands.
2. **AI SDK version**: `pnpm add ai @ai-sdk/openai @ai-sdk/google @ai-sdk/xai` to pin current.
   The adapter's `fullStream` part field names (`text-delta`, `reasoning-delta`, `tool-call`,
   `finish`) track AI SDK v5 — re-verify if you bump majors.
3. **Capability numbers** in `providers/src/index.ts` (context window / max output) are estimates.

## Deploy

See [docs/deploy.md](docs/deploy.md) for the full guide.

- **Bundle**: `corepack pnpm build` → single `packages/cli/dist/index.js` (`poly` bin) via tsup.
- **Local CLI**: run the bundle, or `pnpm -C packages/cli link --global` → `poly`.
- **Not published to npmjs.** `@polycode/cli` is `private`. Distribute via git + Docker.
- **Hosted service**: `docker build -t polycode-server .` then `docker run -p 8787:8787 -e POLYCODE_AUTH_TOKEN=... -e OPENAI_API_KEY=... polycode-server`.
