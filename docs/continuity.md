# Continuity / Handoff

A single place to pick the project back up — current state, decisions, gotchas, and what's next.

## What polycode is

A Codex/Claude-Code-style terminal coding agent, **provider-agnostic** across OpenAI,
Google Gemini, and xAI (Grok). TypeScript pnpm monorepo. Goals: runtime model switching,
smart routing, secure local key setup, and an optional hosted server — all on one
provider-blind agent engine.

## Current status (as of the latest commit)

- ✅ Monorepo scaffolded; **typechecks clean**.
- ✅ Canonical core (types, permission engine, agent loop).
- ✅ Providers via AI SDK adapter: OpenAI + Gemini + xAI.
- ✅ Smart routing: heuristic **and** model-driven classifiers (`--routing model`),
  with heuristic fallback; per-turn auto-routing in the TUI (`/route`).
- ✅ Tools: read/write/edit/bash/grep/glob with permission classes.
- ✅ Ink TUI: streaming render, permission prompt, slash commands.
- ✅ **Secure key flow**: masked first-run setup → OS keychain (DPAPI-backed on Windows),
  `0600` file fallback. Keychain backend **verified active**.
- ✅ Hosted server: `POST /chat` (SSE) + `/health`.
- ✅ Live smoke harness (`pnpm smoke <provider:model>`).
- ✅ Docs in Markdown + generated HTML (`docs/`, `docs/html/`).
- ⏳ **Live end-to-end provider call not yet run** — needs a real key pasted via the setup
  screen, then `pnpm smoke`.

## Key decisions (and why)

1. **TypeScript + Ink + Vercel AI SDK** — closest to the Claude Code look; best multi-model
   SDK; npm distribution.
2. **Unifying SDK behind our own `Provider` interface** — fast to build, not locked in; can
   drop a hand-rolled adapter per provider where the SDK flattens something we need.
3. **Anthropic intentionally excluded** — providers are OpenAI / Gemini / xAI only. Do not
   add `@ai-sdk/anthropic` or `claude-*` models.
4. **Provider-blind core** — loop/tools/permissions/UI see only canonical types; the seam
   that makes multi-model work.
5. **Engine reused local + hosted** — `core` is transport-agnostic; TUI imports it, server
   wraps it.
6. **Keys in the OS keychain** — secure-by-default; masked input; never logged/committed.

## Gotchas (read before you debug)

- **pnpm not on PATH; Corepack can't write shims without admin.** Use
  `corepack pnpm -C "<repo>" <cmd>`. `corepack enable` from an admin shell fixes it.
- **Model IDs churn.** Confirmed June 2026: `gpt-5.5`, `gemini-2.5-flash`/`-pro`,
  `grok-4.3`. `grok-4` is retired; `gpt-5` is superseded. See [Providers](providers.md).
- **AI SDK v5 stream shapes.** The adapter switches on `fullStream` part types
  (`text-delta`, `reasoning-delta`, `tool-call`, `finish`). Re-verify on a major SDK bump.
- **Capability numbers are estimates** in `packages/providers/src/index.ts`.
- **Dev resolution.** Packages point `main`/`exports` at `src/index.ts` for `tsx`. For
  publishing, switch to `dist` and run `build`.

## Repo

- `gasantiago16/polycode` (**private**), default branch `main`.
- Commits: baseline scaffold → secure key setup + smoke harness → docs.

## Next steps (suggested order)

1. **Run the live smoke test** — paste a key via the setup screen, then
   `corepack pnpm smoke <provider:model>`; confirm `PASS`. Also `route-check` the classifier.
2. **Tool-execution sandbox** for hosted mode (container / microVM) + auth + per-session
   permission policy before exposing the server.
3. **Build & distribute** — wire `tsup`, flip package `exports` to `dist`, publish `@polycode/cli`
   (or ship a single binary), add a Docker image for the server.
4. **Parallel-safe tool batching** — run `parallelSafe` tools concurrently in the loop.
5. **Tune the classifier** — few-shot examples / structured output; cache across sessions.

## Quick command reference

```powershell
corepack pnpm -C "C:\Users\Gabriel Santiago\polycode" install
corepack pnpm -C "C:\Users\Gabriel Santiago\polycode" dev          # TUI (first run = key setup)
corepack pnpm -C "C:\Users\Gabriel Santiago\polycode" smoke google:gemini-2.5-flash
corepack pnpm -C "C:\Users\Gabriel Santiago\polycode" typecheck
corepack pnpm -C "C:\Users\Gabriel Santiago\polycode" docs
```
