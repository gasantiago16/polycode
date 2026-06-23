import { defineConfig } from "tsup";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

// Paths/externals resolved relative to THIS config file, so the build works
// whether tsup runs from the cli dir or the repo root
// (`tsup --config packages/cli/tsup.config.ts`).
const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

// Externalize the CLI's declared third-party deps (installed from npm at runtime);
// internal @polycode/* packages are devDependencies and get bundled in.
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
];

export default defineConfig({
  entry: { index: join(here, "src/index.ts") },
  outDir: join(here, "dist"),
  format: ["esm"],
  platform: "node",
  target: "node20",
  splitting: false,
  clean: true,
  dts: false,
  sourcemap: false,
  external,
  noExternal: [/^@polycode\//],
  banner: { js: "#!/usr/bin/env node" },
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
