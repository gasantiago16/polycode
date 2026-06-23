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

Each tier is `{ "provider": "openai" | "google" | "xai", "model": "<id>" }`.
See [Providers & Models](providers.md) for current IDs.

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
| `--serve` | Run the HTTP+SSE server instead of the TUI. |
| `--port <n>` | Server port (default 8787). |

## Environment variables

| Var | Purpose |
|---|---|
| `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` / `XAI_API_KEY` | Provider keys (highest precedence). |
| `POLYCODE_CONFIG_DIR` | Override where the key file store + config live. |
