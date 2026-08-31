/**
 * Local beta / functionality log. Writes under `.polycode/beta-logs/` (gitignored).
 *
 *   corepack pnpm beta
 *   corepack pnpm beta -- --tester alex --smoke xai:grok-4.3
 *
 * Never prints API keys. Safe to share the log file with a buddy.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDotEnvFiles, envFileCandidates, hydrateEnv, getKey, PROVIDERS } from "@polycode/secrets";

const repo = join(import.meta.dirname, "..");
process.chdir(repo);
loadDotEnvFiles(envFileCandidates(repo));
hydrateEnv();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}
function has(flag: string): boolean {
  return process.argv.includes(flag);
}

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf8", cwd: repo }).trim();
  } catch {
    return "(unknown)";
  }
}

function run(label: string, cmd: string): { ok: boolean; output: string; ms: number } {
  const t0 = Date.now();
  try {
    const output = execSync(cmd, {
      encoding: "utf8",
      cwd: repo,
      maxBuffer: 4_000_000,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    return { ok: true, output, ms: Date.now() - t0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      output: `${err.stdout ?? ""}${err.stderr ?? err.message ?? String(e)}`,
      ms: Date.now() - t0,
    };
  }
}

function tail(s: string, lines = 40): string {
  const rows = s.replace(/\r\n/g, "\n").trim().split("\n");
  return rows.slice(-lines).join("\n");
}

function configuredProviders(): string[] {
  return PROVIDERS.filter((p) => !!getKey(p));
}

const CHECKLIST = `
## Manual TUI (buddy)

Copy this file, mark each item pass/fail, add notes. Do not paste API keys.

- [ ] Install: \`corepack pnpm install\` then \`corepack pnpm dev\`
- [ ] First-run: arrow to **xAI (Grok)**, Enter, paste key, Enter — lands in chat (not stuck on settings)
- [ ] \`/help\` overlay; type \`/mo\` + Tab completes
- [ ] Ask: "what is this repo?" — read/grep tools run, answer cites files
- [ ] \`/mode plan\` then ask to edit a file — writes refused
- [ ] \`/mode ask\` then a small edit — y/a/n prompt works
- [ ] \`/team add a comment to README\` — two explorers, then worktree implement (or a clear skip if not a git repo)
- [ ] \`/dashboard\` (or Ctrl+\\) — list children; Enter peek; \`a\` attach; Esc close
- [ ] Start a long turn, **Ctrl+B** — composer returns, children still in dashboard
- [ ] \`/loop 15s say ping\` — fires; \`/loop stop\` cancels
- [ ] \`/exit\` then \`corepack pnpm dev -- --continue\` — session resumes
- [ ] Unknown \`/hepl\` is **not** sent to the model (suggests /help)

### Notes

(what broke, what felt good, OS/terminal: Windows Terminal / macOS Terminal / …)

`;

function safeTester(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "anonymous").slice(0, 40);
}

async function main(): Promise<void> {
  const tester = safeTester(arg("--tester") ?? process.env.USERNAME ?? process.env.USER ?? "anonymous");
  const skipTests = has("--checklist-only");
  const smokeModel = has("--smoke") ? (arg("--smoke") ?? "xai:grok-4.3") : undefined;

  const dir = join(repo, ".polycode", "beta-logs");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = join(dir, `${stamp}_${tester}.md`);

  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push(`# polycode beta log`);
  push();
  push(`- **When:** ${new Date().toISOString()}`);
  push(`- **Tester:** ${tester}`);
  push(`- **Host:** ${process.platform} ${process.arch} · Node ${process.version}`);
  push(`- **Cwd:** ${repo}`);
  push(`- **Commit:** ${git("rev-parse --short HEAD")} (${git("log -1 --format=%s")})`);
  push(`- **Branch:** ${git("branch --show-current")}`);
  push(`- **Keys configured:** ${configuredProviders().join(", ") || "(none)"}`);
  push();
  push(`Logs stay in \`.polycode/beta-logs/\` (gitignored). Safe to send this file — it has no key values.`);
  push();

  const results: Array<{ name: string; ok: boolean; ms: number }> = [];

  if (!skipTests) {
    push(`## Automated`);
    push();
    const jobs: Array<[string, string]> = [
      ["typecheck", "corepack pnpm typecheck"],
      ["unit tests", "corepack pnpm test"],
    ];
    if (smokeModel) {
      jobs.push(["smoke " + smokeModel, `corepack pnpm smoke -- ${smokeModel}`]);
    }
    for (const [name, cmd] of jobs) {
      process.stderr.write(`beta-log: ${name} …\n`);
      const r = run(name, cmd);
      results.push({ name, ok: r.ok, ms: r.ms });
      push(`### ${name}: ${r.ok ? "PASS" : "FAIL"} (${(r.ms / 1000).toFixed(1)}s)`);
      push();
      push("```");
      push(tail(r.output, 50));
      push("```");
      push();
    }
    const failed = results.filter((r) => !r.ok);
    push(`**Automated summary:** ${results.filter((r) => r.ok).length}/${results.length} passed${failed.length ? ` · failed: ${failed.map((f) => f.name).join(", ")}` : ""}`);
    push();
  } else {
    push(`## Automated`);
    push();
    push(`(skipped — \`--checklist-only\`)`);
    push();
  }

  push(CHECKLIST.trim());
  push();
  push(`---`);
  push(`Share this file with Gabriel. Keep secrets out of Notes.`);

  const body = lines.join("\n");
  writeFileSync(file, body, "utf8");
  console.log(`wrote ${file}`);
  if (!skipTests) {
    writeFileSync(join(dir, "LATEST.md"), body, "utf8");
    console.log(`also  ${join(dir, "LATEST.md")}  (send this — last automated run)`);
  }
  if (results.length) {
    for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}  ${(r.ms / 1000).toFixed(1)}s`);
  }
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
