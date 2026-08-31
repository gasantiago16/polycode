// Canonical, provider-agnostic types.
//
// The agent loop, tools, permission engine, and UI only ever see these.
// Every provider quirk (OpenAI vs Gemini message shapes, tool-call formats,
// stop reasons, reasoning channels) is normalized to/from these types inside
// a provider adapter and never leaks upward.

export type Role = "system" | "user" | "assistant" | "tool";

export interface TextPart {
  type: "text";
  text: string;
}
export interface ReasoningPart {
  type: "reasoning";
  text: string;
}
export interface ToolCallPart {
  type: "tool_call";
  id: string;
  name: string;
  input: unknown;
}
export interface ToolResultPart {
  type: "tool_result";
  id: string; // matches the originating ToolCallPart.id
  name: string;
  output: string;
  isError?: boolean;
}
export interface ImagePart {
  type: "image";
  mediaType: string;
  /** Raw base64 (no data: prefix). */
  data: string;
  /** Original project-relative path, when loaded from disk. */
  path?: string;
}
export type ContentPart = TextPart | ReasoningPart | ToolCallPart | ToolResultPart | ImagePart;

export interface CanonicalMessage {
  role: Role;
  content: ContentPart[];
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "error";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** Streaming events the agent loop consumes, regardless of provider. */
export type CanonicalEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call"; call: ToolCallPart }
  | { type: "stop"; reason: StopReason; usage?: Usage }
  | { type: "error"; error: string };

export type PermissionClass = "safe" | "mutating" | "dangerous";

export interface ToolRunResult {
  output: string;
  isError?: boolean;
  /** Optional richer rendering for the UI only (e.g. a diff). NOT sent to the model. */
  display?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * The execution surface tools run against. A `local` backend uses the host
 * filesystem + shell; a `docker` backend runs shell commands inside an isolated
 * container (file ops stay on the bind-mounted project so edits land for real).
 * Tools never touch Node's fs/child_process directly — only this.
 */
export interface Sandbox {
  /** Human-readable label (project path, or "docker:<id> (path)"). */
  readonly root: string;
  /** Host filesystem project root, when the backend can create git worktrees. */
  readonly projectPath?: string;
  readFile(relPath: string): Promise<string>;
  /** Optional binary read (images). Local/docker backends implement this. */
  readFileBytes?(relPath: string): Promise<Uint8Array>;
  writeFile(relPath: string, content: string): Promise<void>;
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>;
  /**
   * Run a program with an explicit argv (no shell). Safe for untrusted args —
   * nothing is parsed by a shell — so `safe`-class tools can invoke binaries
   * (e.g. ripgrep) without opening a command-injection hole.
   */
  execFile(file: string, args: string[], opts?: ExecOptions): Promise<ExecResult>;
  /** Yield project-relative file paths (ignoring node_modules/.git/etc.). */
  walk(): AsyncIterable<string>;
  dispose(): Promise<void>;
}

export interface SpawnChildInput {
  description: string;
  prompt: string;
  subagent_type?: string;
  /** Isolated git worktree for this child (writes do not hit the parent tree). */
  isolation?: "none" | "worktree";
}

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface TodoStore {
  list(): TodoItem[];
  replace(items: TodoItem[]): void;
}

export interface ToolContext {
  sandbox: Sandbox;
  signal?: AbortSignal;
  todos?: TodoStore;
  /**
   * Parent-only: run a child Agent loop (no nested task). Used by the `task`
   * tool. Children must not receive this.
   */
  spawnChild?: (input: SpawnChildInput) => Promise<ToolRunResult>;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema describing the tool input (authored by hand or via zod). */
  parameters: Record<string, unknown>;
  /** Drives the permission engine. */
  permission: PermissionClass;
  /** Read-only tools may be executed concurrently. */
  parallelSafe: boolean;
  /**
   * When true, `parameters` is a stub and the full JSON schema is not yet in
   * the model context (MCP deferred schemas). Cleared by mcp_search / first use.
   */
  schemaDeferred?: boolean;
  run(input: any, ctx: ToolContext): Promise<ToolRunResult>;
}

/** What a model can do — the loop reads this to budget context, etc. */
export interface Capabilities {
  contextWindow: number;
  maxOutput: number;
  supportsTools: boolean;
  supportsReasoning: boolean;
  supportsCaching: boolean;
  supportsVision: boolean;
  parallelTools: boolean;
}

export interface GenerateRequest {
  system?: string;
  messages: CanonicalMessage[];
  tools: ToolSpec[];
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}

/** The seam that makes "multiple API models" tractable. */
export interface Provider {
  /** Stable provider id, e.g. "openai" | "google". */
  id: string;
  /** Resolved model id, e.g. "gpt-5" | "gemini-2.5-pro". */
  model: string;
  capabilities(): Capabilities;
  stream(req: GenerateRequest): AsyncIterable<CanonicalEvent>;
  countTokens?(req: GenerateRequest): Promise<number>;
}
