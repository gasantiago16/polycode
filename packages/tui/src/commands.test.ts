import { describe, expect, it } from "vitest";
import {
  completeSlash,
  composerPlaceholder,
  didYouMean,
  isKnownSlash,
  matchSlash,
  slashName,
  unknownSlashMessage,
} from "./commands.js";

describe("slash catalog", () => {
  it("parses the first token", () => {
    expect(slashName("/model openai:gpt-5.5")).toBe("model");
    expect(slashName("hello")).toBe("");
  });

  it("matches prefixes and aliases", () => {
    expect(matchSlash("/mo").map((c) => c.name)).toEqual(["model", "mode"]);
    expect(matchSlash("/crank").map((c) => c.name)).toEqual(["review"]);
    expect(matchSlash("/gra").map((c) => c.name)).toEqual(["graphs", "graph"]);
  });

  it("tab-completes a unique prefix and a common prefix", () => {
    expect(completeSlash("/exi")).toBe("/exit ");
    expect(completeSlash("/mo")).toBe("/mode");
    expect(completeSlash("/model x")).toBeNull();
  });

  it("rejects unknown slashes and suggests nearby names", () => {
    expect(isKnownSlash("/hepl")).toBe(false);
    expect(isKnownSlash("/help")).toBe(true);
    expect(isKnownSlash("/forme", ["forme"])).toBe(true);
    expect(didYouMean("hepl")).toBe("help");
    expect(didYouMean("crnky")).toBe("review");
    expect(unknownSlashMessage("/hepl")).toMatch(/not sent to the model/i);
    expect(unknownSlashMessage("/hepl")).toMatch(/did you mean \/help/i);
    expect(unknownSlashMessage("/hepl")).not.toMatch(/^unknown /);
  });

  it("changes the composer hint in plan and yolo", () => {
    expect(composerPlaceholder("plan")).toMatch(/read-only/);
    expect(composerPlaceholder("yolo")).toMatch(/auto-allowed/);
    expect(composerPlaceholder("ask")).toMatch(/tab completes/);
  });
});
