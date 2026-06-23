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

`@polycode/router` classifies each user turn with a heuristic (`classify()`):

- context > ~200K tokens → **long**
- mentions refactor/architect/design/debug/optimize/migrate/plan/etc., or long prompt → **strong**
- otherwise → **cheap**

It then builds (and memoizes) the `Provider` for that tier. Swap the heuristic body for a
model-driven classifier later without touching anything else.

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
