import { promises as fs } from "node:fs";
import { exec, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { resolve, relative, dirname, join, sep } from "node:path";
import type { Sandbox, ExecOptions, ExecResult } from "@polycode/core";

const pexec = promisify(exec);
const pexecFile = promisify(execFile);

const IGNORE = new Set(["node_modules", ".git", "dist", ".polycode"]);
const MAX_BUFFER = 10 * 1024 * 1024;

export type SandboxKind = "local" | "docker";

export interface SandboxConfig {
  kind?: SandboxKind;
  /** docker: image to run (default node:22-alpine). */
  image?: string;
  /** docker: allow network egress (default false). */
  network?: boolean;
  /** docker: memory limit, e.g. "1g" (default "1g"). */
  memory?: string;
}

export interface CreateSandboxOptions extends SandboxConfig {
  /** Absolute project root. */
  root: string;
}

// ---------------------------------------------------------------------------
// Local: host filesystem + host shell, path-jailed to the project root.
// ---------------------------------------------------------------------------
export class LocalSandbox implements Sandbox {
  constructor(private rootDir: string) {}

  get root(): string {
    return this.rootDir;
  }

  private resolveSafe(rel: string): string {
    const abs = resolve(this.rootDir, rel);
    const r = relative(this.rootDir, abs);
    if (r.startsWith("..") || r.split(sep).includes("..")) {
      throw new Error(`path escapes project root: ${rel}`);
    }
    return abs;
  }

  async readFile(rel: string): Promise<string> {
    return fs.readFile(this.resolveSafe(rel), "utf8");
  }

  async writeFile(rel: string, content: string): Promise<void> {
    const abs = this.resolveSafe(rel);
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }

  async exec(command: string, opts?: ExecOptions): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await pexec(command, {
        cwd: this.rootDir,
        timeout: opts?.timeoutMs ?? 120_000,
        signal: opts?.signal,
        maxBuffer: MAX_BUFFER,
      });
      return { stdout, stderr, code: 0 };
    } catch (e: any) {
      return {
        stdout: e?.stdout ?? "",
        stderr: [e?.stderr, e?.message].filter(Boolean).join("\n"),
        code: typeof e?.code === "number" ? e.code : 1,
      };
    }
  }

  async execFile(file: string, args: string[], opts?: ExecOptions): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await pexecFile(file, args, {
        cwd: this.rootDir,
        timeout: opts?.timeoutMs ?? 120_000,
        signal: opts?.signal,
        maxBuffer: MAX_BUFFER,
      });
      return { stdout, stderr, code: 0 };
    } catch (e: any) {
      return {
        stdout: e?.stdout ?? "",
        stderr: [e?.stderr, e?.message].filter(Boolean).join("\n"),
        code: typeof e?.code === "number" ? e.code : 1,
      };
    }
  }

  async *walk(): AsyncIterable<string> {
    yield* walkDir(this.rootDir, this.rootDir);
  }

  async dispose(): Promise<void> {
    /* nothing to clean up */
  }
}

// ---------------------------------------------------------------------------
// Docker: shell runs inside an isolated, locked-down container; file ops use
// the bind-mounted project (same files), so edits land for real.
// ---------------------------------------------------------------------------
export class DockerSandbox implements Sandbox {
  private files: LocalSandbox;

  private constructor(
    private rootDir: string,
    private containerId: string,
  ) {
    this.files = new LocalSandbox(rootDir);
  }

  static async create(opts: CreateSandboxOptions): Promise<DockerSandbox> {
    await ensureDocker();
    const image = opts.image ?? "node:22-alpine";
    const args = [
      "run",
      "-d",
      "--rm",
      "--network",
      opts.network ? "bridge" : "none",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      "512",
      "--memory",
      opts.memory ?? "1g",
      "-v",
      `${opts.root}:/work`,
      "-w",
      "/work",
      image,
      "sh",
      "-c",
      "sleep infinity",
    ];
    const { stdout } = await pexecFile("docker", args, { maxBuffer: MAX_BUFFER });
    const id = stdout.trim();
    const sb = new DockerSandbox(opts.root, id);
    sb.registerCleanup();
    return sb;
  }

  get root(): string {
    return `docker:${this.containerId.slice(0, 12)} (${this.rootDir})`;
  }

  // File ops operate on the bind-mounted project (host-side, path-jailed).
  readFile(rel: string): Promise<string> {
    return this.files.readFile(rel);
  }
  writeFile(rel: string, content: string): Promise<void> {
    return this.files.writeFile(rel, content);
  }
  walk(): AsyncIterable<string> {
    return this.files.walk();
  }

  async exec(command: string, opts?: ExecOptions): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await pexecFile(
        "docker",
        ["exec", this.containerId, "sh", "-lc", command],
        { timeout: opts?.timeoutMs ?? 120_000, signal: opts?.signal, maxBuffer: MAX_BUFFER },
      );
      return { stdout, stderr, code: 0 };
    } catch (e: any) {
      return {
        stdout: e?.stdout ?? "",
        stderr: [e?.stderr, e?.message].filter(Boolean).join("\n"),
        code: typeof e?.code === "number" ? e.code : 1,
      };
    }
  }

  async execFile(file: string, args: string[], opts?: ExecOptions): Promise<ExecResult> {
    try {
      // No `sh -c`: args go straight to the program inside the container.
      const { stdout, stderr } = await pexecFile(
        "docker",
        ["exec", this.containerId, file, ...args],
        { timeout: opts?.timeoutMs ?? 120_000, signal: opts?.signal, maxBuffer: MAX_BUFFER },
      );
      return { stdout, stderr, code: 0 };
    } catch (e: any) {
      return {
        stdout: e?.stdout ?? "",
        stderr: [e?.stderr, e?.message].filter(Boolean).join("\n"),
        code: typeof e?.code === "number" ? e.code : 1,
      };
    }
  }

  async dispose(): Promise<void> {
    try {
      await pexecFile("docker", ["rm", "-f", this.containerId]);
    } catch {
      /* already gone */
    }
  }

  /** Best-effort synchronous removal on process exit. */
  private registerCleanup(): void {
    const id = this.containerId;
    process.once("exit", () => {
      try {
        execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" });
      } catch {
        /* ignore */
      }
    });
    process.once("SIGINT", () => process.exit(130));
    process.once("SIGTERM", () => process.exit(143));
  }
}

async function ensureDocker(): Promise<void> {
  try {
    await pexecFile("docker", ["version", "--format", "{{.Server.Version}}"]);
  } catch {
    throw new Error("docker is not available (is Docker running and on PATH?)");
  }
}

async function* walkDir(dir: string, root: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walkDir(full, root);
    else yield relative(root, full).split(sep).join("/");
  }
}

/** Build a sandbox. Defaults to local; docker throws if Docker is unavailable. */
export async function createSandbox(opts: CreateSandboxOptions): Promise<Sandbox> {
  if ((opts.kind ?? "local") === "docker") return DockerSandbox.create(opts);
  return new LocalSandbox(opts.root);
}
