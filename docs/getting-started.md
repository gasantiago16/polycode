# Getting Started

## Prerequisites

- **Node.js 20+** (developed on Node 24).
- **pnpm 9+** via Corepack (ships with Node).

> **Windows / Corepack gotcha:** on this project's dev box, `pnpm` is not on `PATH` and
> `corepack enable` can't write its shim to `C:\Program Files\nodejs` without admin. Run
> everything through Corepack's passthrough and target the repo with `-C`:
>
> ```powershell
> corepack pnpm -C "C:\Users\Gabriel Santiago\polycode" <command>
> ```
>
> To get a bare `pnpm` command, run `corepack enable` once from an **admin** PowerShell.

## Install

```powershell
corepack pnpm -C "C:\Users\Gabriel Santiago\polycode" install
```

## First run — secure key setup

Just launch the CLI. With no keys configured, it shows a **masked** setup screen:

```powershell
corepack pnpm -C "C:\Users\Gabriel Santiago\polycode" dev
```

- Paste an API key for any provider (input shows as `•••`), press **Enter**.
- Repeat for other providers, or press **Esc** to finish.
- Keys are stored in the **OS keychain** (Windows Credential Manager, DPAPI-backed) — never
  echoed, logged, or committed. See [Security & Keys](security.md).

Re-open the setup anytime with `/login`; check what's configured with `/keys`.

> **CI / power users:** environment variables and a `.env` file still work and take
> precedence over the keychain. Copy `.env.example` to `.env` and fill in keys.

## Force a model or tier

```powershell
corepack pnpm dev -- --model openai:gpt-5.5
corepack pnpm dev -- --model google:gemini-2.5-flash
corepack pnpm dev -- --tier cheap
```

## Hosted mode

```powershell
corepack pnpm serve -- --port 8787
# POST http://localhost:8787/chat   {"message":"..."}   -> SSE event stream
# GET  http://localhost:8787/health -> {"ok":true}
```

## Live smoke test

Proves the canonical stream + a real `read`-tool round-trip against a live provider. It reads
your key from the secure store (run the setup first):

```powershell
corepack pnpm smoke google:gemini-2.5-flash
corepack pnpm smoke openai:gpt-5.5
corepack pnpm smoke xai:grok-4.3
```

Prints each event and a final `PASS` / `PARTIAL`.

## Typecheck & docs

```powershell
corepack pnpm typecheck      # tsc --noEmit across the workspace
corepack pnpm docs           # regenerate docs/html from docs/*.md
```
