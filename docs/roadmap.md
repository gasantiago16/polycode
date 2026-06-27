# Claude-Code Parity Roadmap

polycode aims to be a Claude-Code-class terminal coding agent that is **provider-agnostic**
across OpenAI, Google Gemini, and xAI (Grok). The engine was structurally sound early on
(provider-blind loop, clean sandbox/permission seams) but *thin* — this roadmap tracks the
work to close the gap to Claude Code, phase by phase. Every item is provider-agnostic by
construction: nothing in the loop, tools, or context layer is vendor-specific.

## Phase 1 — Brains + Loop ✅ (2026-06-23)

The agent was starting blind and looping without guardrails. Phase 1 gave it situational
awareness and a resilient loop.

- **Project-context injection** — new `gatherContext()` in
  [`packages/core/src/context.ts`](packages.md) builds, every session, an `<environment>`
  block (cwd, platform, date, git branch), a short `<git_status>`, a `<directory>` snapshot,
  and inlines project conventions when present (`CLAUDE.md` / `AGENTS.md` / `POLYCODE.md` /
  `.cursorrules` / `.github/copilot-instructions.md`, first match wins). It runs entirely
  through the `Sandbox` contract, so it behaves identically on the local and docker backends.
  The CLI appends it to the system prompt before launching the TUI.
- **Loop hardening** (`packages/core/src/agent.ts`) — a `maxSteps` cap (default 50) prevents
  runaway tool loops; transient provider errors (rate limits, dropped connections, 5xx) retry
  with exponential backoff + jitter, but **only before any output has streamed this turn**, so
  text and tool calls are never duplicated. User interrupts (`esc`) still propagate immediately.
- **`read` upgrade** (`packages/tools/src/index.ts`) — `cat -n` numbered output with
  `offset` / `limit` and a continuation hint, so the model can reference and edit by line.

Verification: `pnpm typecheck` clean; live `pnpm smoke xai:grok-4.3` round-trip green
(tool call → numbered result → text).

## Phase 2 — Tools parity ✅ (2026-06-24)

The tools were capable-but-thin; Phase 2 brought them to Claude-Code standard.

- **`grep`** — ripgrep fast-path invoked through a **no-shell `execFile`** (argv passed straight
  to the binary, so a model-supplied pattern/glob/path can't inject a command), with a much
  stronger JS-walk fallback supporting `ignore_case`, a `glob` filter, `context` lines, and
  `max_results`. When `rg` is not on PATH the JS path runs transparently.
- **`edit` uniqueness guard** — errors with a match count when `old_string` is not unique
  (unless `replace_all`), so an ambiguous edit can't silently hit the wrong spot. A latent
  `$`-substitution bug in single-replace was fixed by switching to a literal replace.
- **`multi_edit`** (new) — applies a sequence of edits to one file **atomically**; if any edit
  fails, nothing is written.
- **`ls`** (new) — lists files and directories directly under a path.
- **Glob fix** — `**/*.ts` previously required a path separator, so top-level files never
  matched; the matcher was rewritten with a proper `**/` globstar and `?` support (benefits both
  `grep --glob` and the `glob` tool).
- **Parallel execution** (`packages/core/src/agent.ts`) — consecutive read-only (safe) tool
  calls now run concurrently via `Promise.all`, with results kept in call order; mutating and
  dangerous tools still run sequentially so permission prompts never overlap.

Verification: `pnpm typecheck` clean; behavior covered by a throwaway harness (glob /
ignore-case / context grep, the uniqueness guard, atomic `multi_edit`, `ls`, parallel timing)
plus a live `pnpm smoke xai:grok-4.3` round-trip. Note: ripgrep is not installed on the dev box,
so the JS grep path is the live-tested one; the `rg` fast-path is typecheck-verified and engages
automatically when `rg` is present.

## Phase 3 — TUI parity ✅ (2026-06-24)

Made the terminal UI feel like Claude Code rather than a raw event log.

- **Edit/write diffs** — `edit`, `multi_edit`, and `write` emit a colored unified diff (LCS
  with collapsed context) through a UI-only `display` channel on `ToolRunResult`. The diff is
  shown under `⎿` (green `+` / red `-` / dim context); the model-facing tool output stays terse,
  so diffs never bloat the context window.
- **Multi-line tool output** — results render several indented lines with a `… +N lines` hint
  instead of a single truncated line.
- **Sticky permissions** — the prompt is three-way: allow once (`y`), allow for the session
  (`a`), or deny (`n`). The engine remembers session grants and stops re-prompting for that tool.
- **Token / context meter** — the status bar shows `ctx <live>/<window>` and a session token
  total, accumulated from each turn's usage and updated on model switch / route.
- **No-flicker rendering** — finished turns are committed to an Ink `<Static>` region so they
  print once and never repaint; only the in-progress turn and the composer redraw during
  streaming. Tool-call headers read `Read(path)` instead of raw JSON.

## Phase 4 — Persistence & observability ✅ (2026-06-24)

polycode's first on-disk surface — the conversation is now saved and resumable.

- **Session transcripts** — after every turn the conversation (canonical messages) is written to
  `<cwd>/.polycode/sessions/<id>.json` (id is timestamped + random, so files sort chronologically).
  `.polycode/` is gitignored and ignored by the sandbox walk, so transcripts never pollute
  search/context. This is also the **log/observability** surface that previously didn't exist.
- **Resume** — `--continue` reopens the most recent session in the project; `--resume <id>` reopens
  a specific one. The saved messages seed the agent (`AgentOptions.initialMessages`) and are
  rebuilt into the on-screen history, so a resumed session both *remembers* and *shows* the prior
  conversation. A fresh system prompt (current project context) is regenerated on resume.
- **`--sessions`** — lists saved transcripts (id · model · title) and exits.
- **Layering** — the `SessionStore` (node:fs) lives in the CLI; the TUI stays I/O-free and just
  receives `initialMessages` + an `onPersist` callback. Persistence is best-effort — a write error
  never crashes a turn.

Verification: `pnpm typecheck` clean; harness round-trips a real agent conversation (save → load →
seed a fresh agent → continue), and `--sessions` + live smoke pass.

## Future work

Phases 1–4 were "basic parity." The forward plan to **Claude-Code-class** — MCP, context
compaction, subagents, skills/commands, web tools, hooks, checkpoints, server hardening — is laid
out, sequenced, and grounded in a code audit + feature diff in the
[**Build-out Plan**](buildout-plan.md). Start there.

### Highlights from the plan

- **Phase 5.0** — pre-flight ground truth (verify model IDs, pin AI SDK, fill real context windows).
- **Phase 5.1** — MCP client (force multiplier; cheap via the AI SDK's `experimental_createMCPClient`).
- **Phase 5.2** — context compaction (correctness: history is currently unbounded).
- **Phase 5.3 / 5.4 / 5.5** — subagents, skills/commands, web tools + todo.
- Agentic key provisioning — the Settings `a` hook is still a stub (MCP/tool flow TODO).

## Status at a glance

| Phase | Scope | State |
|---|---|---|
| 1 | Project context · loop hardening · numbered `read` | ✅ done (2026-06-23) |
| 2 | Tools parity (grep/edit/ls/parallel) | ✅ done (2026-06-24) |
| 3 | TUI parity (diffs, sticky perms, token meter, no-flicker) | ✅ done (2026-06-24) |
| 4 | Persistence & logs (transcripts, `--continue`/`--resume`/`--sessions`) | ✅ done (2026-06-24) |
