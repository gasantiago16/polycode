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
- ✅ Providers via AI SDK adapter: OpenAI + Gemini + xAI + Muse + NVIDIA NIM + Qwen + Anthropic (catalog, 2026-08-31).
- ✅ Smart routing: heuristic **and** model-driven classifiers (`--routing model`),
  with heuristic fallback; per-turn auto-routing in the TUI (`/route`).
- ✅ Tools: read/write/edit/bash/grep/glob with permission classes.
- ✅ Claude-Code-style Ink TUI: welcome banner, `⏺`/`⎿` tool rendering, markdown assistant
  output, bordered composer, spinner (elapsed + esc-to-interrupt), status bar.
- ✅ Settings screen for keys: masked paste · import-from-env · open key page · validate
  with a test call · agentic hook (stub; MCP flow TODO).
- ✅ **Secure key flow**: masked first-run setup → OS keychain (DPAPI-backed on Windows),
  `0600` file fallback. Keychain backend **verified active**.
- ✅ Tool-execution sandbox: `local` (host) + `docker` (isolated shell) backends; tools
  run only through the `Sandbox` contract; `--sandbox docker` **fails closed**.
- ✅ Hosted server: `POST /chat` (SSE) + `/health` (takes a `Sandbox`).
- ✅ Live smoke harness (`pnpm smoke <provider:model>`).
- ✅ Build & distribute: `tsup` bundles the CLI to a single `poly` bin (internal packages
  bundled, third-party external); private `@polycode/cli` (not npmjs); multi-stage server `Dockerfile`.
- ✅ Docs in Markdown + generated HTML (`docs/`, `docs/html/`).
- ✅ **Live end-to-end provider call verified** (2026-06-23) — `pnpm smoke xai:grok-4.3`
  round-trip green (tool call → numbered result → text).
- ✅ **Phase 1 — Brains + Loop** (2026-06-23) — project-context injection (`gatherContext`),
  loop hardening (`maxSteps` cap + transient-error retry), and a `cat -n` numbered `read` with
  `offset`/`limit`. See the [Claude-Code Parity Roadmap](roadmap.md) for what's next.

## Key decisions (and why)

1. **TypeScript + Ink + Vercel AI SDK** — closest to the Claude Code look; best multi-model
   SDK; ship via git + Docker, not npmjs.
2. **Unifying SDK behind our own `Provider` interface** — fast to build, not locked in; can
   drop a hand-rolled adapter per provider where the SDK flattens something we need.
3. **Anthropic is first-class** (reversed 2026-08-31) — `@ai-sdk/anthropic` plus
   OpenAI-compat rows for Muse / NVIDIA NIM / Qwen. Contributor / training-tier
   model ids are refused unless `allowTrainingTiers: true`.
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
- **TUI flicker.** Streaming text is paint-buffered (~10 Hz). Open markdown fences
  render without a round border so the live region does not reflow every token.
  Frame-count tests live in `packages/tui/src/app.ux.test.ts`. Still run the TUI once
  in a real Windows Terminal (120×40) before merging TUI-touching PRs.

## Repo

- `gasantiago16/polycode` (**private**), default branch `main`.
- Commits: baseline scaffold → secure key setup + smoke harness → docs.

## Next steps (suggested order)

> The Claude-Code parity plan now lives in the [Roadmap](roadmap.md): Phase 1 (brains + loop)
> is done; Phases 2–4 (tools / TUI / persistence) are queued.

1. **Run the live smoke test** — paste a key via the setup screen, then
   `corepack pnpm smoke <provider:model>`; confirm `PASS`. Also `route-check` the classifier.
   `--sandbox docker` fails closed if Docker is not running.
2. **Build/push the Docker image** — the `Dockerfile` exists but hasn't been image-built from CI yet.
3. **Parallel-safe tool batching** — run `parallelSafe` tools concurrently in the loop.
4. **Tune the classifier** — few-shot examples / structured output; cache across sessions.
5. **Wire agentic key provisioning** — the Settings `a` hook is a stub; connect a real MCP/tool flow.

## Quick command reference

```powershell
corepack pnpm -C "C:\Users\Gabriel Santiago\polycode" install
corepack pnpm -C "C:\Users\Gabriel Santiago\polycode" dev          # TUI (first run = key setup)
corepack pnpm -C "C:\Users\Gabriel Santiago\polycode" smoke google:gemini-2.5-flash
corepack pnpm -C "C:\Users\Gabriel Santiago\polycode" typecheck
corepack pnpm -C "C:\Users\Gabriel Santiago\polycode" docs
```
