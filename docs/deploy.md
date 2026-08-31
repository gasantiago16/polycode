# Build & Deploy

## Build the CLI bundle

`tsup` bundles the CLI into a single self-contained ESM file at
`packages/cli/dist/index.js` (with a `#!/usr/bin/env node` shebang). Internal
`@polycode/*` packages are bundled in; third-party deps (ai, ink, react, …) stay external
and are installed from the lockfile for local/Docker runs. This repo is **not** published
to npmjs.com.

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

## Distribute (not npmjs)

Do not `npm publish`. The CLI package is `private`. Ship the local bundle or the Docker image.

```powershell
corepack pnpm build
node packages/cli/dist/index.js
# or: corepack pnpm -C packages/cli link --global  →  poly
```

## Server Docker image

Multi-stage `Dockerfile`: builds the CLI bundle, runs as `USER node`, listens on `0.0.0.0:8787`,
and HEALTHCHECKs `/health`. Mount the project at `/work`.

```powershell
docker build -t polycode-server .
docker run --rm -p 8787:8787 `
  -e POLYCODE_AUTH_TOKEN=change-me-now-16 `
  -e OPENAI_API_KEY=sk-... `
  -v ${PWD}:/work `
  polycode-server
# POST http://localhost:8787/chat  Authorization: Bearer change-me-now-16  {"message":"..."}
# GET  http://localhost:8787/health
```

Without `POLYCODE_AUTH_TOKEN` the process exits. Pass `--insecure` only for local scaffolds.
Inside the image, tools use the **local** sandbox — the container is the isolation boundary.
For untrusted multi-tenant use, spawn one container per session. Rate limits and audit JSONL
are on by default.
