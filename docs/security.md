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

File tools resolve paths against the working directory and reject paths that escape the
project root (`..` traversal). `bash` is classified `dangerous` and gated accordingly.

## Hosted-mode caveats (before exposing the server)

The scaffold server runs tools in `yolo` mode in its own working directory. **Before any
real deployment:**

- Add authentication and per-request/per-session permission policy.
- Run tool execution inside a **sandbox** (container / Vercel Sandbox / microVM), not the
  host filesystem.
- Apply rate limiting and audit logging.

These are tracked in [Continuity / Handoff](continuity.md).
