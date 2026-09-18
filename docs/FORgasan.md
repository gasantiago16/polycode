# FORgasan — polycode

You asked for a handle on what we built. Here it is, without the brochure voice.

polycode is a **terminal coding agent**: you type, a model thinks, tools run on your files, you get an answer. The twist is we refused to marry one vendor. The same loop drives Grok, Gemini, OpenAI, Muse, NIM, Qwen, and Anthropic. Everything above the adapter speaks one language. That language is ours.

This is the story of a Claude-Code-shaped TUI sitting on a provider-blind engine, plus the scars we picked up getting multi-agent, security, and a LangGraph-shaped graph *without* importing LangGraph.

---

## What this project is (in one breath)

A coding assistant that lives in the terminal, not a website. You run `corepack pnpm dev` in a repo. It reads the project, calls tools (`read`, `grep`, `glob`, `edit`, `bash`, …), asks before dangerous work, and can spawn **one layer** of child agents. Sessions persist as JSON. Keys sit in the OS keychain. Hosted HTTP is a scaffold — local TUI is the real product.

**Status:** experimental local alpha `0.1.0-alpha`. Public repo `gasantiago16/polycode`. Node 20/22. ~307 unit tests at the time of writing.

It is **not** LangChain. It is **not** LangGraph. It is **not** Grok Build cloud. Company isolation is BYOK + docker + no training-tier models by default.

---

## The map of the code

Think of a building with a locked basement.

The basement is `@polycode/core`: canonical messages, the agent loop, permissions, compaction, SSRF, redaction, personas, child spawn. Nothing in `core` imports a provider SDK. If that rule ever breaks, multi-model is theater.

Above the basement:

| Floor | Package | Job |
|---|---|---|
| Tools | `@polycode/tools` | File/shell/web/task tools as `ToolSpec`s |
| Jail | `@polycode/sandbox` | Local path jail + docker fail-closed + git worktrees |
| Keys | `@polycode/secrets` | Keychain / file / allowlisted `.env` |
| Models | `@polycode/providers` | The **only** AI-SDK-aware code |
| Routing | `@polycode/router` | cheap / strong / long |
| Chat UI | `@polycode/tui` | Ink: composer, overlays, dashboard |
| Door | `@polycode/cli` | `pnpm dev` or `--serve` |
| HTTP | `@polycode/server` | POST `/chat` SSE (treat as local-only) |
| Fan-out | `@polycode/workflows` | Budgeted parallel/sequential children |
| Graphs | `@polycode/graph` | State + edges + file checkpoints |
| Extend | mcp, plugins, skills, lsp | MCP, bundles, slash skills, language servers |

`packages/` is a pnpm workspace. `cli` depends on the others; they depend inward toward `core`. `docs/` is the handbook. `.polycode/` on disk (gitignored) is the *runtime* house: sessions, worktrees, graph-runs, beta-logs, memory.

**Mental model:** one loop, many skins. TUI and server both construct an `Agent` and feed it events.

---

## Architecture

```
You (terminal)
    │
    ▼
Ink TUI  ── /slash · permission y/a/n · Ctrl+B · dashboard
    │
    ▼
Agent.run()   stream → tool_call → PermissionEngine → sandbox.exec → tool_result → loop
    │
    ├── Provider.stream()  (canonical events only)
    │         ▲
    │         └── AI SDK adapter (OpenAI / Gemini / xAI / …)
    │
    ├── spawnChild  (depth 1: explore | researcher | general | review)
    ├── workflows   (team, deep-research)
    └── graph       (nodes = children, checkpoint after each super-step)
```

**Hard law:** the loop, tools, TUI, and graph never see a provider-specific message shape. `CanonicalEvent` is `text_delta | reasoning_delta | tool_call | stop | error`. Add a model by writing an adapter, not by forking the agent.

One `provider.stream()` is one model turn. We do **not** let the SDK auto-run tools. That is how permission prompts, redaction, and parallel-safe batches stay ours.

Compaction: at ~85% of the context window, elide old tool bodies, then summarize older turns with the cheap tier. Same behavior on Grok and Gemini.

Children: max depth 1. Explore/researcher are read-only. Two writers in one turn get worktrees. Background writers need `acceptEdits` or `yolo`. Worktree children in ask mode use silent acceptEdits so `/team` does not click-farm you.

Graphs: JSON state machine. Nodes are those same children. Edges are fixed or `if: { field, includes }`. After each super-step we write `.polycode/graph-runs/<thread>.json`. `/graph resume` continues the machine, not just the chat.

---

## Technologies we chose (and why)

| Choice | Why | Tradeoff |
|---|---|---|
| TypeScript + pnpm 9 workspace | One language from TUI to sandbox; `tsx` on `src/` in dev | Publishing would need `dist` mains |
| Ink + React 18 | Claude-Code look: `<Static>` scrollback, no flicker | Windows Terminal is the real UX test, not vitest |
| Vercel AI SDK **behind** our `Provider` | Fast multi-vendor stream | SDK majors rename `fullStream` parts — pin and re-verify |
| `@napi-rs/keyring` | Windows DPAPI keychain | Optional; `0600` file fallback |
| Vitest | Fast unit tests next to the code | Does not replace a live TTY |
| **No** `@langchain/langgraph` | Would smash canonical types | We reimplemented the *ideas* (state, edges, checkpointer) |

We ship via git + Docker, not npmjs. Hosted mode exists so the *same* `Agent` can hang off HTTP; it is not a product tenant.

Contributor/training-tier model ids are refused unless `allowTrainingTiers: true`. That was a company constraint, not fashion.

---

## How the parts talk to each other

**A normal turn**

1. You submit text. `UserPromptSubmit` hooks can block.
2. Optional router picks cheap/strong/long.
3. `Agent.run()` streams. Text paints at ~10 Hz. Tool calls are buffered, worktrees stamped if two writers, then shown.
4. Safe consecutive tools run in parallel. `task` children that would prompt do not share a batch.
5. Permission engine: deny rules and protected paths (`.env`, `.git`, `.ssh`, most of `.polycode`) first. Then mode. Then prompt.
6. Tool `run()` only talks to `ctx.sandbox`. No raw `fs` in tools.
7. Output is `redactSecrets`’d. Results go back as a `tool` message. Loop or stop.
8. Session JSON is written under `.polycode/sessions/`.

**A graph turn**

`/graph research-implement add a comment` compiles a def, creates a thread id, runs `explore` then `implement` (worktree), checkpoints after each node, prints the run. Crash mid-graph? `/graph resume <id>`.

**A buddy on your box**

Ask mode, not yolo. Their Grok key or yours via `/settings`. Survey at `docs/beta-survey.html`. Logs stay gitignored.

---

## Bugs, scars, and how we fixed them

These are real. They came from cranky reviews and Jared sitting at the TUI.

### Scar 1 — Safe tools skipped the jail

**What.** Early permission code short-circuited `safe` tools before deny/protect. `read` of `.env` could auto-allow.

**Root.** Convenience: “safe means skip the gate.”

**Fix.** Deny rules and `isProtectedInput` run first. Tests for `.env` reads and bash that names `.env`.

**Lesson.** Order of checks is a security feature. Write the order down and test it.

### Scar 2 — `.env` as RCE

**What.** `loadDotEnvFiles` copied every `KEY=VALUE` into `process.env`. A repo `.env` could set `NODE_OPTIONS` / `HTTPS_PROXY`. Child node/npm would load attacker code or leak keys.

**Root.** dotenv cargo-cult: “load the file like everyone else.”

**Fix.** Allowlist provider keys and aliases only. Refuse `NODE_OPTIONS`, proxies, `POLYCODE_AUTH_TOKEN`. Realpath jail. `childProcessEnv` strips loader-injection names even on MCP overrides.

**Lesson.** Untrusted files do not get to write process env. Allowlist, don’t denylist.

### Scar 3 — Background children that could not work

**What.** `forkSilent()` used a deny stub. In `acceptEdits`, bash still “prompts,” which became silent deny. Background writers were advertised and then toothless except in yolo.

**Root.** Silent ≠ read-only, but we implemented it that way.

**Fix.** Silent acceptEdits auto-allows mutating and dangerous (still blocks protected paths). Ask/plan silent stays plan. Worktree children use `forkIsolated()`.

**Lesson.** A background feature that cannot run its tools is a trap. Name the policy.

### Scar 4 — Ctrl+B leftover bomb / dashboard remount

**What.** `demoteTurn` survived an abort during `stream()`, so the *next* tool turn no-op’d. Dashboard `key={dashTick}` remounted every 400ms; peek/attach reset. `/loop 25d` overflowed `setInterval` to 1ms.

**Root.** Flags on the Agent instead of the `run()` call; React keys as a refresh hack; no cap on interval math.

**Fix.** Clear `demoteTurn` in `finally`. Refresh dashboard data without remounting. Cap loops at 24h; monotonic ids `l1, l2, l3`.

**Lesson.** UI refresh ≠ remount. Timeouts need a numeric ceiling. Abort paths need `finally`.

### Scar 5 — Jared’s beta: permission spam and `/hepl`

**What.** He rated permissions 2/5. Grok used `bash` + `wc` to count `.py` files (Windows has no `wc`), so every count was a prompt plus a failure plus a retry. `/hepl` was correctly *not* sent to the model, but the red `unknown /hepl` line looked like a crash. He marked it fail. He would use the product again (4/5 overall).

**Root.** Tool descriptions did not forbid bash-for-inventory. Error chrome implied failure.

**Fix.** `glob` returns `N files` then the list. System prompt: glob/grep/ls for listing. Repeat bash prompts lead with **`a` allow bash this session**. `/hepl` is a system line: not sent, did you mean `/help`?

**Lesson.** Testers grade what they *see*. A correct guard with hostile copy is still a fail. Models will use the noisiest tool you leave lying around.

### Scar 6 — We are not LangGraph (and that was confusing)

**What.** It felt like “a series of LangGraph agents with persistence.” The code was a ReAct loop + `/team`. No graph, no checkpointer.

**Root.** Multi-agent fan-out looks like a graph from the outside.

**Fix.** `@polycode/graph`: state, nodes-as-children, edges, file checkpoints. Documented as *shaped like* LangGraph, not *imported from* it.

**Lesson.** Name the runtime honestly. If you want a state machine, build one on your loop — don’t pretend spawn is a DAG.

---

## Pitfalls to avoid next time

- **Do not** let vitest crawl `.polycode/worktrees/`. Jared’s `/team` left a copy of the repo; tests ran twice and some packages had no `node_modules`. Exclude `.polycode/**`.
- **Do not** treat `busy` React state as the mutex. `busyRef.current = busy` on every render undoes a synchronous lock. Own the ref in acquire/release.
- **Do not** share one `PermissionEngine` across parallel children. Concurrent `setPerm` orphans a prompt and hangs a child.
- **Do not** follow persona or `.env` symlinks. `realpath` must stay under the intended directory; skip non-files.
- **Do not** load project `.env` into `NODE_OPTIONS`. Allowlist keys.
- **Do not** use `key={tick}` to live-update an overlay. You will destroy selection state.
- **Do not** pass parent `AbortSignal` into `waitChild` when `timeout_ms=0`. That turns a snapshot into “wait forever.”
- **Do not** merge a cranky **REJECT**. Nits can ship; open bugs cannot (`POLYCODE.md`).
- **Do not** expose `--serve` on an untrusted network. Hosted auth exists; tenant isolation does not.

---

## What good engineers did here

- **Canonical seam first.** Types in `core`, adapter at the edge. That is why Grok-only first-run and Muse-as-alias could land without rewriting the TUI.
- **Deny before convenience.** Protected paths beat “it’s a read.”
- **Cranky as a gate.** Diagnose → implement → `/review` → `pnpm test` → merge. Round-trip until APPROVE.
- **Tests next to the bug.** 267 → 307 as we closed races: child cap, waitChild snapshot, `/hepl` copy, glob counts, graph resume.
- **Gitignored runtime.** Sessions, keys, beta-logs, graph-runs never belong in a PR.
- **Small squash PRs** to `main` (`#5` harness, `#6` TUI/kernel, `#7` hardening, `#8` spam/`hepl`, `#9` graphs).
- **Buddy-in-the-chair.** Automated green is not UX. Jared’s 2/5 on prompts was worth more than another catalog test.
- **Copy as product.** “Not sent to the model” vs “unknown command.”

---

## Lessons you can steal

1. **Own the tool loop.** If the SDK runs tools, you do not have permissions, redaction, or a dashboard.
2. **One depth of children is a feature.** Nested swarms are how you lose the plot and the bill.
3. **Silent engines need an explicit policy.** Deny-stub is not “non-interactive acceptEdits.”
4. **Persist the machine and the chat separately.** Transcripts (`sessions/`) ≠ graph threads (`graph-runs/`).
5. **Windows is a provider.** `wc` is not a tool. Glob is.
6. **Allowlist untrusted config.** `.env` and MCP env overlays are attack surface.
7. **Refresh data, don’t remount UI.**
8. **Write the narrative when the scars are fresh.** That is this file.

---

## Where to go next

1. **Live TTY pass** of `/graph explore …` and `/graph research-implement …` on Windows Terminal after a restart (this FORME was written as graphs landed on `main` at `a9a0186`).
2. **Hosted mode** is still a scaffold: do not put it on a public bind. Tenant isolation is unsolved.
3. **Capability numbers** in the provider catalog are estimates — pin them against current vendor docs when compaction misbehaves.
4. **Graph v1 has no cross-thread store.** Long-term facts still go in `.polycode/memory.md`. Decide if that is enough.
5. **Ask-mode bash** will still prompt when the model truly needs a shell. Teach `a` for session; don’t silently yolo.
6. **Smoke the non-Grok providers** if you claim multi-model in a demo. Jared’s session was `xai:grok-4.3` only.
7. **Decide the pygame tic-tac-toe file** sitting untracked under `examples/` — it is not part of the agent.

### Glossary

| Term | Meaning |
|---|---|
| Canonical | Our message/event/tool types; adapters translate to/from vendors |
| ReAct loop | Stream → tools → observe → repeat until `end_turn` |
| Depth 1 | Children cannot spawn children |
| Worktree | Detached git copy; `/worktree apply` copies back |
| forkSilent | Child permission engine that never pops the TUI |
| Super-step | One tick of a graph: run all ready nodes, checkpoint |
| Cranky | Structured review; REJECT if any open bug |

---

*Written for Gasan, 2026-08-31, from the repo as it actually is — not the slide.*
