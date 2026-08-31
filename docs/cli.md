# CLI Reference

## Scripts (run via Corepack pnpm)

| Script | Command | Purpose |
|---|---|---|
| dev | `corepack pnpm dev` | Launch the interactive TUI (local mode). |
| serve | `corepack pnpm serve -- --port 8787` | Run the HTTP+SSE server (hosted mode). |
| smoke | `corepack pnpm smoke <provider:model>` | Live canonical-stream + read-tool round-trip test. |
| route-check | `corepack pnpm route-check <provider:model>` | Compare the model classifier vs. the heuristic on sample prompts. |
| typecheck | `corepack pnpm typecheck` | `tsc --noEmit` across the workspace. |
| docs | `corepack pnpm docs` | Regenerate `docs/html` from `docs/*.md`. |
| build | `corepack pnpm build` | Bundle for distribution (tsup). |

> Pass CLI flags after `--`, e.g. `corepack pnpm dev -- --model openai:gpt-5.5`.

## Flags

| Flag | Effect |
|---|---|
| `--model <provider:model>` | Force a specific model (e.g. `xai:grok-4.3`). |
| `--tier <cheap\|strong\|long>` | Force a starting tier from your config. |
| `--routing <heuristic\|model>` | Override the routing strategy (model = a cheap model picks the tier). |
| `--sandbox <local\|docker>` | Tool-execution sandbox (docker isolates shell). |
| `--serve` | Start the HTTP+SSE server instead of the TUI. Requires `POLYCODE_AUTH_TOKEN` (≥16 chars) unless `--insecure`. Non-loopback bind requires docker. |
| `--port <n>` | Server port (default 8787). |
| `--host <addr>` | Bind address (default `127.0.0.1`, or `0.0.0.0` inside Docker). |
| `--continue` | Resume the most recent session in this project. |
| `--resume <id>` | Resume a specific session id. |
| `--sessions` | List saved sessions (id · model · title) and exit. |
| `--models` | Print the pinned provider catalog and exit. |
| `--insecure` | Hosted mode without bearer auth (local scaffold only). Otherwise `POLYCODE_AUTH_TOKEN` is required. |

Sessions are stored as `<cwd>/.polycode/sessions/<id>.json` and saved after each turn.

## Slash commands (in the TUI)

| Command | Effect |
|---|---|
| `/model <provider:model>` | Switch model at runtime (history is preserved). |
| `/mode <plan\|ask\|acceptEdits\|yolo>` | Change the tool-permission mode. |
| `/route <auto\|off\|status>` | Toggle per-turn auto-routing (needs `--routing model` / config). |
| `/compact [focus]` | Two-pass context compaction (always runs; auto at 85%). |
| `/context` | Token breakdown vs the model window. |
| `/review` (`/cranky`) | Spawn a depth-1 reviewer child on the local git diff. |
| `/explore <q>` | Spawn a read-only explore child. |
| `/skills` | List loaded skills (bundled forme, matsumura-style, deep-research). |
| `/mcp` | MCP servers from `.polycode/mcp.json` (fail-soft connect). Notes deferred schemas. |
| `/plugins` | Loaded plugin bundles (`.polycode/plugins/<name>`). |
| `/statusline` | Show or set the status-line template (`/statusline default` resets). |
| `/hooks` | List configured lifecycle hooks. |
| `/worktree list` | Detached git worktrees under `.polycode/worktrees/`. |
| `/worktree apply <id>` | Copy changed + untracked files from a child worktree onto the parent tree. Does not merge or delete. |
| `/worktree remove <id>` | `git worktree remove --force` that tree. |
| `/workflows` | Bundled + `.polycode/workflows/*.json` + `~/.config/polycode/workflows/*.json`. |
| `/workflow <name> [query]` | Run a named JSON workflow (parallel, then sequential `steps`, then synthesize). Budgeted. |
| `/forme [name]` | Skill: FOR{Name}.md + visual HTML (SVG, no image gen). |
| `/matsumura-style [args]` | Skill: Matsumura/Sturzinger memo. |
| `/deep-research <q>` | Budgeted workflow: 3 researcher children, then a synthesize child writes `docs/research/<slug>.md`. |
| `/deep-research-review [path]` | Extract claims, refute with primaries, write a scorecard. |
| `/cost` | Session token ledger × catalog list prices (USD). |
| `/todo` | Show the in-memory todo list (`todo_write` tool). |
| `/memory` | Show curated project memory (`.polycode/memory.md`). |
| `/memory add <note>` | Append a dated note (also `/memory <note>`). |
| `/memory clear` | Empty the memory file. |
| `/image <path> [caption]` | Attach a local png/jpg/gif/webp and send a turn. `@shot.png` in a prompt also attaches. |
| `/rewind` (`/undo`) | Restore files from the last mutating-tool checkpoint and drop that turn. |
| `/settings` (or `/login`) | Open the API-key Settings screen (paste / import-env / open-page / validate / agentic). |
| `/clear` | Clear the transcript. |
| `/help` | List commands. |
| `/exit` (or `/quit`) | Quit. |

## Permission prompt

When a gated tool runs (per the active `/mode`), the TUI shows a prompt with the tool, its
class, and the call. Answer with:

- `y` / `Enter` — allow once
- `a` — allow this tool for the rest of the session (sticky; `plan` mode still overrides)
- `n` / `Esc` — deny

A denied call is reported back to the model so it can adapt.

## Server endpoints (hosted mode)

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/chat` | `{"message": "..."}` | SSE: `meta`, `event` (AgentUIEvent frames), `done`. Auth: `Authorization: Bearer` or `X-Api-Key`. |
| `GET` | `/health` | — | `{"ok": true, "auth", "mode"}` (public) |
| `GET` | `/ready` | — | Same as `/health`. |
| `GET` | `/ide` | — | IDE bridge: endpoint list (auth). |
| `GET/POST` | `/ide/context` | `{ file, selection, language, diagnostics }` | Editor snapshot prepended as `<ide>` on the next `/chat`. |
| `GET` | `/ide/catalog` | — | Plugins, skills, tool names, agent types. |

`401` unauthorized · `413` body too large · `429` rate/concurrency (`Retry-After`) · `x-request-id` on every response. Audit lines (no bodies) append to `.polycode/audit.jsonl`. Hosted permission mode cannot prompt: `ask` becomes `plan`; `yolo` requires `--insecure`. Docker sandbox defaults to `acceptEdits`.
