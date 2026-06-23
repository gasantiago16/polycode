# Build & Deploy

## Build the CLI bundle

`tsup` bundles the CLI into a single self-contained ESM file at
`packages/cli/dist/index.js` (with a `#!/usr/bin/env node` shebang). Internal
`@polycode/*` packages are bundled in; third-party deps (ai, ink, react, …) stay external
and ship as the published package's `dependencies`.

```powershell
corepack pnpm -C "C:\Users\Gabriel Santiago\polycode" build
# → packages/cli/dist/index.js
```

## Run / install locally

```powershell
node packages/cli/dist/index.js            # run the bundle directly (TUI)
node packages/cli/dist/index.js --serve    # server mode

# or link the `poly` bin globally from the cli package:
corepack pnpm -C packages/cli link --global
poly                                        # then just run `poly`
```

## Publish (manual — your step)

`@polycode/cli` is configured to publish (`bin: poly`, `files: ["dist"]`,
`prepublishOnly` builds). Publishing is an outward action under your own npm account/scope:

```powershell
cd packages/cli
npm version <patch|minor|major>
npm publish --access public      # choose your scope/visibility
```

Internal `@polycode/*` packages are `private` and stay unpublished — they're bundled into
the CLI, so consumers only install the third-party runtime deps.

## Server Docker image

The repo root has a multi-stage `Dockerfile` that builds the bundle and runs it in `--serve`
mode.

```powershell
docker build -t polycode-server .
docker run --rm -p 8787:8787 -e OPENAI_API_KEY=sk-... polycode-server
# POST http://localhost:8787/chat  {"message":"..."}   (SSE)
# GET  http://localhost:8787/health
```

Pass provider keys via env (`OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` /
`XAI_API_KEY`). Routing strategy + sandbox come from `polycode.config.json` (bake it into the
image or mount it).

> **Isolation note:** inside the container, tools use the default `local` sandbox — the
> container itself is the boundary. For untrusted multi-tenant use, front the server with an
> orchestrator that spawns one container per session, and add auth + rate limiting (see
> [Security & Keys](security.md) and [Continuity](continuity.md)).

> **Not built in CI yet** — the Dockerfile is provided but hasn't been image-built/pushed
> from this repo; verify `docker build` in your environment before relying on it.
