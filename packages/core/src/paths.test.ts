import { describe, expect, it } from "vitest";
import {
  commandTouchesProtected,
  isPolycodeToolPathAllowed,
  isProtectedProjectPath,
  polycodeConfigDir,
} from "./paths.js";

describe("isProtectedProjectPath", () => {
  it.each([".env", ".env.local", "apps/.env", ".ENV", ".git/config", ".ssh/id_rsa", ".polycode/sessions/x.json"])(
    "protects %s",
    (p) => {
      expect(isProtectedProjectPath(p)).toBe(true);
    },
  );

  it.each(["src/a.ts", ".gitignore", ".polycode/memory.md", ".polycode/reviews/a.md", "env.ts"])(
    "allows %s",
    (p) => {
      expect(isProtectedProjectPath(p)).toBe(false);
    },
  );

  it("allows curated polycode tool paths", () => {
    expect(isPolycodeToolPathAllowed(".polycode/memory.md")).toBe(true);
    expect(isPolycodeToolPathAllowed(".polycode/sessions/x.json")).toBe(false);
  });
});

describe("polycodeConfigDir", () => {
  it("uses APPDATA on Windows when POLYCODE_CONFIG_DIR is unset", () => {
    const prevCfg = process.env.POLYCODE_CONFIG_DIR;
    const prevApp = process.env.APPDATA;
    delete process.env.POLYCODE_CONFIG_DIR;
    process.env.APPDATA = "C:\\Users\\tester\\AppData\\Roaming";
    try {
      expect(polycodeConfigDir().replace(/\\/g, "/").toLowerCase()).toMatch(/appdata\/roaming\/polycode$/);
    } finally {
      if (prevCfg == null) delete process.env.POLYCODE_CONFIG_DIR;
      else process.env.POLYCODE_CONFIG_DIR = prevCfg;
      if (prevApp == null) delete process.env.APPDATA;
      else process.env.APPDATA = prevApp;
    }
  });
});

describe("commandTouchesProtected", () => {
  it.each(["cat .env", "type .env.local", "python -c \"open('.env')\"", "cat .git/config", "ls .polycode/sessions"])(
    "flags %s",
    (cmd) => {
      expect(commandTouchesProtected(cmd)).toBe(true);
    },
  );

  it.each(["git status", "git rev-parse --abbrev-ref HEAD", "npm test", "rg TODO src", "cat .gitignore"])(
    "allows %s",
    (cmd) => {
      expect(commandTouchesProtected(cmd)).toBe(false);
    },
  );
});
