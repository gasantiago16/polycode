/**
 * Live smoke test — proves the canonical stream + a real tool round-trip
 * end-to-end against a real provider.
 *
 *   corepack pnpm smoke <provider:model>
 *   corepack pnpm smoke google:gemini-2.5-flash
 *
 * Reads keys from .env (OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / XAI_API_KEY).
 * Runs in "yolo" permission mode (no prompts) and asks the model to use the
 * `read` tool to fetch this repo's package.json "name" field.
 */
import { Agent, PermissionEngine } from "@polycode/core";
import { makeProvider, parseModelArg } from "@polycode/providers";
import { createSandbox } from "@polycode/sandbox";
import { tools } from "@polycode/tools";
import { hydrateEnv } from "@polycode/secrets";

// Load .env from cwd if present (Node 20.12+ / 21.7+), then pull any keys from
// the secure store (OS keychain / file) into the env the SDK reads.
try {
  (process as any).loadEnvFile?.();
} catch {
  /* no .env — rely on ambient env / secure store */
}
hydrateEnv();

async function main(): Promise<void> {
  const arg = process.argv[2] ?? process.env.POLYCODE_SMOKE_MODEL;
  if (!arg) {
    console.error('usage: corepack pnpm smoke <provider:model>  e.g. "google:gemini-2.5-flash"');
    process.exit(1);
  }

  const spec = parseModelArg(arg);
  const provider = makeProvider(spec);
  console.log(`\n▶ provider: ${provider.id}:${provider.model}`);
  console.log(`  caps: ${JSON.stringify(provider.capabilities())}\n`);

  const sandbox = await createSandbox({ kind: "local", root: process.cwd() });
  const engine = new PermissionEngine("yolo", async () => "once");
  const agent = new Agent(provider, tools, engine, {
    system: "You are a terminal coding agent. Use the `read` tool to inspect files before answering.",
    sandbox,
  });

  agent.pushUser(
    'Read the file "package.json" at the project root and tell me the exact value of its top-level "name" field. You must use the read tool.',
  );

  let sawText = false;
  let sawToolCall = false;
  let sawToolResult = false;

  for await (const ev of agent.run()) {
    switch (ev.type) {
      case "text_delta":
        sawText = true;
        process.stdout.write(ev.text);
        break;
      case "reasoning_delta":
        // ignore in this view
        break;
      case "tool_call":
        sawToolCall = true;
        console.log(`\n  → tool_call: ${ev.call.name}(${JSON.stringify(ev.call.input)})`);
        break;
      case "tool_executing":
        break;
      case "tool_result":
        sawToolResult = true;
        console.log(
          `  ← tool_result${ev.result.isError ? " (error)" : ""}: ${ev.result.output.slice(0, 120).replace(/\s+/g, " ")}…`,
        );
        break;
      case "tool_denied":
        console.log(`  ✗ denied: ${ev.reason}`);
        break;
      case "stop":
        break;
      case "turn_complete":
        console.log(
          `\n\n  usage: ${ev.usage ? `${ev.usage.inputTokens} in / ${ev.usage.outputTokens} out` : "n/a"}`,
        );
        break;
      case "error":
        console.error(`\n  ERROR: ${ev.error}`);
        process.exit(1);
    }
  }

  const ok = sawToolCall && sawToolResult && sawText;
  console.log(`\n${ok ? "✅ PASS" : "⚠️  PARTIAL"} — tool_call=${sawToolCall} tool_result=${sawToolResult} text=${sawText}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
