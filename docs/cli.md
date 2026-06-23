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
| `--serve` | Start the server instead of the TUI. |
| `--port <n>` | Server port (default 8787). |

## Slash commands (in the TUI)

| Command | Effect |
|---|---|
| `/model <provider:model>` | Switch model at runtime (history is preserved). |
| `/mode <plan\|ask\|acceptEdits\|yolo>` | Change the tool-permission mode. |
| `/route <auto\|off\|status>` | Toggle per-turn auto-routing (needs `--routing model` / config). |
| `/login` | Re-open the masked key setup screen. |
| `/keys` | Show configured providers + active backend (names only). |
| `/help` | List commands. |
| `/exit` (or `/quit`) | Quit. |

## Permission prompt

When a gated tool runs (per the active `/mode`), the TUI shows:

```
Allow <tool> [<class>]? <input>  (y/n)
```

Press `y` to allow, `n` (or `Esc`) to deny. A denied call is reported back to the model so
it can adapt.

## Server endpoints (hosted mode)

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/chat` | `{"message": "..."}` | SSE: `meta`, `event` (AgentUIEvent frames), `done` |
| `GET` | `/health` | — | `{"ok": true}` |
