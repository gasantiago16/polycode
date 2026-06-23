/**
 * Verify the model-driven router classifier against the heuristic on sample
 * prompts (live — uses the classifier model you name).
 *
 *   corepack pnpm route-check google:gemini-2.5-flash
 *
 * Reads keys from .env / the secure store.
 */
import { ModelClassifier, HeuristicClassifier } from "@polycode/router";
import { makeProvider, parseModelArg } from "@polycode/providers";
import { hydrateEnv } from "@polycode/secrets";

try {
  (process as any).loadEnvFile?.();
} catch {
  /* rely on env / secure store */
}
hydrateEnv();

const SAMPLES = [
  "fix the typo in the README heading",
  "what is the name field in package.json?",
  "rename the variable foo to bar in utils.ts",
  "refactor the auth module to use dependency injection and add unit tests",
  "debug why the build fails intermittently and propose a root-cause fix",
  "read the whole repository and summarize the overall architecture",
];

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: corepack pnpm route-check <provider:model>  (e.g. google:gemini-2.5-flash)");
    process.exit(1);
  }

  const provider = makeProvider(parseModelArg(arg));
  const model = new ModelClassifier(provider);
  const heuristic = new HeuristicClassifier();

  console.log(`\nclassifier: ${provider.id}:${provider.model}\n`);
  for (const s of SAMPLES) {
    const [m, h] = await Promise.all([model.classify(s), heuristic.classify(s)]);
    const flag = m === h ? "  " : "≠ ";
    console.log(`${flag}model=${m.padEnd(7)} heuristic=${h.padEnd(7)} ${s.slice(0, 64)}`);
  }
  console.log("\n(≠ marks where the model disagrees with the heuristic)\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
