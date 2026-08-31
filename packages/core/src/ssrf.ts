import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

export type DnsLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const BLOCKED_NAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.com",
  "metadata.goog",
]);

/** Last 32 bits of an IPv4-mapped IPv6 (`::ffff:127.0.0.1` or Node's `::ffff:7f00:1`). */
function ipv4MappedDotted(a: string): string | null {
  const dotted = a.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted) return dotted[1];
  const hex = a.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

/** True if an IPv4/IPv6 address is loopback, private, link-local, or metadata. */
export function isBlockedIp(addr: string): boolean {
  const a = addr.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = ipv4MappedDotted(a);
  if (mapped) return isBlockedIp(mapped);
  const v4 = dottedIPv4(a);
  if (v4) {
    const [b0, b1] = v4;
    if (b0 === 0 || b0 === 10 || b0 === 127) return true;
    if (b0 === 169 && b1 === 254) return true;
    if (b0 === 192 && b1 === 168) return true;
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    if (b0 >= 224) return true; // multicast / reserved
    return false;
  }
  if (isIP(a) === 6) {
    if (a === "::" || a === "::1" || a === "0:0:0:0:0:0:0:0" || a === "0:0:0:0:0:0:0:1") return true;
    if (a.startsWith("fe80:") || a.startsWith("ff")) return true; // link-local / multicast
    if (a.startsWith("fc") || a.startsWith("fd")) return true; // unique local
    return false;
  }
  return false;
}

function dottedIPv4(host: string): [number, number, number, number] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const oct = m.slice(1).map(Number) as [number, number, number, number];
  if (oct.some((n) => n > 255)) return null;
  if (m.slice(1).some((s) => s.length > 1 && s.startsWith("0"))) return null; // reject octal
  return oct;
}

function isNonCanonicalIpHostname(host: string): boolean {
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  if (/^\d+$/.test(host)) return true; // decimal IPv4
  if (/^\d+\.\d+$/.test(host) || /^\d+\.\d+\.\d+$/.test(host)) return true; // abbreviated
  // 4-dot numeric that isn't a canonical dotted IPv4 (octal, overflow)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && !dottedIPv4(host)) return true;
  return false;
}

function canonicalHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
}

/** Lexical URL check (no DNS). */
export function assertSafeHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`invalid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`blocked protocol ${u.protocol} (http/https only)`);
  }
  const host = canonicalHost(u.hostname);
  if (!host) throw new Error("blocked empty host");
  if (BLOCKED_NAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error(`blocked host ${host}`);
  }
  if (isNonCanonicalIpHostname(host)) {
    throw new Error(`blocked non-canonical IP host ${host}`);
  }
  if (isBlockedIp(host)) throw new Error(`blocked address ${host}`);
  return u;
}

/** Lexical check plus DNS: every resolved address must be public. */
export async function assertPublicHttpUrl(raw: string, lookupFn?: DnsLookup): Promise<URL> {
  const u = assertSafeHttpUrl(raw);
  const host = canonicalHost(u.hostname);
  if (isIP(host)) return u;
  const lookup: DnsLookup =
    lookupFn ??
    (async (h) => {
      const rows = await dnsLookup(h, { all: true, verbatim: true });
      return rows.map((r) => ({ address: r.address, family: r.family }));
    });
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await lookup(host);
  } catch (e) {
    throw new Error(`DNS failed for ${host}: ${String(e)}`);
  }
  if (!addrs.length) throw new Error(`DNS failed for ${host}`);
  for (const a of addrs) {
    if (isBlockedIp(a.address)) {
      throw new Error(`blocked resolved address ${a.address} (${host})`);
    }
  }
  return u;
}
