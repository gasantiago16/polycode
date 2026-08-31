# Providers & Models

polycode is **table-driven**. The agent loop never sees a vendor SDK. Add a row to
the catalog (`packages/providers/src/catalog.ts`); do not grow `makeProvider` with
one-off switch cases.

Pinned **2026-08-31**. IDs churn — `poly --models` prints the checked-in catalog.

## Built-in providers

| id | Kind | Default strong | Key | Base URL |
|---|---|---|---|---|
| `openai` | native OpenAI SDK | `gpt-5.5` | `OPENAI_API_KEY` | SDK default |
| `google` | native Google SDK | `gemini-3.1-pro` | `GOOGLE_GENERATIVE_AI_API_KEY` (alias `GEMINI_API_KEY`) | SDK default |
| `xai` | native xAI SDK | `grok-4.3` | `XAI_API_KEY` | SDK default |
| `muse` | OpenAI-compat | `muse-spark-1.2` | `MUSE_API_KEY` (alias `MODEL_API_KEY`) | `https://api.meta.ai/v1` (`MUSE_BASE_URL`) |
| `nvidia` | OpenAI-compat | `nvidia/nemotron-3-super-120b-a12b` | `NVIDIA_API_KEY` | `https://integrate.api.nvidia.com/v1` (`NVIDIA_BASE_URL`) |
| `qwen` | OpenAI-compat | `qwen3.8-max` | `DASHSCOPE_API_KEY` (alias `QWEN_API_KEY`) | DashScope intl (`QWEN_BASE_URL`) |
| `anthropic` | native Anthropic SDK | `claude-sonnet-4-5` | `ANTHROPIC_API_KEY` | SDK default |

`/model` is always `provider:model`. Slash-containing NVIDIA ids work:
`nvidia:nvidia/nemotron-3-nano-30b-a3b`.

List the catalog:

```powershell
corepack pnpm -C <repo> exec poly --models
# or from the CLI once built:  poly --models
```

In the TUI: `/model muse:muse-spark-1.2`.

## Two adapter kinds (only)

1. **OpenAI-compat** — `createOpenAI({ apiKey, baseURL })` wrapping the existing
   AI SDK adapter. Muse, NVIDIA NIM, Qwen, and `providers.custom` all use this.
2. **Native SDK** — `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/xai`, `@ai-sdk/anthropic`.

Anthropic uses the Messages API. Do not point Claude at an OpenAI base URL.

## Training-tier / Contributor policy

Models whose id contains `contributor` (e.g. `muse-spark-1.2-contributor`) **train
the vendor on prompts and completions**, including tool results. They are **refused
by default**.

```json
{
  "allowTrainingTiers": false,
  "providers": { "allow": ["openai", "google", "anthropic", "nvidia"] }
}
```

Set `allowTrainingTiers: true` only with an explicit legal opt-in. Company profile
should leave it false.

## On-prem NVIDIA NIM

Same provider id, different URL:

```powershell
$env:NVIDIA_BASE_URL = "http://127.0.0.1:8000/v1"
poly --model nvidia:meta/llama-3.3-70b-instruct
```

Llama/Qwen *hosted by NIM* stay `nvidia:<vendor>/<model>`. Direct DashScope/Muse
remain separate providers for keys that are not NIM.

## Custom OpenAI-compat (no code change)

```json
{
  "providers": {
    "custom": [{
      "id": "local-nim",
      "baseURL": "http://127.0.0.1:8000/v1",
      "envKey": "NVIDIA_API_KEY",
      "models": ["meta/llama-3.3-70b-instruct"]
    }]
  }
}
```

Then `/model local-nim:meta/llama-3.3-70b-instruct`.

## Reasoning effort

Canonical `low | medium | high` maps in the adapter:

- OpenAI / Muse / Qwen → `providerOptions.openai.reasoningEffort`
- xAI → `providerOptions.xai.reasoningEffort`
- Gemini → `providerOptions.google.thinkingConfig`
- Anthropic → `providerOptions.anthropic.thinking`

Muse Spark always reasons; do not send `"none"`.

## Adding a provider

OpenAI-compat (Groq, Together, vLLM): add a `providers.custom` row. No PR required.

First-class id (settings screen + catalog):

1. Add a `CatalogEntry` in `packages/providers/src/catalog.ts`.
2. If it is not OpenAI-compat, add one `kind` arm in `makeProvider` and an `@ai-sdk/*` dep.
3. Add the id to `@polycode/secrets` (`PROVIDERS`, `ENV_VAR`, label, key URL).
4. Extend `reasoningOptions()` if the vendor has a thinking knob.

No changes to the agent loop, tools, or TUI renderer.
