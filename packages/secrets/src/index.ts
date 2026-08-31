import { createRequire } from "node:module";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ProviderId =
  | "openai"
  | "google"
  | "xai"
  | "muse"
  | "nvidia"
  | "qwen"
  | "anthropic";

export const PROVIDERS: ProviderId[] = [
  "openai",
  "google",
  "xai",
  "muse",
  "nvidia",
  "qwen",
  "anthropic",
];

export const ENV_VAR: Record<ProviderId, string> = {
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  xai: "XAI_API_KEY",
  muse: "MUSE_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  qwen: "DASHSCOPE_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

/** Extra env names accepted when reading (hydrate copies them onto ENV_VAR). */
export const ENV_ALIASES: Partial<Record<ProviderId, string[]>> = {
  google: ["GEMINI_API_KEY"],
  xai: ["GROK_API_KEY"],
  muse: ["MODEL_API_KEY"],
  qwen: ["QWEN_API_KEY"],
};

/** Names a project `.env` is allowed to inject. Provider keys only. */
export function dotenvAllowlist(): Set<string> {
  const s = new Set<string>(Object.values(ENV_VAR));
  for (const aliases of Object.values(ENV_ALIASES)) {
    for (const a of aliases ?? []) s.add(a);
  }
  return s;
}

export function isDotEnvKeyAllowed(name: string): boolean {
  if (!dotenvAllowlist().has(name)) return false;
  const n = name.toUpperCase();
  if (n.startsWith("POLYCODE_AUTH_TOKEN")) return false;
  if (
    n === "NODE_OPTIONS" ||
    n === "NODE_PATH" ||
    n === "NODE_EXTRA_CA_CERTS" ||
    n === "PATH" ||
    n.startsWith("LD_") ||
    n.startsWith("DYLD_") ||
    n.startsWith("PYTHON") ||
    n === "HTTP_PROXY" ||
    n === "HTTPS_PROXY" ||
    n === "ALL_PROXY" ||
    n === "NO_PROXY"
  ) {
    return false;
  }
  return true;
}

function resolvedInside(file: string, root: string): boolean {
  try {
    const a = realpathSync(root).replace(/\\/g, "/").toLowerCase();
    const b = realpathSync(file).replace(/\\/g, "/").toLowerCase();
    return b === a || b.startsWith(a.endsWith("/") ? a : `${a}/`);
  } catch {
    return false;
  }
}

const LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  google: "Google Gemini",
  xai: "xAI (Grok)",
  muse: "Meta Muse",
  nvidia: "NVIDIA NIM",
  qwen: "Qwen (DashScope)",
  anthropic: "Anthropic",
};

const KEY_URLS: Record<ProviderId, string> = {
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/app/apikey",
  xai: "https://console.x.ai/",
  muse: "https://ai.developer.meta.com/",
  nvidia: "https://build.nvidia.com/",
  qwen: "https://modelstudio.console.alibabacloud.com/",
  anthropic: "https://console.anthropic.com/settings/keys",
};

export function label(p: ProviderId): string {
  return LABELS[p];
}

/** Web page where a user creates an API key for a provider. */
export function keyUrl(p: ProviderId): string {
  return KEY_URLS[p];
}

const SERVICE = "polycode";

// ---- Optional OS-keychain backend (DPAPI-backed on Windows) --------------
// Loaded via createRequire so a missing/native-incompatible module just falls
// back to the file store instead of crashing the app.
const require = createRequire(import.meta.url);
let KeyringEntry: any = null;
try {
  KeyringEntry = require("@napi-rs/keyring").Entry;
} catch {
  KeyringEntry = null;
}

export type Backend = "keychain" | "file";

export function backendName(): Backend {
  return KeyringEntry ? "keychain" : "file";
}

// ---- File fallback store --------------------------------------------------
const configDir =
  process.env.POLYCODE_CONFIG_DIR ??
  join(process.env.APPDATA ?? join(homedir(), ".config"), "polycode");
const credFile = join(configDir, "credentials.json");

export function storeLocation(): string {
  return KeyringEntry ? `OS keychain · service "${SERVICE}"` : credFile;
}

function readFileStore(): Partial<Record<ProviderId, string>> {
  try {
    return JSON.parse(readFileSync(credFile, "utf8"));
  } catch {
    return {};
  }
}

function writeFileStore(store: Partial<Record<ProviderId, string>>): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(credFile, JSON.stringify(store, null, 2), { mode: 0o600 });
  try {
    chmodSync(credFile, 0o600); // no-op on Windows; user-profile ACLs apply there
  } catch {
    /* ignore */
  }
}

// ---- Public API -----------------------------------------------------------

function envLookup(p: ProviderId): string | undefined {
  const primary = process.env[ENV_VAR[p]];
  if (primary) return primary;
  for (const a of ENV_ALIASES[p] ?? []) {
    const v = process.env[a];
    if (v) return v;
  }
  return undefined;
}

/** Resolution order: process env (incl. aliases / .env) → OS keychain → file store. */
export function getKey(p: ProviderId): string | undefined {
  const env = envLookup(p);
  if (env) return env;

  if (KeyringEntry) {
    try {
      const v = new KeyringEntry(SERVICE, p).getPassword();
      if (v) return v;
    } catch {
      /* fall through */
    }
  }
  return readFileStore()[p] || undefined;
}

/** Persist a key to the most secure backend available. Returns which was used. */
export function setKey(p: ProviderId, value: string): Backend {
  if (KeyringEntry) {
    try {
      new KeyringEntry(SERVICE, p).setPassword(value);
      return "keychain";
    } catch {
      /* fall through to file */
    }
  }
  const store = readFileStore();
  store[p] = value;
  writeFileStore(store);
  return "file";
}

export function deleteKey(p: ProviderId): void {
  if (KeyringEntry) {
    try {
      new KeyringEntry(SERVICE, p).deletePassword();
    } catch {
      /* ignore */
    }
  }
  const store = readFileStore();
  delete store[p];
  writeFileStore(store);
}

export function configured(): ProviderId[] {
  return PROVIDERS.filter((p) => !!getKey(p));
}

export type KeySource = "env" | "keychain" | "file" | "none";

/** Where the active key for a provider is coming from (mirrors getKey order). */
export function keySource(p: ProviderId): KeySource {
  if (envLookup(p)) return "env";
  if (KeyringEntry) {
    try {
      if (new KeyringEntry(SERVICE, p).getPassword()) return "keychain";
    } catch {
      /* fall through */
    }
  }
  if (readFileStore()[p]) return "file";
  return "none";
}

/**
 * Persist any keys present in the environment into the secure store so they
 * survive without the env var. Returns the providers imported.
 */
export function importFromEnv(): ProviderId[] {
  const imported: ProviderId[] = [];
  for (const p of PROVIDERS) {
    const v = envLookup(p);
    if (v) {
      setKey(p, v);
      imported.push(p);
    }
  }
  return imported;
}

/**
 * Copy stored keys into process.env so the AI SDK provider factory (which reads
 * env) can see them. Does not overwrite an existing env/.env value. Also fills
 * aliases (GROK_API_KEY, MODEL_API_KEY, …) so compat endpoints see the key.
 */
export function hydrateEnv(): void {
  for (const p of PROVIDERS) {
    const v = getKey(p);
    if (!v) continue;
    if (!process.env[ENV_VAR[p]]) process.env[ENV_VAR[p]] = v;
    for (const a of ENV_ALIASES[p] ?? []) {
      if (!process.env[a]) process.env[a] = v;
    }
  }
}

export function envFileCandidates(cwd: string): string[] {
  return [join(cwd, ".env"), join(configDir, ".env")];
}

/** Load KEY=VALUE lines from `.env` files. Existing process.env wins. */
export function loadDotEnvFiles(files: string[]): string[] {
  const loaded: string[] = [];
  for (const f of files) {
    if (!existsSync(f)) continue;
    try {
      const st = lstatSync(f);
      if (st.isDirectory() || st.isSocket?.() || st.isFIFO?.()) continue;
    } catch {
      continue;
    }
    if (!resolvedInside(f, dirname(f))) continue;
    let text: string;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (text.length > 64_000) text = text.slice(0, 64_000);
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      if (!isDotEnvKeyAllowed(m[1])) continue;
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[m[1]] == null || process.env[m[1]] === "") process.env[m[1]] = val;
    }
    loaded.push(f);
  }
  return loaded;
}
