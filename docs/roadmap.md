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

## Future work

### Phase 2 — Tools parity

- ripgrep-backed `grep` (case-insensitive, glob/type filters, context lines) with a graceful
  JS-walk fallback when `rg` is not on PATH.
- `edit` uniqueness guard — error when `old_string` is ambiguous unless `replace_all` — plus a
  multi-edit / batch variant.
- An `ls` tool (list a directory), and concurrent execution of `parallelSafe` read-only tools.

### Phase 3 — TUI parity

- Edit results rendered as diffs (`+`/`-`); multi-line, expandable tool output.
- Sticky permissions — "always allow this tool for the session" — instead of re-prompting.
- Token + context-window meter in the status bar.

### Phase 4 — Persistence & observability

- Session transcripts written to `.polycode/sessions/`, plus a `--resume` flag.
- This is also the **logs** surface: polycode currently writes none.

### Later

- Context compaction when history approaches the model's window (summarize-and-drop).
- Parallel-safe tool batching wired into the loop.
- Agentic key provisioning — the Settings `a` hook is currently a stub (MCP/tool flow TODO).

## Status at a glance

| Phase | Scope | State |
|---|---|---|
| 1 | Project context · loop hardening · numbered `read` | ✅ done (2026-06-23) |
| 2 | Tools parity (grep/edit/ls/parallel) | planned |
| 3 | TUI parity (diffs, sticky perms, token meter) | planned |
| 4 | Persistence & logs (transcripts, `--resume`) | planned |
