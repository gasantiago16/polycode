const PATTERNS: RegExp[] = [
  /\b(sk-ant-[A-Za-z0-9_-]{8,})/g,
  /\b(sk-[A-Za-z0-9_-]{16,})/g,
  /\b(xai-[A-Za-z0-9_-]{8,})/g,
  /\b(AIza[0-9A-Za-z_-]{20,})/g,
  /\b(ghp_[A-Za-z0-9]{20,})/g,
  /\b(github_pat_[A-Za-z0-9_]{20,})/g,
  /\b(Bearer\s+[A-Za-z0-9._\-+/=]{12,})/gi,
  /(-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----)/g,
  /\b([A-Z][A-Z0-9_]*(?:API|SECRET|TOKEN|PASSWORD|PRIVATE)_?KEY)\s*[:=]\s*['"]?([^\s'"]{8,})/gi,
];

export function redactSecrets(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const re of PATTERNS) {
    out = out.replace(re, (m) => {
      count++;
      return m.startsWith("-----") ? "[REDACTED PRIVATE KEY]" : "[REDACTED]";
    });
  }
  return { text: out, count };
}
