/** Env names that must not leak into bash / MCP / LSP / hook children. */
export function isSecretEnvName(name: string): boolean {
  const n = name.toUpperCase();
  if (n === "POLYCODE_AUTH_TOKEN" || n === "POLYCODE_AUTH_TOKENS") return true;
  if (n === "AWS_ACCESS_KEY_ID" || n === "AWS_SECRET_ACCESS_KEY" || n === "AWS_SESSION_TOKEN") return true;
  return /(_SECRET|_TOKEN|_PASSWORD|_PASSWD|_PRIVATE_KEY|_CREDENTIALS?|_AUTHORIZATION|_KEY)$/.test(n);
}

/** Loader/process-injection names that must not reach spawned node/npm. */
export function isUnsafeChildEnvName(name: string): boolean {
  const n = name.toUpperCase();
  return (
    n === "NODE_OPTIONS" ||
    n === "NODE_PATH" ||
    n === "NODE_EXTRA_CA_CERTS" ||
    n.startsWith("LD_") ||
    n.startsWith("DYLD_")
  );
}

/**
 * Copy `process.env` minus secret-looking names.
 * `overrides` are applied last (explicit MCP env) except the hosted auth tokens,
 * which never leave the parent process.
 */
export function childProcessEnv(overrides?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null || isSecretEnvName(k) || isUnsafeChildEnvName(k)) continue;
    out[k] = v;
  }
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (v == null) continue;
      const n = k.toUpperCase();
      if (n === "POLYCODE_AUTH_TOKEN" || n === "POLYCODE_AUTH_TOKENS") continue;
      if (isUnsafeChildEnvName(k)) continue;
      out[k] = v;
    }
  }
  return out;
}
