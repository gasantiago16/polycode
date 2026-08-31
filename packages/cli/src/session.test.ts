import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("omits image bytes from saved transcripts", () => {
    const { root, store: sessions } = store();
    sessions.save({
      ...data("img"),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "see" },
            { type: "image", mediaType: "image/png", data: "iVBORw0KGgoAAAANSUhEUg", path: "shot.png" },
          ],
        },
      ],
    });
    const raw = readFileSync(join(root, ".polycode", "sessions", "img.json"), "utf8");
    expect(raw).not.toContain("iVBORw0KGgoAAAANSUhEUg");
    const loaded = sessions.load("img");
    expect(loaded?.messages[0].content.some((p) => p.type === "image")).toBe(false);
    expect(JSON.stringify(loaded?.messages)).toContain("omitted from session");
  });

  it("round-trips todos and usage", () => {
    const { store: sessions } = store();
    sessions.save({
      ...data("u"),
      todos: [{ id: "1", content: "ship", status: "pending" }],
      usage: [{ model: "google:gemini-2.5-flash", inputTokens: 10, outputTokens: 2 }],
    });
    const loaded = sessions.load("u");
    expect(loaded?.todos?.[0].content).toBe("ship");
    expect(loaded?.usage?.[0].inputTokens).toBe(10);
  });
});
