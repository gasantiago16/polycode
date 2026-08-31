import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadPlugins } from "./load.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("loadPlugins", () => {
  it("loads skills, commands, agents, hooks, and mcp from a plugin folder", () => {
    const cwd = join(tmpdir(), `poly-plug-${Date.now()}`);
    dirs.push(cwd);
    const root = join(cwd, ".polycode", "plugins", "nits");
    mkdirSync(join(root, "skills", "hello"), { recursive: true });
    mkdirSync(join(root, "commands"), { recursive: true });
    mkdirSync(join(root, "agents"), { recursive: true });
    mkdirSync(join(root, "hooks"), { recursive: true });
    writeFileSync(
      join(root, "plugin.json"),
      JSON.stringify({ name: "nits", version: "0.1.0", description: "nitpick helpers" }),
    );
    writeFileSync(
      join(root, "skills", "hello", "SKILL.md"),
      "---\nname: hello\ndescription: say hi\n---\nHello $ARGUMENTS\n",
    );
    writeFileSync(join(root, "commands", "ping.md"), "# Ping\n\nPong $ARGUMENTS\n");
    writeFileSync(
      join(root, "agents", "nitpicker.md"),
      "---\nname: nitpicker\ndescription: find nits\n---\nYou only report nits.\n",
    );
    writeFileSync(
      join(root, "hooks", "hooks.json"),
      JSON.stringify({ PostToolUse: [{ matcher: "write", command: "echo $PLUGIN_ROOT" }] }),
    );
    writeFileSync(
      join(root, "mcp.json"),
      JSON.stringify({ mcpServers: { echo: { command: "node", args: ["x.js"] } } }),
    );
    const [p] = loadPlugins({ cwd });
    expect(p.name).toBe("nits");
    expect(p.skills.map((s) => s.name).sort()).toEqual(["hello", "ping"]);
    expect(p.agents[0]?.name).toBe("nitpicker");
    expect(p.hooks.PostToolUse?.[0]?.command).toContain(root);
    expect(p.mcpServers.nits_echo?.command).toBe("node");
  });
});
