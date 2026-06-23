# Packages

A pnpm monorepo. Packages depend inward toward `core`; nothing in `core` depends on a
provider, transport, or UI.

```
cli ─┬─ tui ──┬─ core
     │         └─ secrets
     ├─ providers ── core
     ├─ router ──── providers, core
     ├─ tools ───── core
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

## `@polycode/sandbox`

Tool-execution backends implementing core's `Sandbox`: `LocalSandbox` (host shell,
path-jailed) and `DockerSandbox` (shell in a locked-down container, file ops on the
bind-mount). `createSandbox({ kind, root, ... })`. See [Security & Keys](security.md).
`ToolContext` carries a `Sandbox`, so tools do no direct `fs`/`child_process`.

## `@polycode/secrets`

Secure key store: `getKey` / `setKey` / `deleteKey` / `configured` / `hydrateEnv` /
`backendName` / `storeLocation`. Optional dep `@napi-rs/keyring` (keychain); `0600` file
fallback. See [Security & Keys](security.md).

## `@polycode/tui`

Ink UI. `Root` orchestrates first-run setup vs. the app; `Setup` is the masked key prompt;
`App` is the chat loop (streaming render, permission prompt, slash commands). Deps: `ink`,
`ink-text-input`, `react`, `@polycode/core`, `@polycode/secrets`.

## `@polycode/server`

`startServer()` — Node `http` server exposing the same engine over `POST /chat` (SSE) and
`GET /health`. Deps: `@polycode/{core,router,tools}`.

## `@polycode/cli`

Entry point: parse flags, load config, `hydrateEnv()`, then either `startTui(...)` or
`startServer(...)`. `bin: poly` (after `build`).

## Tooling

- Root scripts: `dev`, `serve`, `smoke`, `typecheck`, `docs`, `build`.
- Dev deps: `tsx` (run TS directly), `typescript`, `tsup` (bundle), `marked` (docs HTML).
- Dev packages use `main`/`exports` → `src/index.ts` so `tsx` resolves source directly.
