# polycode Build-out Plan — to Claude-Code-class

> Forward-looking plan (Phases 5+) to take polycode from "basic parity" (Phases 1–4 done)
> to a genuinely useful, Claude-Code-class, **provider-agnostic** coding agent.
> Grounded in a June-2026 code audit + a full Claude Code feature diff + the open-source
> landscape (opencode, Codex, Aider, Cline, Goose, Pi). Read [roadmap.md](roadmap.md) for what's
> already done.

## North Star

One provider-blind agent engine that is **as useful as Claude Code for daily coding**, while
keeping the things that make polycode distinct: true multi-provider routing (cheap/strong/long
per turn across OpenAI/Gemini/xAI), a hardened sandbox, and a hosted server from the same core.
Anthropic stays excluded — we match Claude Code's *capabilities*, not its provider.

**Design rule for every item below:** it must be provider-agnostic, it must flow through the
existing seams (canonical types → permission engine → sandbox), and it must degrade gracefully.

## Where we stand (and our edge)

Done (Phases 1–4): context-grounded loop with `maxSteps`/retry, 8 tools (read/write/edit/
multi_edit/bash/grep/ls/glob) with a diff `display` channel, permission engine (plan/ask/
acceptEdits/yolo) with sticky session grants, no-flicker Ink TUI + token meter, local+docker
sandbox, per-turn smart routing, secure keychain key flow, session persistence/resume, hosted
server scaffold, build/distribute (`tsup` → single `poly` bin).

**Landscape positioning.** The open-source table stakes in 2026 (opencode @ 172k stars, Codex,
Aider, Cline, Goose, Pi) are: provider-neutrality + MCP + skills/commands + subagents + a
sandbox + a good TUI. polycode already has **provider-neutrality + a hardened docker sandbox +
a polished TUI + automatic cross-provider routing** (most tools *don't* auto-route across
vendors — that's our differentiator). The gaps to "competitive and useful" are concentrated:
**MCP, context compaction, subagents, skills/commands, web tools.** Those are this plan's spine.

## Phase 5.0 — Pre-flight ground truth (do FIRST, ~0.5 day)

Everything downstream (especially compaction, which needs real context-window numbers) rests on
unverified placeholders. Close that first.

- Verify live model IDs for OpenAI / Gemini / xAI against current provider docs; update
  `polycode.config.example.json` + `providers/src/index.ts` defaults.
- **Pin** `ai` + `@ai-sdk/*` versions in every `package.json` (currently floating) and re-verify
  the `fullStream` part names the adapter switches on (`ai-sdk-provider.ts`) against the pinned
  SDK — AI SDK majors rename stream parts.
- Fill in real `Capabilities.contextWindow` / `maxOutput` per model (`providers/src/index.ts:14-43`)
  — these are flagged "CONFIRM" and are load-bearing for Phase 5.2.
- `smoke` all three providers (only `xai:grok-4.3` has been run live); **visually run the TUI in a
  real TTY once** (never done — build sessions had no TTY).

**Verify:** three green smokes + one human TUI run.

## Gap analysis (Claude Code surface → polycode)

| Capability | polycode today | Leverage | Phase |
|---|---|---|---|
| **MCP client** (stdio + HTTP) | ABSENT | ⭐⭐⭐ unbounded tool surface | 5.1 |
| **Context compaction / auto-summarize** | ABSENT (history unbounded → hard-fails) | ⭐⭐⭐ correctness, not polish | 5.2 |
| **Subagents / Task tool** | ABSENT | ⭐⭐⭐ big-codebase work, context isolation | 5.3 |
| **Custom commands + Skills** | hardcoded if-chain | ⭐⭐⭐ extensibility-by-convention | 5.4 |
| **Web tools** (WebFetch/WebSearch) | ABSENT | ⭐⭐ cheap, extends context | 5.5 |
| **Todo / task tracking** | ABSENT | ⭐⭐ keeps long tasks on-track | 5.5 |
| **Permission allow/deny rules** | mode + per-tool sticky only | ⭐⭐ kills prompt fatigue | 6.1 |
| **Hooks** (Pre/PostToolUse, Session*) | ABSENT | ⭐⭐ policy/automation (auto-format, audit) | 6.2 |
| **Checkpoints / rewind (Esc-Esc)** | ABSENT | ⭐⭐ safety, reversible experiments | 6.3 |
| **settings.json hierarchy** | single config file | ⭐ team/user/local layering | 6.1 |
| **Memory write-back + `/memory`** | reads CLAUDE.md once | ⭐ cross-session learning | 6.4 |
| **@-file mentions** | ABSENT | ⭐ fast context inclusion | 7.1 |
| **Image / multimodal input** | ABSENT at loop level | ⭐ "fix this screenshot" | 7.2 |
| **`/context` + `/cost` + status-line** | basic token meter | ⭐ observability | 7.3 |
| **Server hardening** (auth/rate-limit/policy) | yolo scaffold | ⭐ deployability | 8 |
| **IDE / hosted surfaces / plugins / LSP** | none | later | 9 |

---

## Phase 5.1 — MCP client (the force multiplier) ⭐⭐⭐

**Why first of the big rocks:** one feature turns polycode's fixed 8-tool surface into the entire
MCP ecosystem (GitHub, Postgres, Slack, filesystem, Brave, thousands of community servers). It is
*the* defining Claude-Code-class capability, and the Vercel AI SDK — which polycode already
depends on — ships `experimental_createMCPClient` with automatic MCP→tool conversion and a stdio
transport, so we lean on the SDK for the protocol work instead of hand-rolling it.

**Build:**
- New `packages/mcp`: read MCP server config from a scope hierarchy (`.polycode/mcp.json` local >
  project > `~/.config/polycode/mcp.json` user), connect each server (stdio child process or
  Streamable HTTP), call `client.tools()`.
- **Wrap each MCP tool as a canonical `ToolSpec`** (`core/types.ts:101`): name
  `mcp__<server>__<tool>`, schema from the server's `inputSchema`, `permission: "dangerous"` by
  default (overridable per-server in config: a trusted server can be `mutating`/`safe`),
  `parallelSafe: false`, and `run(input)` = `await mcpTool.execute(input)` normalized to
  `ToolRunResult`. **This is the whole point of the clean seam:** MCP tools become first-class
  ToolSpecs and flow through the *same* permission engine as native tools — no special-casing in
  the loop.
- Merge the dynamic ToolSpecs into the tools array at the existing seam (`cli/index.ts:148`,
  `server/src/index.ts:39`). Connect on startup, `dispose()` on exit, and **fail-soft**: a server
  that won't connect logs a warning and is skipped, never crashes startup.
- `/mcp` command: list servers, their tools, and connection status.

**Defer:** deferred schema loading — ✅ in 7.3 (`mcp_search` + first-call hydrate; opt out with
`"mcp": { "deferSchemas": false }`).

**Seam:** `core/types.ts:101` (ToolSpec), tool-array merge at `cli/index.ts:148`.
**Effort:** M. **Depends on:** 5.0 (pinned SDK). **Verify:** connect the official filesystem +
a stdio echo server; model calls an MCP tool through a permission prompt; `/mcp` lists them.

## Phase 5.2 — Context compaction ⭐⭐⭐ (correctness, not polish)

**Why:** `Agent.messages` grows unbounded (`agent.ts:159,236`); the only mitigations are
per-output clamps. Any real multi-hour session eventually hard-fails at the provider's context
limit. Claude Code treats this as must-have. This is what makes polycode *usable*, not just
*demoable*.

**Build:**
- Token accounting: implement the declared-but-dead `Provider.countTokens?` (`types.ts:141`) — or
  a cheap `chars/4` estimator behind it — and a running estimate of `this.messages`.
- At the **top of the `run()` loop** (`agent.ts:78`, before each `provider.stream`): if estimated
  tokens > `0.8 × capabilities().contextWindow`, compact:
  1. **Tool outputs first** (they dominate): replace large old `tool_result` bodies with a one-line
     synopsis + `[elided in compaction]`.
  2. If still over, summarize the oldest conversation turns via the **cheap-tier provider** (we
     already have one via the router) into a single synthetic summary message; always preserve the
     original task, the most recent K turns, and pinned project context.
- `/compact [focus]` for manual compaction with a focus hint; extend the existing token meter into
  a `/context` breakdown (files vs tool output vs system vs history).

**Seam:** `agent.ts:78` (loop top), `providers/src/index.ts` (real contextWindow + countTokens).
**Effort:** M. **Depends on:** 5.0 (accurate context windows). **Verify:** drive a session past
the window with a small-context model; confirm it compacts and keeps going coherently.

## Phase 5.3 — Subagents / Task tool ⭐⭐⭐

**Why:** the killer pattern for large codebases — fan out exploration/refactor work into a child
with its own context window so the parent's context stays clean. The `Agent` class is already
self-contained and reusable (`agent.ts:42`), so this is mostly wiring.

**Build:**
- New `task` ToolSpec: `run({description, prompt, subagent_type?})` constructs a fresh `Agent` with
  the **same permission engine** (so user control of mutations is unified) and the **same sandbox**,
  but a curated toolset that **excludes `task`** (recursion guard) — optionally on a cheaper model
  (cost control; trivial given our multi-provider providers/router). Run to completion; return only
  the child's final text — its intermediate steps never enter the parent's context (that isolation
  *is* the value).
- Subagent types from `.polycode/agents/*.md` (frontmatter: `model`, `tools`, `system`); ship a
  default `general` + a read-only `explore`.
- TUI: render a Task call as a collapsed nested entry (new Entry kind in `EntryView`, `app.tsx:404`).

**Seam:** new ToolSpec in `tools/src/index.ts`; reuses `Agent` (`core/agent.ts:42`).
**Effort:** M. **Depends on:** 5.2 (children should compact too). **Verify:** a `task` that greps
+ summarizes a subsystem returns a tidy result without polluting parent context; recursion guard
holds.

## Phase 5.4 — Custom commands + Skills ⭐⭐⭐

**Why:** the extensibility-by-convention that makes Claude Code/opencode sticky. Today commands are
a hardcoded if-chain (`app.tsx:234-285`) — adding one means editing the TUI.

**Build:**
- A **command registry**. Built-ins stay as code; user commands load from `.polycode/commands/<name>.md`
  and `~/.config/polycode/commands`. A command file = frontmatter (`description`, `argument-hint`,
  optional `model`, `allowed-tools`) + a markdown body that becomes the turn prompt, with
  `$ARGUMENTS` / `$1…$N` substitution. `/name args` expands the body and submits it (optionally with
  a restricted toolset/model).
- **Skills** = the same file format + a `descriptions-in-context, body-on-invoke` loading model
  (validated by Pi's "lazy skills" running on a sub-1000-token prompt). Phase-in auto-invocation
  (model matches a task to a skill description) after manual `/skill` works.
- Replace the if-chain with `registry.dispatch(input)`; keep built-ins registered the same way.

**Seam:** `app.tsx:234-285` → registry; new loader in `cli` or a `packages/commands`.
**Effort:** M. **Depends on:** none (can parallel 5.1–5.3). **Verify:** a user `.md` command runs
with arg substitution and a restricted toolset.

## Phase 5.5 — Web tools + Todo (quick, high-value) ⭐⭐

- **`web_fetch`** (safe-ish, needs network): fetch URL → markdown → summarize against a prompt using
  the **cheap-tier provider** (we already have it). **`web_search`**: wire a search API (Brave/Tavily;
  key via the existing secrets store). Gate network behind the sandbox `network` flag.
- **`todo_write`**: in-memory task list the model maintains across a multi-step task; render as a
  checklist Entry (`EntryView`, `app.tsx:404`). Low effort, outsized effect on keeping long tasks
  coherent and on the UX signal of "what's it doing."

**Effort:** S each. **Depends on:** none. **Verify:** model fetches a doc page mid-task; todo list
renders and updates.

---

## Phase 6 — Safety & config maturity (production-grade)

- **6.1 Permission allow/deny rules + settings hierarchy.** Extend `permissions.check`
  (`permissions.ts:47`): before prompting, match the call against `allow`/`deny`/`ask` patterns
  (`Bash(npm test:*)`, `Edit(src/**)`) from a layered settings set (project `.polycode/settings.json`
  > user > local). Biggest single reduction in prompt fatigue. Keep protected paths (`.git`, `.env`,
  `.polycode`) never-auto-approved (we already block `.polycode` in `resolveSafe`). **Effort:** M.
- **6.2 Hooks.** ✅ Config-driven lifecycle hooks: `PreToolUse` (block by nonzero exit → deny),
  `PostToolUse`, `SessionStart/End`, `UserPromptSubmit`, plus `Stop` / `SubagentStart` / `SubagentStop`.
  Each = a matcher + a sandbox shell command. `UserPromptSubmit` also denies on nonzero.
  `/hooks` lists them. JSON workflows (`.polycode/workflows/*.json`) and `/worktree apply` shipped
  in the same slice. **Effort:** M.
- **6.3 Checkpoints / rewind.** Snapshot target file(s) before each mutating tool into
  `.polycode/checkpoints/<turn>/`; `Esc Esc` / `/rewind` restores. Pairs with the edit tools; high
  safety-per-effort. **Effort:** M.
- **6.4 Memory write-back + `/memory`.** ✅ Curated `.polycode/memory.md` (not a transcript),
  `memory` tool, `/memory` / `/memory add` / `/memory clear`, injected by `gatherContext`.
  **Effort:** S–M.

## Phase 7 — UX polish

- **7.1 @-file mentions** — composer pre-process (`app.tsx:230`) expands `@path` into inlined file
  content before submit. **S.**
- **7.2 Image input** — ✅ `ImagePart` on user messages, AI SDK `image` mapping, `/image <path>`
  and `@shot.png`. Terminal paste of binary images is not available in Ink; path/`@` is the surface.
  **M.**
- **7.3 Observability** — ✅ `/context`, `/cost`, customizable `$token` status line
  (`/statusline`, `statusLine.template` / `command`), deferred MCP schemas (`mcp_search` +
  first-call hydrate; `"mcp": { "deferSchemas": false }` for eager). **M.**

## Phase 8 — Server hardening (deployability)

✅ Bearer / `X-Api-Key` (timing-safe), hosted permission policy (`plan` / docker
`acceptEdits`; no prompt; yolo only with `--insecure`), per-IP rate + concurrency limits,
body/message caps, turn abort, request ids, audit JSONL, non-root Docker image on
`0.0.0.0` with `/health` HEALTHCHECK. `--host` / `hosted.*` config. **Effort:** M–L.

## Phase 9 — Ecosystem (later)

✅ Plugin bundles (`.polycode/plugins/<name>`: skills/commands/agents/hooks/MCP/LSP),
IDE HTTP bridge (`/ide`, `/ide/context`, `/ide/catalog` + `<ide>` on `/chat`), optional
`lsp` tool (JSON-RPC stdio, config-only, fail-soft). OpenTelemetry metrics still later.

---

## Sequencing rationale

Order = **usefulness-per-unit-effort × what compounds**, with correctness gates first:

1. **5.0 ground truth** — unblocks everything; cheapest.
2. **5.2 compaction before 5.3 subagents** — children need to compact too; and compaction is a
   correctness fix that makes *all* sessions usable.
3. **5.1 MCP early** — highest absolute leverage; cheap via the AI SDK; independent of the others
   so it can run in parallel with 5.2.
4. **5.3 / 5.4 / 5.5** — the productivity layer users feel daily.
5. **Phase 6** — once it's useful, make it safe/configurable for real/team use.
6. **7 → 8 → 9** — polish, then deployment, then ecosystem.

**Recommended this-week slice:** 5.0 (ground truth) → 5.1 (MCP) in parallel with 5.2 (compaction).
That single week converts polycode from "basic parity demo" to "extensible + survives long sessions"
— the two things standing between it and real daily use. Each phase ships as its own cranky-gated PR
(the established polycode merge discipline).

## Cross-cutting decisions (the "ultrathink" calls)

- **MCP execution routes through the permission engine, not around it.** MCP tools are wrapped as
  ordinary `ToolSpec`s; the loop never learns they're "special." This is why the clean seam was
  worth building.
- **Compaction summarizes with the cheap tier, not the active model.** We already pay for a router;
  reuse it so compaction is near-free and never burns strong-model budget.
- **Subagents share the parent's permission engine and sandbox, isolate only context.** Users keep
  one coherent approval surface; isolation is a context-window property, not a security boundary.
- **Commands and Skills are one mechanism** (markdown + frontmatter + arg substitution), differing
  only in load timing (eager body vs description-now/body-on-invoke). Build the registry once.
- **Everything is a file convention under `.polycode/`** (`mcp.json`, `commands/`, `agents/`,
  `settings.json`, `hooks`, `checkpoints/`, `sessions/`) — discoverable, git-shareable, matching the
  opencode/Claude-Code mental model. `.polycode/` is already sandbox- and git-ignored.

## Explicitly out of scope

Anthropic provider / `claude-*` models / `@ai-sdk/anthropic` (permanent). Cloud-hosted artifacts,
managed org policy console, Bedrock/Vertex/Foundry routing, and a desktop/computer-use app — not
aligned with a self-hostable, provider-agnostic CLI.
