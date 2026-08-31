import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl, assertSafeHttpUrl, isBlockedIp } from "./ssrf.js";

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "172.16.0.1",
    "169.254.169.254",
    "100.64.1.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "[::ffff:7f00:1]",
    "fc00::1",
    "fd12::1",
    "fe80::1",
    "ff02::1",
    "::",
  ])("blocks %s", (addr) => {
    expect(isBlockedIp(addr)).toBe(true);
  });

  it.each(["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700::1111"])("allows public %s", (addr) => {
    expect(isBlockedIp(addr)).toBe(false);
  });
});

describe("assertSafeHttpUrl", () => {
  it("allows public https", () => {
    expect(assertSafeHttpUrl("https://example.com/a").hostname).toBe("example.com");
  });

  it.each([
    "file:///etc/passwd",
    "http://127.0.0.1/secret",
    "http://localhost:8080/",
    "http://localhost./",
    "http://10.0.0.4/",
    "http://169.254.169.254/latest/meta-data/",
    "http://0x7f000001/",
    "http://2130706433/",
    "http://0177.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
  ])("blocks %s", (u) => {
    expect(() => assertSafeHttpUrl(u)).toThrow(/blocked|protocol/);
  });
});

describe("assertPublicHttpUrl", () => {
  it("blocks DNS that resolves to loopback", async () => {
    await expect(
      assertPublicHttpUrl("https://evil.example", async () => [{ address: "127.0.0.1", family: 4 }]),
    ).rejects.toThrow(/blocked resolved/);
  });

  it("blocks DNS that resolves to link-local metadata", async () => {
    await expect(
      assertPublicHttpUrl("https://evil.example", async () => [{ address: "169.254.169.254", family: 4 }]),
    ).rejects.toThrow(/blocked resolved/);
  });

  it("allows DNS to a public address", async () => {
    const u = await assertPublicHttpUrl("https://example.com/x", async () => [
      { address: "93.184.216.34", family: 4 },
    ]);
    expect(u.hostname).toBe("example.com");
  });

  it("fails closed when DNS returns nothing", async () => {
    await expect(assertPublicHttpUrl("https://example.com", async () => [])).rejects.toThrow(/DNS failed/);
  });
});
