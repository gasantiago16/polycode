# polycode live demo — 3 Sep 2026

Cheat sheet for the talk. **Ask mode. Local TUI. No yolo. No `--serve`.**
If the room is restless, skip to beat 5. If the model is slow, skip to backup.

Repo: `C:\Users\gasan\OneDrive\Dev\Projects\polycode`
Launch: Windows Terminal, not cmd.

```
cd C:\Users\gasan\OneDrive\Dev\Projects\polycode
corepack pnpm dev
```

First-run: keys already in Settings. Confirm statusline shows `ask` and a real model (`xai:…` or whatever is live). If it opens Settings, Esc.

Font large enough that `/graphs` DAGs are readable from the back row.

---

## What you are proving (say this once)

> polycode is a **terminal coding agent** we host. Same ReAct loop for Grok, Gemini, OpenAI, Muse. Children are **one layer**. Graphs are a **state machine on that loop** — not LangChain, not LangGraph, not Grok Build cloud.

Then stop talking and type.

---

## Beats (target ~8 minutes)

| # | You type | Audience should see | You say |
|---|---|---|---|
| 0 | *(already running)* | Banner, composer, statusline `ask` | “This is the product. Not a website.” |
| 1 | `what is this repo?` | Tools: glob/grep/read (not `bash`+`wc`). Answer cites `packages/`. | “The model inventories with glob, not a shell.” |
| 2 | `/hepl` | **System** line: `isn't a command — not sent to the model. Did you mean /help?` | “Typos stay in the TUI. They never become a prompt.” |
| 3 | `/mode plan` then `edit README to say hello` | Plan mode; write/edit **refused**. | “Plan is read-only. Permissions are the product.” |
| 4 | `/mode ask` · `/graphs` | `demo`, `explore`, `research-implement` each with `START → … → __end__` | “These are graphs. ASCII DAG, not a slide.” |
| 5 | `/graph show demo` | One-node explore DAG + “Stage-safe” | “Tomorrow’s live path is this graph — no worktree.” |
| 6 | `/graph demo how the agent loop works and how /graph differs from /team` | Progress: `graph demo · running · …` then a child, then checkpoint | “Node = child agent. Checkpoint after the super-step.” |
| 7 | `/dashboard` (or `Ctrl+\`) | Child list + dim last-graph line. Statusline may show `c:1` while it runs. | “Dashboard is the swarm. `c:N` on the statusline.” |

**Do not** run `/graph research-implement` on stage (worktree + writer). **Do not** `/mode yolo`. **Do not** `--serve`.

---

## Backup (30 seconds)

If `/graph demo` errors or the model stalls:

```
/explore what is this repo? Cite packages/core and packages/graph.
```

Read-only child. Same spawn path as a graph node. Then `/dashboard`.

If `/hepl` ever looks red: it is still a **system** message, not a crash. Point at “not sent to the model.”

If permissions pop on bash: press **`a`** (allow bash this session). Lead with `a`, not `y`. That was Jared’s 2/5.

---

## If they ask

| Question | Honest answer |
|---|---|
| Is this LangGraph? | **No.** We reimplemented state, edges, super-step, file checkpointer on our loop. Zero `@langchain/*`. |
| Is this Grok Build? | **Shape**, not the product. No Rhai, no Grok cloud, no tenant isolation. TypeScript workflows + graphs. |
| Isolation? | BYOK, docker `--network none`, path jail, deny/protect before “safe.” Hosted HTTP is a scaffold. |
| Nested agents? | Depth **1**. Children cannot spawn. Parent-only: `task`, `task_wait`, `task_kill`, `graph`. |
| Persistence? | Chat = `.polycode/sessions/`. Graph = `.polycode/graph-runs/<thread>.json`. `/graph resume <id>` continues the **machine**. |
| Windows? | First-class. `wc` is not a tool. Glob is. |
| Tests? | Unit tests next to the bug. Cranky review until APPROVE. Not a substitute for a live TTY. |

---

## Timing if you have 12 minutes

After beat 7: `/graph` (list threads) → `/graph status <id>` → open `docs/FORgasan.html` if they want the narrative.

---

## Pre-flight (night before)

1. `corepack pnpm test` green (314 on this branch).
2. `corepack pnpm dev` once; run beats 2, 4, 5, 6 on this machine.
3. Font + Windows Terminal theme: dark, coral readable.
4. Network for the model key. No demo of Settings paste unless you must.
5. Close other `.polycode` TUI sessions so dashboard is this one.
6. This file printed or on a second screen. Deck: `docs/polycode-harness.pptx`.
