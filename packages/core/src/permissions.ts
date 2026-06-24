import type { ToolSpec } from "./types.js";

export type PermissionMode = "plan" | "ask" | "acceptEdits" | "yolo";

export interface PermissionDecision {
  allow: boolean;
  reason?: string;
}

/** The user's answer to a prompt: allow once, allow for the session, or deny. */
export type PermissionChoice = "once" | "always" | "deny";

/** The UI implements this to prompt the user. */
export type PermissionPrompt = (req: {
  tool: ToolSpec;
  input: unknown;
}) => Promise<PermissionChoice>;

/**
 * Provider-agnostic safety gate, modeled on Claude Code's permission modes:
 *   plan        — read-only; refuse anything that mutates
 *   ask         — auto-allow safe; prompt for mutating/dangerous
 *   acceptEdits — auto-allow safe + mutating; prompt for dangerous
 *   yolo        — allow everything (use in sandboxes / CI only)
 */
export class PermissionEngine {
  /** Tools the user chose to allow for the rest of the session ("always"). */
  private sessionAllowed = new Set<string>();

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

  /** Tool names granted "always allow" this session (for UI display). */
  sessionGrants(): string[] {
    return [...this.sessionAllowed];
  }

  async check(tool: ToolSpec, input: unknown): Promise<PermissionDecision> {
    const cls = tool.permission;

    if (this.mode === "yolo") return { allow: true };
    if (cls === "safe") return { allow: true };
    if (this.sessionAllowed.has(tool.name)) return { allow: true };

    if (this.mode === "plan") {
      return { allow: false, reason: "plan mode: read-only tools only" };
    }
    if (this.mode === "acceptEdits" && cls === "mutating") {
      return { allow: true };
    }

    // ask mode (or a dangerous tool in any non-yolo mode): defer to the user.
    const choice = await this.prompt({ tool, input });
    if (choice === "always") {
      this.sessionAllowed.add(tool.name);
      return { allow: true };
    }
    if (choice === "once") return { allow: true };
    return { allow: false, reason: "denied by user" };
  }
}
