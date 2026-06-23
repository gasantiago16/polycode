# polycode documentation

A terminal coding agent with a Claude Code–style interface, built **provider-agnostic**:
one agent engine drives **OpenAI**, **Google Gemini**, and **xAI (Grok)** — with runtime
model switching, smart routing, a secure first-run key setup, and an optional hosted
server mode.

> **Status:** working scaffold. Architecture, types, agent loop, providers, tools, secure
> key store, Ink TUI, and an HTTP+SSE server are wired end-to-end and typecheck clean.
> A live end-to-end provider call (the "smoke test") is the next verification step.

## Contents

- [Architecture](architecture.md) — layers, the canonical model, and the agent loop
- [Getting Started](getting-started.md) — prerequisites, install, first run, smoke test
- [Configuration](configuration.md) — config file, tiers, env precedence
- [Providers & Models](providers.md) — OpenAI/Gemini/xAI, current model IDs, adding a provider
- [Security & Keys](security.md) — secure key store, permission modes, sandboxing
- [CLI Reference](cli.md) — flags and slash commands
- [Packages](packages.md) — per-package reference
- [Continuity / Handoff](continuity.md) — current state, decisions, gotchas, next steps

## One-paragraph summary

`polycode` is a pnpm monorepo (TypeScript). The **agent loop, tools, permission engine,
and UI only ever see canonical types** — every provider quirk (message shapes, tool-call
formats, stop reasons, reasoning channels) is normalized inside a thin adapter over the
Vercel AI SDK. That seam is what makes "multiple API models" tractable. Keys are captured
on first run via a masked prompt and stored in the OS keychain. The same engine runs
locally in an Ink TUI or behind an HTTP+SSE server.

Repo: `gasantiago16/polycode` (private).
