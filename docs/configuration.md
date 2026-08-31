# Configuration

## Config file

`polycode` looks for a JSON config in this order and uses the first found:

1. `./polycode.config.json` (current working directory)
2. `~/.config/polycode/config.json` (or `%APPDATA%\polycode\config.json` on Windows)

Anything you set is merged over the built-in defaults. Start from the example:

```powershell
cp polycode.config.example.json polycode.config.json
```

```json
{
  "system": "You are polycode, a terminal coding agent. Be concise. Use tools to inspect and edit the project.",
  "tiers": {
    "cheap":  { "provider": "google", "model": "gemini-2.5-flash" },
    "strong": { "provider": "openai", "model": "gpt-5.5" },
    "long":   { "provider": "google", "model": "gemini-2.5-pro" }
  }
}
```

### Fields

| Field | Meaning |
|---|---|
| `system` | System prompt sent to the model every turn. |
| `tiers.cheap` | Model for simple turns (edits, lookups). |
| `tiers.strong` | Model for reasoning / multi-file / planning turns. |
| `tiers.long` | Model for very large context. |

Each tier is `{ "provider": "<id>", "model": "<id>" }` where provider is
`openai` | `google` | `xai` | `muse` | `nvidia` | `qwen` | `anthropic` (or a
`providers.custom` id). See [Providers & Models](providers.md).

```json
"allowTrainingTiers": false,
"providers": {
  "allow": ["openai", "google", "anthropic", "nvidia"],
  "custom": [{ "id": "local-nim", "baseURL": "http://127.0.0.1:8000/v1", "envKey": "NVIDIA_API_KEY" }]
}
```

`poly --models` prints the pinned catalog. `NVIDIA_BASE_URL` / `MUSE_BASE_URL` / `QWEN_BASE_URL` override hosted endpoints.

`"profile": "company"` forces docker sandbox (fail-closed), `allowTrainingTiers: false`, and does not load `~/.grok/skills`. `"web": false` removes `web_fetch` / `web_search`. Search keys: `TAVILY_API_KEY` or `BRAVE_API_KEY` (host env, not docker). `"compat": { "grokSkills": true }` also loads `~/.grok/skills` on non-company profiles.

```json
"permissions": {
  "allow": ["Bash(npm test*)"],
  "deny": ["Edit(.env)", "Write(.env)"]
}
```

Deny wins. `.env` / `.git` / `.polycode` (except `reviews/` and `memory.md`) are protected outside yolo even without a deny rule. `@path/to/file.ts` in a prompt inlines the file; `@shot.png` attaches the image.

## Project memory

Curated notes (not a transcript) live at `.polycode/memory.md`. `gatherContext` injects them as `<memory>` on session start. The `memory` tool (`read` / `append` / `replace`) writes through the sandbox. `/memory` is the TUI editor: show, `add <note>`, `clear`. Caps: 2k per append, 32k file.

MCP (fail-soft): `.polycode/mcp.json` or `~/.config/polycode/mcp.json`

```json
{
  "mcpServers": {
    "github": {
      "command": "node",
      "args": ["./mcp/github-server.js"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "…" },
      "permission": "dangerous"
    },
    "remote": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } }
  }
}
```

`npx` / `npm` / `pnpm` / `yarn` / `bunx` as `command` are **refused** (they download and run
registry packages). Point `command` at a local binary. To override, set `"allowRegistry": true`
on that server **and** `"mcp": { "allowRegistrySpawns": true }` in config. Company profile
never allows the override.

Tools show up as `mcp__github__…` and go through the same permission engine. `/mcp` lists status.

MCP **input schemas are deferred** by default: `parameters` sent to the model are a stub (`additionalProperties: true`) until `mcp_search` hydrates a match (max 8) or the tool is first called. Set `"mcp": { "deferSchemas": false }` to inject every schema at connect (old behavior). `/context` tool-schemas line is the budget check.

## Status line

Default idle line: `$model · $mode · route:$route · sandbox:$sandbox$ctx_seg$sum_seg$mcp_seg`.

```json
"statusLine": {
  "template": "$model · $mode$ctx_seg$cost_seg",
  "command": "echo $MODEL $CTX"
}
```

`/statusline $model $cwd` sets it for the session. Tokens: `$model` `$mode` `$route` `$sandbox` `$ctx` `$ctx_seg` `$ctx_pct` `$sum` `$sum_seg` `$mcp` `$mcp_seg` `$deferred` `$cost` `$cost_seg` `$cwd`. Optional `command` runs through the sandbox (800ms) with the same tokens (`$MODEL` also works); first stdout line wins, else the template.

## Lifecycle hooks

```json
"hooks": {
  "PreToolUse": [{ "matcher": "bash", "command": "echo $TOOL_NAME" }],
  "UserPromptSubmit": [{ "command": "echo $PROMPT" }],
  "SessionStart": [{ "command": "echo session" }]
}
```

Commands run through the **sandbox** (`local` shell or docker). `matcher` is a case-insensitive regex against the tool name (`PreToolUse` / `PostToolUse`) or subagent type (`SubagentStart` / `SubagentStop`). Empty matcher = every event.

A **nonzero** exit on `PreToolUse` denies the tool (same as a permission deny). A nonzero `UserPromptSubmit` drops the prompt before it reaches the model. Other events never block.

| Event | When |
|---|---|
| `SessionStart` | First `run()` / TUI mount (once per Agent). |
| `UserPromptSubmit` | Before a user turn is appended. |
| `PreToolUse` / `PostToolUse` | Around each tool execution. |
| `SubagentStart` / `SubagentStop` | Around `task` / `/explore` / `/review` / workflow children. |
| `Stop` | When a `run()` returns (including interrupt). |
| `SessionEnd` | TUI exit / unmount, or hosted request finish. |

Substitutions: `$TOOL_NAME`, `$FILE` (input `path`), `$TOOL_INPUT` (JSON), `$PROMPT`, `$OUTPUT` (PostToolUse), `$SUBAGENT_TYPE`.

## Workflows

JSON files in `.polycode/workflows/` (project) or `~/.config/polycode/workflows/` (user). Project wins over user, user over bundled (`deep-research`). `/workflows` lists them; `/workflow <name> [query]` or `/workflow name slug=x leftover query` runs one.

```json
{
  "name": "review-changes",
  "description": "Explore, then cranky-review",
  "budget": 4,
  "parallel": [
    { "description": "scan", "subagent_type": "explore", "prompt": "Map $query. Read-only." }
  ],
  "steps": [
    { "description": "review", "subagent_type": "review", "prompt": "Review using:\n$results", "isolation": "none" }
  ],
  "synthesize": { "prompt": "Summarize:\n$results", "subagent_type": "general" }
}
```

`$query` / `$slug` / `$results` expand before each job. `isolation: "worktree"` gives that child a detached git worktree (not merged; `/worktree apply <id>` copies files onto the parent). The runner is TypeScript (`agent` / `parallel` / sequential `steps`), not Rhai. A panel that would exceed `budget` (default 16) launches none of its jobs.

`task isolation=worktree` also creates trees under `.polycode/worktrees/<id>`.

## Session / compaction

```json
"session": {
  "autoCompactThresholdPercent": 85,
  "keepRecentTurns": 8,
  "keepRecentToolResults": 6
}
```

| Field | Meaning |
|---|---|
| `autoCompactThresholdPercent` | Auto-compact when estimated tokens ≥ this % of the model window (default 85). |
| `keepRecentTurns` | Trailing user-turns kept verbatim in pass 2 (default 8). |
| `keepRecentToolResults` | Trailing tool messages kept intact in pass 1 (default 6). |

Pass 2 summaries use the **cheap** tier. `/compact [focus]` always runs; `/context` prints the breakdown. A shrink under 10% sticky-suppresses further auto-compacts.

## Routing

`@polycode/router` classifies each user turn into a tier, then builds (and memoizes) the
`Provider` for that tier. Two strategies:

**`heuristic`** (default, free) — a regex pass (`classify()`):

- context > ~200K tokens → **long**
- mentions refactor/architect/design/debug/optimize/migrate/plan/etc., or long prompt → **strong**
- otherwise → **cheap**

**`model`** — a cheap model (the `classifier` spec, default = the cheap tier) labels each
turn `cheap`/`strong`/`long`. It short-circuits huge context to `long` without a call,
memoizes per normalized prompt, and **falls back to the heuristic** on any error or
unparseable reply.

```json
"routing": {
  "strategy": "model",
  "classifier": { "provider": "google", "model": "gemini-2.5-flash" }
}
```

Override at launch with `--routing model` / `--routing heuristic`. In the TUI, toggle
per-turn auto-routing with `/route auto|off|status` (auto-routing is on by default when
`strategy` is `model`). When auto-routing, the chosen tier is shown per turn
(`routed → strong (openai:gpt-5.5)`).

Verify the model classifier against the heuristic on sample prompts:

```powershell
corepack pnpm route-check google:gemini-2.5-flash
```

## Keys & precedence

Key resolution order (first hit wins):

1. `process.env` (including a `.env` file you load)
2. OS keychain
3. `0600` file store in the user config dir

Env vars: `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `XAI_API_KEY`. See
[Security & Keys](security.md).

## CLI overrides

| Flag | Effect |
|---|---|
| `--model <provider:model>` | Force a specific model for the session. |
| `--tier <cheap\|strong\|long>` | Force a starting tier. |
| `--routing <heuristic\|model>` | Override the routing strategy. |
| `--sandbox <local\|docker>` | Override the tool-execution sandbox. |
| `--serve` | Run the HTTP+SSE server instead of the TUI (`POLYCODE_AUTH_TOKEN`). |
| `--port <n>` | Server port (default 8787). |
| `--host <addr>` | Bind address (default 127.0.0.1). |

## Hosted mode

```json
"hosted": {
  "mode": "plan",
  "rateLimit": { "windowMs": 60000, "max": 30, "concurrent": 2 },
  "maxBodyBytes": 1000000,
  "maxMessageChars": 32000,
  "trustProxy": false
}
```

See [Security & Keys](security.md). The serve path uses the same tools, compaction, hooks,
and permission rules as the TUI.

## Plugins

A plugin is a directory with `plugin.json` (or `.polycode-plugin/plugin.json`) plus any of
`skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `mcp.json`, `lsp.json`.

```
.polycode/plugins/hello/
  plugin.json
  commands/hello.md
  agents/greeter.md
```

Project plugins override user (`~/.config/polycode/plugins`). `"plugins": { "disable": ["hello"] }`
skips a name. Copy `examples/plugins/hello` to try. Slash skills from plugins show up in `/skills`;
agents become `task` `subagent_type`s.

## LSP

Copy `examples/lsp.json` to `.polycode/lsp.json` (or ship servers from a plugin). The `lsp` tool
is registered only when at least one server is configured. It speaks JSON-RPC stdio
(`hover` / `definition` / `references` / `documentSymbol`) and fail-softs if the binary is missing.
The language server reads the real project files (host process, not docker-jailed shell).

## IDE bridge

With `poly --serve`, an editor can:

1. `POST /ide/context` with the active file/selection
2. `POST /chat` — the snapshot is prepended as an `<ide>` block
3. `GET /ide/catalog` for tools/plugins

Same bearer/`X-Api-Key` as `/chat`.

## Sandbox

`sandbox` selects where tools execute (see [Security & Keys](security.md)):

```json
"sandbox": { "kind": "docker", "image": "node:22-alpine", "network": false, "memory": "1g" }
```

- `kind`: `local` (host shell, default) or `docker` (shell in an isolated container).
- `image` / `network` / `memory`: docker-only knobs. Override `kind` at launch with
  `--sandbox docker`. **Fails closed** if Docker is unavailable (no silent local fallback).

## Environment variables

| Var | Purpose |
|---|---|
| `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` / `XAI_API_KEY` | Provider keys (highest precedence). |
| `POLYCODE_CONFIG_DIR` | Override where the key file store + config live. |
