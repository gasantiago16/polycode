import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import {
  Agent,
  PermissionEngine,
  appendMemory,
  expandUserMessage,
  formatHookSet,
  loadImagePart,
  readMemory,
  replaceMemory,
  MEMORY_PATH,
  compactCostUsd,
  parseLoopCommand,
  formatLoopInterval,
  nextLoopId,
  type CanonicalMessage,
  collectGitDiff,
  parseReviewVerdict,
  type CompactConfig,
  type HookSet,
  type ModelUsage,
  type PermissionRule,
  type TodoItem,
  type PermissionMode,
  type PermissionChoice,
  type Provider,
  type Sandbox,
  type ToolSpec,
  type ChildRun,
  type Persona,
} from "@polycode/core";
import {
  deepResearchWorkflow,
  teamWorkflow,
  hostFromSpawn,
  parseWorkflowArgs,
  runWorkflowFile,
  type LoadedWorkflow,
} from "@polycode/workflows";
import {
  compileGraph,
  FileCheckpointStore,
  formatGraphRun,
  hostFromSpawn as graphHostFromSpawn,
  newThreadId,
  runGraph,
  type LoadedGraph,
} from "@polycode/graph";
import { join, relative } from "node:path";
import { hydrateEnv, type ProviderId } from "@polycode/secrets";
import { Banner } from "./banner.js";
import { Settings } from "./settings.js";
import { Help } from "./help.js";
import { Dashboard } from "./dashboard.js";
import { Markdown } from "./markdown.js";
import { theme, sym, WORK_VERBS } from "./theme.js";
import { createPaintBuffer } from "./paint.js";
import {
  completeSlash,
  composerBorder,
  composerPlaceholder,
  isKnownSlash,
  unknownSlashMessage,
  matchSlash,
} from "./commands.js";
import {
  DEFAULT_STATUS_TEMPLATE,
  expandStatusCommand,
  formatStatusLine,
  type StatusLineVars,
} from "./statusline.js";

const MAX_RESULT_LINES = 8; // plain tool output shown before "+N lines"
const MAX_DIFF_LINES = 22; // diff lines shown before "+N lines"
const ARG_WIDTH = 72; // tool-call argument display width

type Entry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      result?: string;
      isError?: boolean;
      display?: string;
      denied?: boolean;
      reason?: string;
    }
  | { kind: "system"; text: string }
  | { kind: "error"; text: string };

type StaticRow = { kind: "banner" } | { kind: "row"; entry: Entry };

export interface AppProps {
  provider: Provider;
  tools: ToolSpec[];
  sandbox: Sandbox;
  cwd: string;
  system?: string;
  onModelSwitch?: (arg: string) => Provider;
  route?: (text: string) => Promise<{ provider: Provider; tier: string; label: string }>;
  autoRoute?: boolean;
  /** Validate a provider's stored key (for the in-session settings overlay). */
  validate?: (p: ProviderId) => Promise<boolean>;
  /** Agentic key-provisioning hook (for the in-session settings overlay). */
  onAgentic?: (p: ProviderId) => Promise<string> | string;
  /** Prior conversation to resume (rendered as history + seeded into the agent). */
  initialMessages?: CanonicalMessage[];
  /** Persist the conversation after each turn (session transcript). */
  onPersist?: (
    messages: CanonicalMessage[],
    model: string,
    extra?: { todos?: TodoItem[]; usage?: ModelUsage[] },
  ) => void;
  permissionRules?: PermissionRule[];
  initialTodos?: TodoItem[];
  initialUsage?: ModelUsage[];
  /** Two-pass compaction; `/compact` and auto-compact at 85% of the window. */
  compact?: CompactConfig;
  skills?: Array<{ name: string; description: string; source: string }>;
  resolveSkill?: (name: string, args: string) => string | null;
  mcpStatus?: Array<{ name: string; ok: boolean; tools: string[]; error?: string }>;
  plugins?: Array<{ name: string; description: string; version?: string; source: string }>;
  openWorktree?: () => Promise<{ sandbox: Sandbox; path: string }>;
  hooks?: HookSet;
  workflows?: LoadedWorkflow[];
  graphs?: LoadedGraph[];
  worktreeOps?: {
    list: () => string[];
    apply: (idOrPath: string) => Promise<{ files: string[]; path: string }>;
    remove: (idOrPath: string) => Promise<string>;
  };
  statusLine?: { template?: string; command?: string };
  personas?: Persona[];
}

interface PendingPerm {
  tool: ToolSpec;
  input: unknown;
  repeat?: boolean;
  resolve: (choice: PermissionChoice) => void;
}

export function App({
  provider,
  tools,
  sandbox,
  cwd,
  system,
  onModelSwitch,
  route,
  autoRoute: autoRouteDefault,
  validate,
  onAgentic,
  initialMessages,
  onPersist,
  compact,
  skills = [],
  resolveSkill,
  mcpStatus = [],
  plugins: pluginList = [],
  openWorktree,
  hooks,
  workflows = [],
  graphs = [],
  worktreeOps,
  statusLine,
  permissionRules = [],
  initialTodos,
  initialUsage,
  personas = [],
}: AppProps) {
  const { exit } = useApp();
  // Reconstruct any resumed conversation as already-finalized history.
  const seed = useMemo(() => messagesToEntries(initialMessages ?? []), [initialMessages]);
  const [entries, setEntries] = useState<Entry[]>(seed);
  // Authoritative copy updated synchronously, so we can read it mid-event-loop
  // (React's functional updaters run later/batched). All mutations go through update().
  const entriesRef = useRef<Entry[]>(seed);
  // Entries [0, committed) are finalized → rendered in <Static> (printed once,
  // never repainted). The tail [committed, …) is the live, in-progress turn.
  const [committed, setCommitted] = useState(seed.length);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const demoteRef = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [verb, setVerb] = useState<string>(WORK_VERBS[0]);
  const [perm, setPerm] = useState<PendingPerm | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [dashRuns, setDashRuns] = useState<ChildRun[]>([]);
  const [exitHint, setExitHint] = useState(false);
  const [modelLabel, setModelLabel] = useState(`${provider.id}:${provider.model}`);
  const [mode, setMode] = useState<PermissionMode>("ask");
  const [autoRoute, setAutoRoute] = useState(!!autoRouteDefault && !!route);
  const [ctxWindow, setCtxWindow] = useState(provider.capabilities().contextWindow);
  const [ctxTokens, setCtxTokens] = useState(0); // last turn's input tokens (≈ live context)
  const [sessionTok, setSessionTok] = useState({ in: 0, out: 0 });
  const [statusTemplate, setStatusTemplate] = useState(
    statusLine?.template?.trim() || DEFAULT_STATUS_TEMPLATE,
  );
  const [statusCmdOut, setStatusCmdOut] = useState<string | null>(null);

  const update = (fn: (prev: Entry[]) => Entry[]) => {
    const next = fn(entriesRef.current);
    entriesRef.current = next;
    setEntries(next);
  };
  const commit = () => setCommitted(entriesRef.current.length);

  const add = (e: Entry) => update((p) => [...p, e]);
  const appendAssistant = (t: string) =>
    update((p) => {
      const last = p[p.length - 1];
      if (last && last.kind === "assistant") {
        return [...p.slice(0, -1), { ...last, text: last.text + t }];
      }
      return [...p, { kind: "assistant", text: t }];
    });
  const setToolResult = (id: string, result: string, isError?: boolean, display?: string) =>
    update((p) =>
      p.map((e) => (e.kind === "tool" && e.id === id ? { ...e, result, isError, display } : e)),
    );
  const setToolDenied = (id: string, reason?: string) =>
    update((p) =>
      p.map((e) => (e.kind === "tool" && e.id === id ? { ...e, denied: true, reason } : e)),
    );

  const promptPermission = useCallback(
    (req: { tool: ToolSpec; input: unknown; repeat?: boolean }) =>
      new Promise<PermissionChoice>((resolve) => setPerm({ ...req, resolve })),
    [],
  );

  const engineRef = useRef(new PermissionEngine("ask", promptPermission, permissionRules));
  const childSink = useRef<(run: ChildRun) => void>(() => {});
  const agentRef = useRef(
    new Agent(provider, tools, engineRef.current, {
      system,
      sandbox,
      initialMessages,
      compact,
      initialTodos,
      initialUsage,
      openWorktree,
      hooks,
      personas,
      onChildSettled: (run) => childSink.current(run),
    }),
  );
  childSink.current = (run) => {
    add({
      kind: "system",
      text: `child ${run.id} ${run.status} · ${run.description}`,
    });
  };

  useEffect(() => {
    void agentRef.current.startSession();
    return () => {
      for (const j of loopsRef.current) clearInterval(j.timer);
      loopsRef.current = [];
      void agentRef.current.endSession();
    };
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const fails = mcpStatus.filter((s) => !s.ok);
    if (fails.length) {
      add({
        kind: "system",
        text: `mcp skipped: ${fails.map((s) => s.name).join(", ")} · /mcp for details`,
      });
    }
  }, [mcpStatus]);

  useEffect(() => {
    const cmd = statusLine?.command?.trim();
    if (!cmd) {
      setStatusCmdOut(null);
      return;
    }
    let cancelled = false;
    const vars: StatusLineVars = {
      model: modelLabel,
      mode,
      route: autoRoute ? "on" : "off",
      sandbox: sandbox.root.startsWith("docker:") ? "docker" : "local",
      ctxUsed: ctxTokens,
      ctxWindow,
      sessionTokens: sessionTok.in + sessionTok.out,
      mcpOk: mcpStatus.filter((s) => s.ok).length,
      mcpTotal: mcpStatus.length,
      mcpDeferred: tools.filter((t) => t.schemaDeferred).length,
      cost: compactCostUsd([...agentRef.current.usageLedger()]),
      cwd,
    };
    void sandbox.exec(expandStatusCommand(cmd, vars), { timeoutMs: 800 }).then((r) => {
      if (cancelled) return;
      if (r.code === 0) {
        const out = (r.stdout || "").trim().split(/\r?\n/)[0] ?? "";
        setStatusCmdOut(out ? out.slice(0, 200) : null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    statusLine?.command,
    modelLabel,
    mode,
    autoRoute,
    ctxTokens,
    ctxWindow,
    sessionTok,
    mcpStatus,
    tools,
    cwd,
    sandbox,
  ]);
  const persist = () => {
    const p = agentRef.current.getProvider();
    onPersist?.(agentRef.current.history() as CanonicalMessage[], `${p.id}:${p.model}`, {
      todos: [...agentRef.current.listTodos()],
      usage: [...agentRef.current.usageLedger()],
    });
  };
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;
  const historyRef = useRef<string[]>([]);
  const histIdx = useRef(-1);
  const draftRef = useRef("");
  const lastCtrlC = useRef(0);
  const booted = useRef(false);
  const loopsRef = useRef<Array<{ id: string; intervalMs: number; prompt: string; timer: ReturnType<typeof setInterval>; fires: number }>>([]);
  const loopSeqRef = useRef(0);

  const acquireBusy = (): boolean => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  };
  const releaseBusy = () => {
    busyRef.current = false;
    setBusy(false);
  };
  const refreshDash = useCallback(() => {
    setDashRuns(agentRef.current.listChildren());
  }, []);

  // elapsed-time ticker while busy
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  // answer permission prompt: y/enter=once · a=always (session) · n/esc=deny
  useInput(
    (ch, key) => {
      if (!perm) return;
      const c = ch.toLowerCase();
      if (c === "y" || key.return) perm.resolve("once");
      else if (c === "a") perm.resolve("always");
      else if (c === "n" || key.escape) perm.resolve("deny");
      else return;
      setPerm(null);
    },
    { isActive: !!perm },
  );

  // esc to interrupt a running turn · Ctrl+B demotes children to background
  useInput(
    (ch, key) => {
      if (key.escape) abortRef.current?.abort();
      if (key.ctrl && (ch === "b" || ch === "B")) {
        const ids = agentRef.current.detachRunningChildren();
        demoteRef.current = true;
        abortRef.current?.abort();
        add({
          kind: "system",
          text: ids.length
            ? `Ctrl+B · ${ids.join(", ")} still running · /dashboard`
            : "Ctrl+B · turn backgrounded",
        });
      }
    },
    { isActive: busy && !perm },
  );

  useInput((ch, key) => {
    if (key.ctrl && ch === "c") {
      if (perm) {
        perm.resolve("deny");
        setPerm(null);
        return;
      }
      if (showHelp) {
        setShowHelp(false);
        return;
      }
      if (showDashboard) {
        setShowDashboard(false);
        return;
      }
      if (busy) {
        abortRef.current?.abort();
        return;
      }
      const now = Date.now();
      if (now - lastCtrlC.current < 1600) {
        void agentRef.current.endSession();
        exit();
        return;
      }
      lastCtrlC.current = now;
      setExitHint(true);
      setTimeout(() => setExitHint(false), 1600);
    }
  });

  useInput(
    (_ch, key) => {
      if (key.tab) {
        const next = completeSlash(inputRef.current);
        if (next) setInput(next);
        return;
      }
      const hist = historyRef.current;
      if (key.upArrow) {
        if (!hist.length) return;
        if (histIdx.current === -1) draftRef.current = inputRef.current;
        const next = Math.min(hist.length - 1, histIdx.current + 1);
        histIdx.current = next;
        setInput(hist[hist.length - 1 - next]);
        return;
      }
      if (key.downArrow) {
        if (histIdx.current < 0) return;
        const next = histIdx.current - 1;
        histIdx.current = next;
        setInput(next < 0 ? draftRef.current : hist[hist.length - 1 - next]);
      }
    },
    { isActive: !perm && !showSettings && !showHelp && !showDashboard && !busy },
  );

  useInput(
    (ch, key) => {
      if (key.ctrl && (ch === "\\" || ch === "|")) {
        setDashRuns(agentRef.current.listChildren());
        setShowDashboard((v) => !v);
      }
    },
    { isActive: !perm && !showSettings },
  );

  const drive = async (signal: AbortSignal) => {
    const paint = createPaintBuffer((chunk) => appendAssistant(chunk), 100);
    try {
      for await (const ev of agentRef.current.run(signal)) {
        switch (ev.type) {
          case "text_delta":
            paint.push(ev.text);
            break;
          case "tool_call":
            paint.flush();
            add({ kind: "tool", id: ev.call.id, name: ev.call.name, input: ev.call.input });
            break;
          case "tool_result":
            setToolResult(ev.result.id, ev.result.output, ev.result.isError, ev.display);
            break;
          case "tool_denied":
            setToolDenied(ev.call.id, ev.reason);
            break;
          case "compacted":
            add({
              kind: "system",
              text: `compacted ${fmtK(ev.stats.before)} → ${fmtK(ev.stats.after)} (${ev.stats.pass})`,
            });
            break;
          case "turn_complete":
            // One event per settled model turn (the agent collapses retries), so
            // summing here is correct even across tool round-trips; the last
            // turn's input tokens act as the live-context gauge.
            if (ev.usage) {
              setCtxTokens(ev.usage.inputTokens);
              setSessionTok((s) => ({
                in: s.in + ev.usage!.inputTokens,
                out: s.out + ev.usage!.outputTokens,
              }));
            }
            break;
          case "error":
            add({ kind: "error", text: `error: ${ev.error}` });
            break;
        }
      }
    } catch (e) {
      if (signal.aborted) {
        add({
          kind: "system",
          text: demoteRef.current ? "turn backgrounded · /dashboard" : "interrupted",
        });
      } else add({ kind: "error", text: String(e) });
    } finally {
      paint.flush();
      const demoted = demoteRef.current;
      demoteRef.current = false;
      commit();
      const history = agentRef.current.history() as CanonicalMessage[];
      if ((!signal.aborted || demoted) && isResumable(history)) persist();
    }
  };

  const switchTo = (next: Provider, label: string) => {
    agentRef.current.setProvider(next);
    setModelLabel(label);
    setCtxWindow(next.capabilities().contextWindow);
  };

  const kickTurn = async (text: string, loopId?: string) => {
    if (!acquireBusy()) return;
    try {
      const shown = loopId ? `[${loopId}] ${text}` : text;
      add({ kind: "user", text: shown });
      if (autoRoute && route) {
        try {
          const r = await route(text);
          switchTo(r.provider, r.label);
          add({ kind: "system", text: `routed → ${r.tier} (${r.label})` });
        } catch (e) {
          add({ kind: "error", text: `route failed: ${String(e)}` });
        }
      }
      commit();
      setVerb(WORK_VERBS[Math.floor(Math.random() * WORK_VERBS.length)]);
      const expanded = await expandUserMessage(text, sandbox);
      const blocked = await agentRef.current.submitPrompt(expanded.text, expanded.extras);
      if (blocked.blocked) {
        add({ kind: "error", text: `prompt blocked: ${blocked.reason}` });
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      await drive(controller.signal);
    } finally {
      releaseBusy();
    }
  };
  const kickTurnRef = useRef(kickTurn);
  kickTurnRef.current = kickTurn;

  const handleSubmit = async (raw: string) => {
    const v = raw.trim();
    setInput("");
    if (!v) return;
    if (v === "/exit" || v === "/quit") {
      for (const j of loopsRef.current) clearInterval(j.timer);
      loopsRef.current = [];
      await agentRef.current.endSession();
      return exit();
    }
    if (busyRef.current) return; // a turn is streaming — ignore other submits (esc to interrupt)
    if (v && historyRef.current[historyRef.current.length - 1] !== v) historyRef.current.push(v);
    histIdx.current = -1;
    if (v === "/help" || v === "/") {
      setShowHelp(true);
      return;
    }
    if (v === "/dashboard" || v === "/agents") {
      setDashRuns(agentRef.current.listChildren());
      setShowDashboard(true);
      return;
    }
    if (v === "/personas") {
      add({
        kind: "system",
        text: personas.length
          ? personas.map((p) => `${p.name}  (${p.source})  ${p.description}`).join("\n")
          : "no personas (add .polycode/personas/<name>.md)",
      });
      return;
    }
    if (v === "/loop" || v.startsWith("/loop ")) {
      const parsed = parseLoopCommand(v);
      if (parsed.op === "list") {
        const rows = loopsRef.current;
        add({
          kind: "system",
          text: rows.length
            ? rows
                .map((j) => `${j.id}  every ${formatLoopInterval(j.intervalMs)}  ${j.prompt}  (${j.fires} fires)`)
                .join("\n")
            : "no loops · /loop 5m <prompt> · /loop stop [id]",
        });
        return;
      }
      if (parsed.op === "stop") {
        if (!parsed.id) {
          for (const j of loopsRef.current) clearInterval(j.timer);
          loopsRef.current = [];
          add({ kind: "system", text: "loops stopped" });
          return;
        }
        const i = loopsRef.current.findIndex((j) => j.id === parsed.id);
        if (i < 0) {
          add({ kind: "error", text: `no loop ${parsed.id}` });
          return;
        }
        clearInterval(loopsRef.current[i].timer);
        loopsRef.current.splice(i, 1);
        add({ kind: "system", text: `stopped ${parsed.id}` });
        return;
      }
      if (parsed.op === "usage") {
        add({ kind: "system", text: parsed.error ?? "usage: /loop 5m <prompt>" });
        return;
      }
      if (loopsRef.current.length >= 4) {
        add({ kind: "error", text: "too many loops (max 4) · /loop stop" });
        return;
      }
      const id = nextLoopId(loopSeqRef);
      const timer = setInterval(() => {
        const job = loopsRef.current.find((j) => j.id === id);
        if (!job || busyRef.current) return;
        job.fires++;
        void kickTurnRef.current(job.prompt, id);
      }, parsed.intervalMs);
      loopsRef.current.push({
        id,
        intervalMs: parsed.intervalMs,
        prompt: parsed.prompt,
        timer,
        fires: 0,
      });
      add({
        kind: "system",
        text: `loop ${id} every ${formatLoopInterval(parsed.intervalMs)} · /loop stop ${id}`,
      });
      return;
    }
    if (v === "/settings" || v === "/login") {
      setShowSettings(true); // overlay — App stays mounted, history is preserved
      return;
    }
    if (v === "/clear") {
      // Resets the conversation + context. Scrollback above stays — it was
      // already flushed to <Static>, and a raw ANSI clear desyncs Ink's buffer.
      entriesRef.current = [];
      setEntries([]);
      setCommitted(0);
      return;
    }
    if (v === "/keys") {
      add({ kind: "system", text: "open /settings to view and manage keys" });
      return;
    }
    if (v === "/mode" || v.startsWith("/mode ")) {
      const m = v.slice("/mode".length).trim() as PermissionMode;
      if (!m || !["plan", "ask", "acceptEdits", "yolo"].includes(m)) {
        add({ kind: "system", text: `mode ${engineRef.current.getMode()} · usage: /mode plan|ask|acceptEdits|yolo` });
        return;
      }
      engineRef.current.setMode(m);
      setMode(engineRef.current.getMode());
      add({ kind: "system", text: `mode → ${engineRef.current.getMode()}` });
      return;
    }
    if (v.startsWith("/route")) {
      const sub = v.slice(6).trim();
      if (!route) return add({ kind: "error", text: "routing unavailable" });
      const on = sub === "off" ? false : sub === "status" ? autoRoute : true;
      setAutoRoute(on);
      add({ kind: "system", text: `auto-route ${on ? "on" : "off"}` });
      return;
    }
    if (v === "/review" || v === "/cranky") {
      if (!acquireBusy()) return;
      try {
        const diff = await collectGitDiff(sandbox);
        if (!diff) {
          add({ kind: "system", text: "cranky: no local git changes to review" });
          return;
        }
        const path = `.polycode/reviews/${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
        add({ kind: "system", text: `cranky review → ${path}` });
        const result = await agentRef.current.spawnChild({
          description: "cranky review",
          subagent_type: "review",
          prompt: `Review the git diff below. Write the full review markdown to ${path}.\n\n${diff}`,
        });
        const vrd = parseReviewVerdict(result.output);
        add({
          kind: result.isError ? "error" : "system",
          text: result.isError
            ? result.output
            : `cranky ${vrd.verdict} · ${vrd.bugs} bugs, ${vrd.suggestions} suggestions, ${vrd.nits} nits`,
        });
        persist();
      } finally {
        releaseBusy();
      }
      return;
    }
    if (v === "/explore" || v.startsWith("/explore ")) {
      const q = v.slice("/explore".length).trim();
      if (!q) {
        add({ kind: "system", text: "usage: /explore <question>" });
        return;
      }
      if (!acquireBusy()) return;
      try {
        add({ kind: "system", text: `explore: ${q}` });
        const result = await agentRef.current.spawnChild({
          description: "explore",
          subagent_type: "explore",
          prompt: q,
        });
        add({ kind: result.isError ? "error" : "assistant", text: result.output });
      } finally {
        releaseBusy();
      }
      return;
    }
    if (v === "/hooks") {
      add({ kind: "system", text: formatHookSet(hooks) });
      return;
    }
    if (v === "/worktree" || v.startsWith("/worktree ")) {
      const rest = v.slice("/worktree".length).trim();
      const [sub, ...argParts] = rest.split(/\s+/);
      const arg = argParts.join(" ").trim();
      if (!sub || sub === "list") {
        const disk = worktreeOps?.list() ?? [];
        const session = new Set(agentRef.current.sessionWorktrees());
        if (!disk.length) {
          add({ kind: "system", text: "no git worktrees under .polycode/worktrees" });
          return;
        }
        add({
          kind: "system",
          text: disk
            .map((p) => {
              const rel = relative(cwd, p) || p;
              return session.has(p) ? `${rel}  (this session)` : rel;
            })
            .join("\n"),
        });
        return;
      }
      if (!worktreeOps) {
        add({ kind: "error", text: "worktree helpers unavailable in this session" });
        return;
      }
      if ((sub === "apply" || sub === "remove") && !arg) {
        add({ kind: "system", text: `usage: /worktree ${sub} <id>` });
        return;
      }
      try {
        if (sub === "apply") {
          const r = await worktreeOps.apply(arg);
          add({
            kind: "system",
            text: r.files.length
              ? `applied ${relative(cwd, r.path)} → ${r.files.join(", ")}`
              : `applied ${relative(cwd, r.path)} (no file changes)`,
          });
        } else if (sub === "remove") {
          const path = await worktreeOps.remove(arg);
          add({ kind: "system", text: `removed ${relative(cwd, path)}` });
        } else {
          add({ kind: "system", text: "usage: /worktree list|apply <id>|remove <id>" });
        }
      } catch (e) {
        add({ kind: "error", text: String(e) });
      }
      return;
    }
    if (v === "/workflows") {
      const list = workflows.length
        ? workflows.map((w) => `${w.name}  (${w.source})  ${w.description ?? ""}`.trimEnd()).join("\n")
        : "no workflows loaded";
      add({ kind: "system", text: list });
      return;
    }
    if (v === "/workflow" || v.startsWith("/workflow ")) {
      const rest = v.slice("/workflow".length).trim();
      if (!rest) {
        add({ kind: "system", text: "usage: /workflow <name> [query]  (see /workflows)" });
        return;
      }
      const name = rest.split(/\s+/)[0];
      const argStr = rest.slice(name.length).trim();
      const wf = workflows.find((w) => w.name === name);
      if (!wf) {
        add({
          kind: "error",
          text: `unknown workflow "${name}"${workflows.length ? ` · ${workflows.map((w) => w.name).join(", ")}` : ""}`,
        });
        return;
      }
      const vars = parseWorkflowArgs(argStr);
      const q = vars.query ?? "";
      vars.slug ??=
        (q || name)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 48) || name;
      add({ kind: "system", text: `workflow ${wf.name}: ${q || "(no query)"}` });
      if (!acquireBusy()) return;
      try {
        const host = hostFromSpawn((job) => agentRef.current.spawnChild(job));
        const { synthesis, parts } = await runWorkflowFile(host, wf, vars);
        const text = synthesis?.output ?? parts.map((p) => p.output).join("\n\n") ?? "(empty workflow)";
        add({ kind: synthesis?.isError ? "error" : "assistant", text });
      } catch (e) {
        add({ kind: "error", text: String(e) });
      } finally {
        releaseBusy();
      }
      persist();
      return;
    }
    if (v === "/graphs") {
      const list = graphs.length
        ? graphs.map((g) => `${g.name}  (${g.source})  ${g.description ?? ""}`.trimEnd()).join("\n")
        : "no graphs (add .polycode/graphs/<name>.json)";
      add({ kind: "system", text: list });
      return;
    }
    if (v === "/graph" || v.startsWith("/graph ")) {
      const rest = v.slice("/graph".length).trim();
      const store = new FileCheckpointStore(join(cwd, ".polycode", "graph-runs"));
      if (!rest || rest === "list") {
        const runs = store.list();
        add({
          kind: "system",
          text: runs.length
            ? runs.map((r) => `${r.threadId}  ${r.status}  ${r.graph}  ${r.steps} steps`).join("\n")
            : graphs.length
              ? `usage: /graph <name> [query] · /graph resume <id>\n${graphs.map((g) => g.name).join(", ")}`
              : "no graphs loaded",
        });
        return;
      }
      const [first, ...more] = rest.split(/\s+/);
      if (first === "resume" || first === "status") {
        const id = more[0];
        if (!id) {
          add({ kind: "system", text: `usage: /graph ${first} <thread-id>` });
          return;
        }
        const snap = store.load(id);
        if (!snap) {
          add({ kind: "error", text: `unknown graph thread ${id}` });
          return;
        }
        if (first === "status") {
          add({ kind: "system", text: formatGraphRun(snap) });
          return;
        }
        const g = graphs.find((x) => x.name === snap.graph);
        if (!g) {
          add({ kind: "error", text: `graph "${snap.graph}" is not loaded` });
          return;
        }
        if (!acquireBusy()) return;
        try {
          const compiled = compileGraph(g);
          const host = graphHostFromSpawn((job) => agentRef.current.spawnChild(job));
          const cp = await runGraph({ compiled, host, store, threadId: id, resume: true });
          add({ kind: cp.status === "failed" ? "error" : "assistant", text: formatGraphRun(cp) });
        } catch (e) {
          add({ kind: "error", text: String(e) });
        } finally {
          releaseBusy();
        }
        persist();
        return;
      }
      const g = graphs.find((x) => x.name === first);
      if (!g) {
        add({
          kind: "error",
          text: `unknown graph "${first}"${graphs.length ? ` · ${graphs.map((x) => x.name).join(", ")}` : ""}`,
        });
        return;
      }
      const query = more.join(" ").trim();
      if (!acquireBusy()) return;
      try {
        const compiled = compileGraph(g);
        const host = graphHostFromSpawn((job) => agentRef.current.spawnChild(job));
        const threadId = newThreadId();
        add({ kind: "system", text: `graph ${g.name}  thread ${threadId}` });
        const cp = await runGraph({
          compiled,
          host,
          store,
          threadId,
          input: { query },
        });
        add({ kind: cp.status === "failed" ? "error" : "assistant", text: formatGraphRun(cp) });
      } catch (e) {
        add({ kind: "error", text: String(e) });
      } finally {
        releaseBusy();
      }
      persist();
      return;
    }
    if (v === "/mcp") {
      if (!mcpStatus.length) {
        add({ kind: "system", text: "no MCP servers (add .polycode/mcp.json)" });
        return;
      }
      const deferred = new Set(tools.filter((t) => t.schemaDeferred).map((t) => t.name));
      add({
        kind: "system",
        text: mcpStatus
          .map((s) => {
            if (!s.ok) return `${s.name}: FAIL ${s.error ?? ""}`;
            const nDef = s.tools.filter((n) => deferred.has(n)).length;
            return `${s.name}: ok (${s.tools.length} tools${nDef ? `, ${nDef} deferred — mcp_search` : ""})`;
          })
          .join("\n"),
      });
      return;
    }
    if (v === "/statusline" || v.startsWith("/statusline ")) {
      const rest = v.slice("/statusline".length).trim();
      if (!rest || rest === "show") {
        add({
          kind: "system",
          text:
            `statusline: ${statusTemplate}\n` +
            "tokens: $model $mode $route $sandbox $ctx $ctx_seg $ctx_pct $sum $sum_seg $mcp $mcp_seg $deferred $cost $cost_seg $cwd",
        });
        return;
      }
      if (rest === "default" || rest === "reset") {
        setStatusTemplate(DEFAULT_STATUS_TEMPLATE);
        add({ kind: "system", text: "statusline → default" });
        return;
      }
      setStatusTemplate(rest);
      add({ kind: "system", text: `statusline → ${rest}` });
      return;
    }
    if (v === "/plugins") {
      add({
        kind: "system",
        text: pluginList.length
          ? pluginList
              .map((p) => `${p.name}${p.version ? `@${p.version}` : ""}  (${p.source})  ${p.description}`)
              .join("\n")
          : "no plugins (add .polycode/plugins/<name>/plugin.json)",
      });
      return;
    }
    if (v === "/skills") {
      const list = skills.length
        ? skills.map((s) => `/${s.name}  (${s.source})  ${s.description}`).join("\n")
        : "no skills loaded";
      add({ kind: "system", text: list });
      return;
    }
    if (v === "/team" || v.startsWith("/team ")) {
      const q = v.slice("/team".length).trim();
      if (!q) {
        add({ kind: "system", text: "usage: /team <task>  — parallel explore, worktree implement, review" });
        return;
      }
      add({ kind: "system", text: `team: ${q}` });
      const slug =
        q
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 48) || "task";
      if (!acquireBusy()) return;
      try {
        const host = hostFromSpawn((job) => agentRef.current.spawnChild(job));
        const { synthesis, parts } = await runWorkflowFile(host, teamWorkflow(), { query: q, slug });
        const text =
          synthesis?.output ?? parts.map((p) => p.output).join("\n\n") ?? "(empty team run)";
        add({ kind: synthesis?.isError ? "error" : "assistant", text });
      } catch (e) {
        add({ kind: "error", text: String(e) });
      } finally {
        releaseBusy();
      }
      persist();
      return;
    }
    if (v === "/deep-research" || v.startsWith("/deep-research ")) {
      const q = v.slice("/deep-research".length).trim();
      if (!q) {
        add({ kind: "system", text: "usage: /deep-research <question>" });
        return;
      }
      add({ kind: "system", text: `deep-research: ${q}` });
      const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "query";
      if (!acquireBusy()) return;
      try {
        const host = hostFromSpawn((job) => agentRef.current.spawnChild(job));
        const { synthesis } = await runWorkflowFile(host, deepResearchWorkflow(), { query: q, slug });
        add({ kind: synthesis?.isError ? "error" : "assistant", text: synthesis?.output ?? "(no synthesis)" });
      } catch (e) {
        add({ kind: "error", text: String(e) });
      } finally {
        releaseBusy();
      }
      persist();
      return;
    }
    const skillHit = skills.find((s) => v === `/${s.name}` || v.startsWith(`/${s.name} `));
    if (skillHit && resolveSkill) {
      const args = v.slice(skillHit.name.length + 1).trim();
      const body = resolveSkill(skillHit.name, args);
      if (!body) {
        add({ kind: "error", text: `skill ${skillHit.name} failed to expand` });
        return;
      }
      if (!acquireBusy()) return;
      try {
        add({ kind: "user", text: v });
        commit();
        setVerb(WORK_VERBS[Math.floor(Math.random() * WORK_VERBS.length)]);
        const blocked = await agentRef.current.submitPrompt(body);
        if (blocked.blocked) {
          add({ kind: "error", text: `prompt blocked: ${blocked.reason}` });
          return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        await drive(controller.signal);
      } finally {
        releaseBusy();
      }
      return;
    }
    if (v === "/cost") {
      add({ kind: "system", text: agentRef.current.formatCost() });
      return;
    }
    if (v === "/memory" || v.startsWith("/memory ")) {
      const rest = v.slice("/memory".length).trim();
      const [sub, ...noteParts] = rest.split(/\s+/);
      const note = noteParts.join(" ").trim();
      try {
        if (!sub || sub === "show") {
          const body = await readMemory(sandbox);
          add({
            kind: "system",
            text: body.trim() ? body : `(empty ${MEMORY_PATH} — /memory add <note> or the memory tool)`,
          });
          return;
        }
        if (sub === "clear") {
          await replaceMemory(sandbox, "");
          add({ kind: "system", text: `cleared ${MEMORY_PATH}` });
          return;
        }
        if (sub === "add") {
          if (!note) {
            add({ kind: "system", text: "usage: /memory add <note>" });
            return;
          }
          const r = await appendMemory(sandbox, note);
          add({ kind: "system", text: `remembered → ${r.path} (${r.bytes} bytes)` });
          return;
        }
        const r = await appendMemory(sandbox, rest);
        add({ kind: "system", text: `remembered → ${r.path} (${r.bytes} bytes)` });
      } catch (e) {
        add({ kind: "error", text: String(e) });
      }
      return;
    }
    if (v === "/image" || v.startsWith("/image ")) {
      const rest = v.slice("/image".length).trim();
      if (!rest) {
        add({ kind: "system", text: "usage: /image <path> [caption]  (png/jpg/gif/webp · @shot.png also works)" });
        return;
      }
      const [imgPath, ...capParts] = rest.split(/\s+/);
      const caption = capParts.join(" ").trim() || `See attached image (${imgPath}).`;
      if (!acquireBusy()) return;
      try {
        const image = await loadImagePart(imgPath, sandbox);
        add({ kind: "user", text: `${caption} [image ${image.path}]` });
        const active = agentRef.current.getProvider();
        if (!active.capabilities().supportsVision) {
          add({ kind: "system", text: `warning: ${active.id}:${active.model} does not advertise vision` });
        }
        commit();
        setVerb(WORK_VERBS[Math.floor(Math.random() * WORK_VERBS.length)]);
        const blocked = await agentRef.current.submitPrompt(caption, [image]);
        if (blocked.blocked) {
          add({ kind: "error", text: `prompt blocked: ${blocked.reason}` });
          return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        await drive(controller.signal);
      } catch (e) {
        add({ kind: "error", text: String(e) });
      } finally {
        releaseBusy();
      }
      return;
    }
    if (v === "/todo") {
      const items = agentRef.current.listTodos();
      add({
        kind: "system",
        text: items.length
          ? items.map((t) => `- [${t.status}] ${t.id}: ${t.content}`).join("\n")
          : "(empty todo list)",
      });
      return;
    }
    if (v === "/deep-research-review" || v.startsWith("/deep-research-review ")) {
      const target = v.slice("/deep-research-review".length).trim() || "the current design / claims";
      add({ kind: "system", text: `deep-research-review: ${target}` });
      if (!acquireBusy()) return;
      try {
        const extract = await agentRef.current.spawnChild({
          description: "extract claims",
          subagent_type: "explore",
          prompt: `Read ${target} if it is a path, else use the user framing. Extract numbered atomic testable claims (C1, C2, …). Return at most 8.`,
        });
        const review = await agentRef.current.spawnChild({
          description: "refute claims",
          subagent_type: "researcher",
          prompt: `For each claim below, try to REFUTE it with web_search + web_fetch primaries. Verdict holds | holds-with-caveat | fails | unknown. Cite URLs.\n\n${extract.output}`,
        });
        const path = `.polycode/reviews/research-review-${Date.now()}.md`;
        add({ kind: "user", text: v });
        commit();
        const blocked = await agentRef.current.submitPrompt(
          `Write ANNOTATED bibliography + fidelity scorecard to ${path} from these notes. Lead with what died vs survived.\n\n## Claims\n${extract.output}\n\n## Research\n${review.output}`,
        );
        if (blocked.blocked) {
          add({ kind: "error", text: `prompt blocked: ${blocked.reason}` });
          return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        await drive(controller.signal);
      } finally {
        releaseBusy();
      }
      return;
    }
    if (v === "/context") {
      add({ kind: "system", text: agentRef.current.formatContext() });
      return;
    }
    if (v === "/compact" || v.startsWith("/compact ")) {
      const focus = v.slice("/compact".length).trim() || undefined;
      const stats = await agentRef.current.compactNow("manual", focus);
      if (!stats) {
        add({ kind: "system", text: "compact skipped (disabled or nothing to do)" });
        return;
      }
      add({
        kind: "system",
        text: `compacted ${fmtK(stats.before)} → ${fmtK(stats.after)} (${stats.pass}${stats.suppressed ? ", suppressed" : ""})`,
      });
      persist();
      return;
    }
    if (v === "/rewind" || v === "/undo") {
      const r = await agentRef.current.rewind();
      if (!r) {
        add({ kind: "system", text: "nothing to rewind" });
        return;
      }
      const next = messagesToEntries([...agentRef.current.history()]);
      entriesRef.current = next;
      setEntries(next);
      setCommitted(next.length);
      add({
        kind: "system",
        text: `rewound ${r.dropped} messages · restored ${r.files.length ? r.files.join(", ") : "no files"}`,
      });
      persist();
      return;
    }
    if (v === "/model" || v.startsWith("/model ")) {
      const arg = v.slice("/model".length).trim();
      if (!arg) {
        add({ kind: "system", text: `model ${modelLabel} · usage: /model <provider:model>` });
        return;
      }
      if (!onModelSwitch) return add({ kind: "error", text: "model switching unavailable" });
      try {
        const next = onModelSwitch(arg);
        switchTo(next, `${next.id}:${next.model}`);
        add({ kind: "system", text: `model → ${next.id}:${next.model}` });
      } catch (e) {
        add({ kind: "error", text: String(e) });
      }
      return;
    }

    if (v.startsWith("/")) {
      const extra = skills.map((s) => s.name);
      if (!isKnownSlash(v, extra)) {
        add({ kind: "system", text: unknownSlashMessage(v, extra) });
        return;
      }
    }

    await kickTurn(v);
  };

  const sandboxLabel = sandbox.root.startsWith("docker:") ? "docker" : "local";
  const statusVars: StatusLineVars = {
    model: modelLabel,
    mode,
    route: autoRoute ? "on" : "off",
    sandbox: sandboxLabel,
    ctxUsed: ctxTokens,
    ctxWindow,
    sessionTokens: sessionTok.in + sessionTok.out,
    mcpOk: mcpStatus.filter((s) => s.ok).length,
    mcpTotal: mcpStatus.length,
    mcpDeferred: tools.filter((t) => t.schemaDeferred).length,
    cost: compactCostUsd([...agentRef.current.usageLedger()]),
    cwd,
  };
  const statusText = statusCmdOut ?? formatStatusLine(statusTemplate, statusVars);
  const staticRows: StaticRow[] = [
    { kind: "banner" },
    ...entries.slice(0, committed).map((entry) => ({ kind: "row" as const, entry })),
  ];
  const liveEntries = entries.slice(committed);

  return (
    <Box flexDirection="column">
      {/* Finished turns: printed once to scrollback, never repainted → no flicker. */}
      <Static items={staticRows}>
        {(row, i) =>
          row.kind === "banner" ? (
            <Banner key="banner" cwd={cwd} />
          ) : (
            <EntryView key={i} entry={row.entry} />
          )
        }
      </Static>

      {/* Live region: the in-progress turn + composer (the only repainting part). */}
      {liveEntries.map((e, i) => (
        <EntryView key={committed + i} entry={e} />
      ))}

      {showSettings ? (
        <Settings
          validate={validate}
          onAgentic={onAgentic}
          onDone={() => {
            hydrateEnv();
            setShowSettings(false);
            add({
              kind: "system",
              text: "settings saved · run /model to apply a changed key to the active provider",
            });
          }}
        />
      ) : perm ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.warning}
          paddingX={1}
          marginTop={1}
        >
          <Text color={theme.warning}>
            Permission required <Text color={theme.dim}>· mode {mode}</Text>
          </Text>
          <Text>
            {sym.bullet} <Text bold>{cap(perm.tool.name)}</Text>(
            <Text color={theme.dim}>{trunc(formatToolCall(perm.tool.name, perm.input), ARG_WIDTH)}</Text>
            ) <Text color={theme.dim}>[{perm.tool.permission}]</Text>
          </Text>
          <Text color={theme.dim}>
            {perm.repeat ? (
              <>
                <Text color={theme.success}>a</Text> allow {perm.tool.name} for this session (stops these
                prompts) · <Text color={theme.success}>y</Text> once ·{" "}
                <Text color={theme.error}>n</Text> deny
              </>
            ) : (
              <>
                <Text color={theme.success}>y</Text>/enter once ·{" "}
                <Text color={theme.success}>a</Text> allow {perm.tool.name} for this session ·{" "}
                <Text color={theme.error}>n</Text>/esc deny
              </>
            )}
          </Text>
        </Box>
      ) : showHelp ? (
        <Help skills={skills} onClose={() => setShowHelp(false)} />
      ) : showDashboard ? (
        <Dashboard
          runs={dashRuns}
          personas={personas}
          onRefresh={refreshDash}
          onKill={(id) => {
            const r = agentRef.current.killChild(id);
            add({ kind: "system", text: r.output });
            refreshDash();
          }}
          onPeek={(id) => agentRef.current.peekChild(id)}
          onAttach={(id) => {
            const p = agentRef.current.peekChild(id);
            if (!p) {
              add({ kind: "error", text: `unknown child ${id}` });
              return;
            }
            add({
              kind: "system",
              text: `attached ${p.id} (${p.status}) ${p.description}\n${p.output || "(no output yet)"}`,
            });
            setShowDashboard(false);
          }}
          onClose={() => setShowDashboard(false)}
        />
      ) : (
        <>
          <Box
            borderStyle="round"
            borderColor={theme[composerBorder(mode)]}
            paddingX={1}
            marginTop={1}
          >
            <Text color={theme.accent}>{sym.prompt} </Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder={composerPlaceholder(mode)}
            />
          </Box>
          {input.startsWith("/") && !input.includes(" ")
            ? matchSlash(input)
                .slice(0, 6)
                .map((c) => (
                  <Text key={c.name} color={theme.dim}>
                    {"  "}/{c.name}
                    {c.usage ? ` ${c.usage}` : ""}
                    {"  "}
                    {c.summary}
                  </Text>
                ))
            : null}
          <Text color={theme.dim}>
            {busy ? (
              <Text color={theme.accent}>
                <Spinner type="dots" /> {verb}…{" "}
                <Text color={theme.dim}>({elapsed}s · esc interrupt · Ctrl+B background)</Text>
              </Text>
            ) : exitHint ? (
              <Text color={theme.warning}>{"  "}Ctrl+C again to exit</Text>
            ) : (
              <Text>
                {"  "}
                {statusText}
              </Text>
            )}
          </Text>
        </>
      )}
    </Box>
  );
}

function EntryView({ entry: e }: { entry: Entry }) {
  switch (e.kind) {
    case "user":
      return (
        <Text>
          <Text color={theme.accent}>{sym.prompt} </Text>
          {e.text}
        </Text>
      );
    case "assistant":
      return (
        <Box flexDirection="row">
          <Text color={theme.accent}>{sym.bullet} </Text>
          <Box flexDirection="column">
            <Markdown text={e.text} />
          </Box>
        </Box>
      );
    case "tool":
      return (
        <Box flexDirection="column">
          <Text>
            <Text color={theme.tool}>{sym.bullet} </Text>
            <Text bold>{cap(e.name)}</Text>(
            <Text color={theme.dim}>{trunc(formatToolCall(e.name, e.input), ARG_WIDTH)}</Text>)
          </Text>
          {e.denied ? (
            <Text color={theme.error}>
              {"  "}
              {sym.branch} denied: {e.reason ?? "permission"}
            </Text>
          ) : e.display != null ? (
            <DiffView display={e.display} />
          ) : e.result != null ? (
            <ToolOutput output={e.result} isError={e.isError} />
          ) : (
            <Text color={theme.dim}>
              {"  "}
              {sym.branch} …
            </Text>
          )}
        </Box>
      );
    case "system":
      return (
        <Text color={theme.dim}>
          {"  "}
          {e.text}
        </Text>
      );
    case "error":
      return <Text color={theme.error}>{e.text}</Text>;
  }
}

/** Multi-line tool output under the ⎿ branch, capped with a "+N lines" hint. */
function ToolOutput({ output, isError }: { output: string; isError?: boolean }) {
  const all = output.replace(/\s+$/, "").split("\n");
  const shown = all.slice(0, MAX_RESULT_LINES);
  const more = all.length - shown.length;
  const color = isError ? theme.error : theme.dim;
  return (
    <Box flexDirection="column">
      {shown.map((ln, i) => (
        <Text key={i} color={color}>
          {i === 0 ? `  ${sym.branch} ` : "    "}
          {ln}
        </Text>
      ))}
      {more > 0 ? (
        <Text color={theme.dim}>
          {"    "}… +{more} lines
        </Text>
      ) : null}
    </Box>
  );
}

/** Colored unified diff (+ green / - red / context dim) under the ⎿ branch. */
function DiffView({ display }: { display: string }) {
  const all = display.split("\n");
  const shown = all.slice(0, MAX_DIFF_LINES);
  const more = all.length - shown.length;
  return (
    <Box flexDirection="column">
      {shown.map((ln, i) => {
        const color = ln.startsWith("+")
          ? theme.success
          : ln.startsWith("-")
            ? theme.error
            : theme.dim;
        return (
          <Text key={i} color={color}>
            {i === 0 ? `  ${sym.branch} ` : "    "}
            {ln}
          </Text>
        );
      })}
      {more > 0 ? (
        <Text color={theme.dim}>
          {"    "}… +{more} lines
        </Text>
      ) : null}
    </Box>
  );
}

/** Claude-Code-style tool header arg: `Read(path)` not `Read({"path":…})`. */
function formatToolCall(name: string, input: unknown): string {
  const a = (input ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
  let primary = "";
  switch (name) {
    case "read":
    case "write":
    case "edit":
    case "multi_edit":
    case "ls":
      primary = s("path");
      break;
    case "grep":
      primary = [s("pattern"), a.glob ? `glob=${String(a.glob)}` : ""].filter(Boolean).join(" ");
      break;
    case "glob":
      primary = s("pattern");
      break;
    case "bash":
      primary = s("command");
      break;
    case "web_fetch":
      primary = s("url");
      break;
    case "web_search":
      primary = s("query");
      break;
    case "task":
      primary = s("description") || s("subagent_type");
      break;
    case "todo_write":
      primary = `${Array.isArray((input as any)?.items) ? (input as any).items.length : 0} items`;
      break;
    case "memory":
      primary = [s("action"), s("content")].filter(Boolean).join(" ");
      break;
    case "mcp_search":
      primary = s("query") || "*";
      break;
    case "lsp":
      primary = [s("action"), s("path")].filter(Boolean).join(" ");
      break;
  }
  // Fall back to raw input so a malformed/dangerous call is never shown blank.
  return primary || compact(input);
}

type ToolEntry = Extract<Entry, { kind: "tool" }>;

/** Rebuild the visible history from a resumed conversation (no diffs — those
 * live in the UI-only display channel and aren't persisted). */
function messagesToEntries(messages: CanonicalMessage[]): Entry[] {
  const out: Entry[] = [];
  const toolById = new Map<string, ToolEntry>(); // O(1) tool_result → tool_call match
  for (const m of messages) {
    if (m.role === "user") {
      const text = textOf(m.content);
      if (text) out.push({ kind: "user", text });
    } else if (m.role === "assistant") {
      const text = textOf(m.content);
      if (text) out.push({ kind: "assistant", text });
      for (const p of m.content) {
        if (p.type === "tool_call") {
          const t: ToolEntry = { kind: "tool", id: p.id, name: p.name, input: p.input };
          out.push(t);
          toolById.set(p.id, t);
        }
      }
    } else if (m.role === "tool") {
      for (const p of m.content) {
        if (p.type === "tool_result") {
          const t = toolById.get(p.id); // orphan results (truncated history) are dropped
          if (t) {
            t.result = p.output;
            t.isError = p.isError;
          }
        }
      }
    }
  }
  return out;
}

function textOf(content: CanonicalMessage["content"]): string {
  return content
    .map((p) => {
      if (p.type === "text") return p.text;
      if (p.type === "image") return `[image ${p.path ?? p.mediaType}]`;
      return "";
    })
    .filter(Boolean)
    .join("");
}

/** Safe to persist/resume only if the history doesn't end on an assistant turn
 * whose tool calls have no results yet (providers reject that on replay). */
function isResumable(messages: CanonicalMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last) return false;
  if (last.role === "assistant" && last.content.some((p) => p.type === "tool_call")) return false;
  return true;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function trunc(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}
function compact(input: unknown): string {
  const s = JSON.stringify(input);
  return s ?? "";
}
function fmtK(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k < 10 ? k.toFixed(1) : Math.round(k).toString()) + "k";
}
