import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore, deriveTitle, type SessionData } from "./session.js";

const dirs: string[] = [];
function store() {
  const root = mkdtempSync(join(tmpdir(), "polycode-session-"));
  dirs.push(root);
  return { root, store: new SessionStore(root) };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function data(id: string, updatedAt = "2026-01-01T00:00:00.000Z"): SessionData {
  return {
    id, createdAt: updatedAt, updatedAt, cwd: "project", model: "test:model", title: "title",
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  };
}

describe("SessionStore", () => {
  it("round-trips a session and lists newest first", () => {
    const { store: sessions } = store();
    sessions.save(data("old", "2026-01-01T00:00:00.000Z"));
    sessions.save(data("new", "2026-01-02T00:00:00.000Z"));
    expect(sessions.load("old")?.messages[0].role).toBe("user");
    expect(sessions.list().map((s) => s.id)).toEqual(["new", "old"]);
    expect(sessions.latest()?.id).toBe("new");
  });

  it.each(["../secret", "..", "a/b", "a\\b"])("rejects traversal id %s", (id) => {
    expect(store().store.load(id)).toBeNull();
  });

  it("returns null for corrupt and structurally invalid sessions", () => {
    const { root, store: sessions } = store();
    const dir = join(root, ".polycode", "sessions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bad.json"), "{");
    writeFileSync(join(dir, "wrong.json"), JSON.stringify({ messages: "nope" }));
    expect(sessions.load("bad")).toBeNull();
    expect(sessions.load("wrong")).toBeNull();
  });

  it("derives a bounded normalized title", () => {
    const title = deriveTitle([{ role: "user", content: [{ type: "text", text: "  a   ".repeat(30) }] }]);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title).not.toContain("  ");
  });
});
