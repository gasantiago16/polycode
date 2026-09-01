# Packages

A pnpm monorepo. Packages depend inward toward `core`; nothing in `core` depends on a
provider, transport, or UI.

```
cli ─┬─ tui ──┬─ core
     │         ├─ secrets
     │         ├─ workflows ── core
     │         └─ graph ────── core
     ├─ providers ── core
     ├─ router ──── providers, core
     ├─ tools ───── core
     ├─ plugins ─── core, skills
     ├─ lsp ─────── core
     ├─ sandbox ─── core
     ├─ secrets
     └─ server ──── router, tools, core
```

## `@polycode/core`

The provider-blind heart. No external deps.

- `types.ts` — canonical types: `CanonicalMessage`, `ContentPart`, `CanonicalEvent`,
  `StopReason`, `ToolSpec`, `Capabilities`, `GenerateRequest`, `Provider`.
- `permissions.ts` — `PermissionEngine` + `PermissionMode` (plan/ask/acceptEdits/yolo).
- `agent.ts` — `Agent` (the loop) emitting `AgentUIEvent`s.
- `hooks.ts` — lifecycle hook runner (`PreToolUse` deny, `$TOOL_NAME` / `$FILE` / `$PROMPT`, …).
- `memory.ts` — curated `.polycode/memory.md` read/append/replace.
- `images.ts` — `@file.png` → `ImagePart` (base64).

## `@polycode/providers`

- `ai-sdk-provider.ts` — `createAiSdkProvider()`: the only AI-SDK-aware code. Maps canonical
  ⇄ AI SDK (`fullStream`, `ModelMessage`, `ToolSet`), plus `reasoningOptions()` per provider.
- `index.ts` — `makeProvider({provider, model})`, `parseModelArg("provider:model")`,
  per-provider `Capabilities`. Deps: `ai`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/xai`.

## `@polycode/router`

- `classify(text, contextTokens)` → `cheap | strong | long`.
- `Router` builds + memoizes a `Provider` per tier from `RouterConfig`.

## `@polycode/tools`

The default tool registry (`tools`), each a `ToolSpec` with a permission class:

| Tool | Class | Notes |
|---|---|---|
| `read` | safe | UTF-8 file read, path-jailed to the project root |
| `write` | mutating | create/overwrite a file |
| `edit` | mutating | exact-string replace (errors if absent) |
| `bash` | dangerous | shell command with timeout |
| `grep` | safe | regex over file contents |
| `glob` | safe | simple `*`/`**` file matching |
| `memory` | mutating | curated `.polycode/memory.md` (`read`/`append`/`replace`) |

## `@polycode/sandbox`

Tool-execution backends implementing core's `Sandbox`: `LocalSandbox` (host shell,
path-jailed) and `DockerSandbox` (shell in a locked-down container, file ops on the
bind-mount). `createSandbox({ kind, root, ... })`. See [Security & Keys](security.md).
`ToolContext` carries a `Sandbox`, so tools do no direct `fs`/`child_process`.
`addGitWorktree` / `applyGitWorktree` / `listGitWorktrees` / `removeGitWorktree`
manage detached trees under `.polycode/worktrees/`.

## `@polycode/secrets`

Secure key store: `getKey` / `setKey` / `deleteKey` / `configured` / `hydrateEnv` /
`backendName` / `storeLocation`. Optional dep `@napi-rs/keyring` (keychain); `0600` file
fallback. See [Security & Keys](security.md).

## `@polycode/tui`

Claude-Code-style Ink UI. `Root` orchestrates Settings vs. the app; `Settings` handles keys
(masked paste · env import · open key page · validate · agentic hook); `App` is the chat loop
(welcome `Banner`, `⏺`/`⎿` tool rendering, `Markdown` assistant output, bordered composer,
spinner with elapsed + esc-to-interrupt, `$token` status line, slash commands); `theme.ts` holds the
accent/glyph palette. Deps: `ink`, `ink-text-input`, `ink-spinner`, `react`,
`@polycode/core`, `@polycode/secrets`.

## `@polycode/workflows`

Budgeted TypeScript runner: `runParallel` / `runSequential` / `runWorkflowFile`
plus JSON loaders (`loadWorkflows`). Host is `spawnChild`. Not Rhai.

## `@polycode/graph`

LangGraph-shaped state machine on the existing loop: JSON graphs, reducers, conditional
edges, file checkpointer (`.polycode/graph-runs/`). Nodes are `spawnChild` agents. Not
`@langchain/langgraph`. See [graph.md](graph.md).

## `@polycode/plugins`

`loadPlugins(cwd)` reads `.polycode/plugins/<name>/` and user plugins. A bundle can ship
skills, slash commands, extra `task` agents, hooks, MCP servers, and LSP server configs.

## `@polycode/lsp`

JSON-RPC stdio client + `createLspTool`. Registered only when `.polycode/lsp.json` or a
plugin `lsp.json` lists a server. Host-side (not docker-jailed).

## `@polycode/server`

`startServer()` — Node `http` server exposing the same engine over `POST /chat` (SSE) and
`GET /health`. Bearer / `X-Api-Key`, hosted permission policy, rate limits, body caps,
audit JSONL, IDE bridge (`/ide/*`). Deps: `@polycode/{core,router,tools}`.

## `@polycode/cli`

Entry point: parse flags, load config, `hydrateEnv()`, then either `startTui(...)` or
`startServer(...)`. `bin: poly` (after `build`).

## Tooling

- Root scripts: `dev`, `serve`, `smoke`, `typecheck`, `docs`, `build`.
- Dev deps: `tsx` (run TS directly), `typescript`, `tsup` (bundle), `marked` (docs HTML).
- Dev packages use `main`/`exports` → `src/index.ts` so `tsx` resolves source directly.
