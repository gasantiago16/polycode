import type { ToolSpec } from "./types.js";

export type PermissionMode = "plan" | "ask" | "acceptEdits" | "yolo";

export interface PermissionDecision {
  allow: boolean;
  reason?: string;
}

/** The UI implements this to prompt the user. Resolves true=allow, false=deny. */
export type PermissionPrompt = (req: { tool: ToolSpec; input: unknown }) => Promise<boolean>;

/**
 * Provider-agnostic safety gate, modeled on Claude Code's permission modes:
 *   plan        — read-only; refuse anything that mutates
 *   ask         — auto-allow safe; prompt for mutating/dangerous
 *   acceptEdits — auto-allow safe + mutating; prompt for dangerous
 *   yolo        — allow everything (use in sandboxes / CI only)
 */
export class PermissionEngine {
  constructor(
    private mode: PermissionMode,
    private prompt: PermissionPrompt,
  ) {}

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }
  getMode(): PermissionMode {
    return this.mode;
  }

  async check(tool: ToolSpec, input: unknown): Promise<PermissionDecision> {
    const cls = tool.permission;

    if (this.mode === "yolo") return { allow: true };
    if (cls === "safe") return { allow: true };

    if (this.mode === "plan") {
      return { allow: false, reason: "plan mode: read-only tools only" };
    }
    if (this.mode === "acceptEdits" && cls === "mutating") {
      return { allow: true };
    }

    // ask mode (or a dangerous tool in any non-yolo mode): defer to the user.
    const ok = await this.prompt({ tool, input });
    return ok ? { allow: true } : { allow: false, reason: "denied by user" };
  }
}
