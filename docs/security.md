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
- **Never logged** — keys are not printed; `/keys` shows provider names only, never values.
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

Use `yolo` only in sandboxes / CI.

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

If Docker isn't available, the CLI **prints a warning and falls back to `local`** so the
app still runs. Config knobs: `image` (default `node:22-alpine`), `network` (default
`false`), `memory` (default `1g`).

**Design note:** the sandbox isolates the *execution* surface (arbitrary shell), which is
the real risk. It does **not** isolate file edits from the project — that's intentional, so
the agent's changes apply where you want them. For fully untrusted use where edits must be
quarantined too, run on a disposable copy of the repo.

## Hosted-mode caveats (before exposing the server)

The scaffold server runs tools in `yolo` mode, contained by the sandbox you pass it (use a
`docker` sandbox there). **Still required before real deployment:**

- Per-request authentication and per-session permission policy.
- A `docker` (or stronger) sandbox — don't expose a `local` sandbox to untrusted input.
- Rate limiting and audit logging.

These are tracked in [Continuity / Handoff](continuity.md).
