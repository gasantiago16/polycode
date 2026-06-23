# Providers & Models

Supported providers: **OpenAI**, **Google Gemini**, **xAI (Grok)**. (Anthropic is
intentionally out of scope for this project.)

All three are reached through one adapter over the Vercel AI SDK
(`@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/xai`), behind the canonical `Provider`
interface in `@polycode/core`.

## Current model IDs (confirmed June 2026)

> Model IDs churn. These were verified against provider docs in June 2026 — re-check before
> relying on them long-term.

| Provider | Good defaults | Cheaper / other | Newer |
|---|---|---|---|
| OpenAI | `gpt-5.5` (flagship) | `gpt-5.4-mini`, `gpt-5.4-nano` | — |
| Google | `gemini-2.5-flash`, `gemini-2.5-pro` | `gemini-2.5-flash-lite` | `gemini-3.5-flash`, `gemini-3.1-pro` |
| xAI | `grok-4.3` | `grok-code-fast-1` | — |

Notes:
- OpenAI's `gpt-5` is superseded by the 5.4/5.5 line.
- xAI's `grok-4` is retired (requests redirect to `grok-4.3`).
- Gemini `gemini-2.5-flash` is a safe, cheap smoke-test target.

## Selecting a model

- Per session: `--model openai:gpt-5.5`
- At runtime in the TUI: `/model google:gemini-2.5-pro`
- Per tier: edit `tiers` in `polycode.config.json` (see [Configuration](configuration.md))

The format is always `provider:model`, where provider is `openai`, `google`, or `xai`.

## Capabilities

Each provider reports a `Capabilities` object (context window, max output, tool/reasoning/
caching/vision/parallel flags) consumed by the loop. The numbers in
`packages/providers/src/index.ts` are estimates — confirm against provider docs and adjust.

## Reasoning effort

The canonical `reasoningEffort` knob (`low` | `medium` | `high`) maps per provider in the
adapter:

- OpenAI → `providerOptions.openai.reasoningEffort`
- xAI → `providerOptions.xai.reasoningEffort`
- Gemini → `providerOptions.google.thinkingConfig`

## Adding a new provider

1. Add the AI SDK provider package (e.g. `@ai-sdk/<x>`) to `@polycode/providers`.
2. In `packages/providers/src/index.ts`: extend `ProviderId`, add a `Capabilities` const,
   add a `case` in `makeProvider`, and accept it in `parseModelArg`.
3. Add it to `PROVIDERS` / `ENV_VAR` / labels in `@polycode/secrets` so the setup screen
   and key store know about it.
4. If it has a non-standard reasoning param, extend `reasoningOptions()` in the adapter.

No changes to the agent loop, tools, router, or UI are required.

> **AI SDK version note:** the adapter's `fullStream` part field names (`text-delta`,
> `reasoning-delta`, `tool-call`, `finish`) track AI SDK v5. Re-verify on a major SDK bump.
