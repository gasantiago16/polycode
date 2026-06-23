import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ProviderId = "openai" | "google" | "xai";

export const PROVIDERS: ProviderId[] = ["openai", "google", "xai"];

export const ENV_VAR: Record<ProviderId, string> = {
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  xai: "XAI_API_KEY",
};

const LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  google: "Google Gemini",
  xai: "xAI (Grok)",
};

const KEY_URLS: Record<ProviderId, string> = {
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/app/apikey",
  xai: "https://console.x.ai/",
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

/** Resolution order: process env (incl. .env) → OS keychain → file store. */
export function getKey(p: ProviderId): string | undefined {
  const env = process.env[ENV_VAR[p]];
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
  if (process.env[ENV_VAR[p]]) return "env";
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
    const v = process.env[ENV_VAR[p]];
    if (v) {
      setKey(p, v);
      imported.push(p);
    }
  }
  return imported;
}

/**
 * Copy stored keys into process.env so the AI SDK provider factory (which reads
 * env) can see them. Does not overwrite an existing env/.env value.
 */
export function hydrateEnv(): void {
  for (const p of PROVIDERS) {
    if (process.env[ENV_VAR[p]]) continue;
    const v = getKey(p);
    if (v) process.env[ENV_VAR[p]] = v;
  }
}
