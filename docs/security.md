# Security & Keys

## Key storage

`@polycode/secrets` stores provider API keys in the most secure backend available:

1. **OS keychain** (preferred) — via `@napi-rs/keyring`. On Windows this is the Credential
   Manager, **DPAPI-backed** (encrypted at rest, scoped to your login). Verified active on
   the dev box.
2. **`0600` file fallback** — `credentials.json` in the user config dir
   (`%APPDATA%\polycode` on Windows, `~/.config/polycode` elsewhere) if the keychain module
   isn't available. Plaintext, but outside the repo and protected by user-profile ACLs /
   POSIX `0600`.

`backendName()` reports which is active; `storeLocation()` shows where.

## Resolution order

When the app needs a key it checks, in order:

1. `process.env` (including a loaded `.env`)
2. OS keychain
3. file store

`hydrateEnv()` copies stored keys into `process.env` (without overwriting existing values)
so the AI SDK provider factory — which reads env — can see them.

## What is never done with keys

- **Never echoed** — the setup screen masks input (`•`).
- **Never logged** — keys are not printed; Settings shows only each provider's status/source, never the value.
- **Never committed** — keys live in the keychain or the user config dir, not the repo.
  `.env` is git-ignored.
- **Never sent anywhere** except the chosen provider's own API.

## Permission modes (tool gating)

The agent gates every tool call by its `permission` class (`safe` | `mutating` |
`dangerous`) according to the active mode (`/mode <...>`):

| Mode | safe | mutating (write/edit) | dangerous (bash) |
|---|---|---|---|
| `plan` | allow | **refuse** | **refuse** |
| `ask` (default) | allow | prompt | prompt |
| `acceptEdits` | allow | allow | prompt |
| `yolo` | allow | allow | allow |

Deny rules and protected paths (`.env` / `.git` / `.ssh` / `.polycode`) run **before** the
safe-class short-circuit, so `Read(.env)` is refused even though `read` is `safe`. Use
`yolo` only in sandboxes / CI — the sandbox still jails those paths.

## No npmjs publish, no registry MCP

This workspace is `private`. There is no `npm publish` path. Ship the tsup bundle or the
Docker image from git.

MCP stdio servers must be a **local** command (`node ./mcp/foo.js`, a venv binary, …).
`npx`/`npm`/`pnpm`/`yarn`/`bunx` are rejected at connect so a checked-in `mcp.json` cannot
pull and execute a public package. HTTP MCP (`url`) is DNS-checked the same way as
`web_fetch` (no private/loopback/metadata) and still goes through the permission engine.

## Secret redaction

Tool outputs are scrubbed for `sk-` / `xai-` / `sk-ant-` / Google `AIza` / GitHub `ghp_` /
`Bearer` tokens, `*_API_KEY=` assignments, and PEM private keys **before** they enter
model history. This is leak-prevention for both logs and training-tier vendors.

## Tool path safety

Tools never touch Node's `fs`/`child_process` directly — all I/O goes through a `Sandbox`
(in `@polycode/core`). File ops are path-jailed to the project root (`..` traversal is
rejected). `bash` is classified `dangerous` and gated by the permission mode.

## Tool-execution sandbox

The `Sandbox` has two backends (`@polycode/sandbox`):

- **`local`** (default) — host filesystem + host shell, path-jailed. Fine for local,
  trusted use.
- **`docker`** — **shell commands run inside an isolated container**; file ops operate on
  the bind-mounted project, so edits still land in your real files. The container is
  locked down: `--network none` (no egress), `--cap-drop ALL`, `--security-opt
  no-new-privileges`, plus `--pids-limit` and `--memory` caps. The container is removed on
  exit.

Select it:

```powershell
corepack pnpm dev -- --sandbox docker          # or set "sandbox": { "kind": "docker" } in config
```

If `kind` is `docker` (or you pass `--sandbox docker`) and Docker isn't available, the CLI
**fails closed** — it does not silently fall back to `local`. Config knobs: `image`
(default `node:22-alpine`), `network` (default `false`), `memory` (default `1g`).

File tools and `sandbox.walk` refuse `.env` / `.env.*` / `.git` / `.ssh` / `.polycode`
(except `memory.md` and `reviews/`). `bash` commands that name those paths are refused even
in `yolo`. Child processes (bash, MCP stdio, LSP, git worktrees, hooks, statusLine) get
`process.env` with `*_KEY` / `*_TOKEN` / `*_SECRET` / `POLYCODE_AUTH_TOKEN*` stripped.

**Design note:** the sandbox isolates the *execution* surface (arbitrary shell), which is
the real risk. It does **not** isolate file edits from the project — that's intentional, so
the agent's changes apply where you want them. For fully untrusted use where edits must be
quarantined too, run on a disposable copy of the repo (or a git worktree).

## Hosted mode

`GET /health` and `/ready` stay public. Set `"hosted": { "trustProxy": true }` only behind
a trusted reverse proxy (`X-Forwarded-For`). Bind `127.0.0.1` locally; Docker images listen
on `0.0.0.0`. `poly --serve` is not a yolo scaffold:

- **Auth** — `POLYCODE_AUTH_TOKEN` (and optional comma-separated `POLYCODE_AUTH_TOKENS`),
  each at least 16 characters. Clients send `Authorization: Bearer` or `X-Api-Key`.
  Compare is SHA-256 + `timingSafeEqual`. `--insecure` skips auth and forces yolo — local
  scaffold only, never company networks.
- **Bind** — default `127.0.0.1`. Binding a non-loopback address without `--insecure`
  requires a docker sandbox (fail-closed). `"profile": "company"` forces docker + non-yolo.
- **Permissions** — no interactive prompt. `ask` becomes `plan`. `yolo` is refused unless
  `--insecure`. Docker defaults to `acceptEdits`; local defaults to `plan`.
- **Limits** — 1 MB body, 32k message, 5-minute turn abort, per-IP rate + concurrency.
  Failed auth counts toward the window.
- **Audit** — `.polycode/audit.jsonl` records `chat` / `tool` / `unauthorized` /
  `rate_limited` with `requestId` — no prompt or tool bodies.
- **Sessions** — transcripts omit raw image bytes.

`web_fetch` and HTTP MCP URLs are lexical-checked then DNS-resolved; any private /
loopback / link-local / metadata address is refused. Redirects are not followed.

Hooks remain user-configured shell (trusted config). They run through the sandbox with
secret env stripped; a nonzero `PreToolUse` / `UserPromptSubmit` denies the call.
