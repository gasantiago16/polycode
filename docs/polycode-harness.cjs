// polycode-harness.js — talk deck, 3 Sep 2026
// Visual system adapted from crypto_hedge_fund_pitch_deck (dark, corner marks, mono labels)
// Recolored to the TUI coral #d97757. LAYOUT_WIDE 13.333" × 7.5".
// Usage: node docs/polycode-harness.js

const pptxgen = require("pptxgenjs");
const path = require("path");

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.title = "polycode — company-hosted coding harness";
pres.author = "Gasan";
pres.subject = "Internal talk, 3 September 2026";

const SW = 13.333;
const SH = 7.5;
const TOTAL = 12;

const BG = "100E0C";
const CARD = "1C1816";
const INK = "F2EBE4";
const INK_DIM = "9A9088";
const INK_DIMMER = "5C564F";
const CORAL = "D97757";
const SAGE = "8AAE8E";
const AMBER = "E8A54A";
const HAIRLINE = "2E2926";
const ROSE = "C45C4A";

const FONT_MONO = "Consolas";
const FONT_SERIF = "Georgia";
const FONT_BODY = "Calibri";
const FONT_HEAD = "Trebuchet MS";

const MARGIN_L = 0.6;
const MARGIN_R = 0.6;
const HEADER_Y = 0.32;

const IMG = {
  control: path.join(__dirname, "forme", "layers.jpg"),
  layers: path.join(__dirname, "forme", "hero.jpg"),
  loop: path.join(__dirname, "forme", "loop.jpg"),
};

const softShadow = () => ({
  type: "outer",
  color: "000000",
  blur: 8,
  offset: 2,
  angle: 90,
  opacity: 0.28,
});

function addCornerMarks(slide) {
  const len = 0.2;
  const pad = 0.22;
  const col = INK_DIMMER;
  slide.addShape(pres.shapes.LINE, { x: pad, y: pad, w: len, h: 0, line: { color: col, width: 0.75 } });
  slide.addShape(pres.shapes.LINE, { x: pad, y: pad, w: 0, h: len, line: { color: col, width: 0.75 } });
  slide.addShape(pres.shapes.LINE, { x: SW - pad - len, y: pad, w: len, h: 0, line: { color: col, width: 0.75 } });
  slide.addShape(pres.shapes.LINE, { x: SW - pad, y: pad, w: 0, h: len, line: { color: col, width: 0.75 } });
  slide.addShape(pres.shapes.LINE, { x: pad, y: SH - pad, w: len, h: 0, line: { color: col, width: 0.75 } });
  slide.addShape(pres.shapes.LINE, { x: pad, y: SH - pad - len, w: 0, h: len, line: { color: col, width: 0.75 } });
  slide.addShape(pres.shapes.LINE, { x: SW - pad - len, y: SH - pad, w: len, h: 0, line: { color: col, width: 0.75 } });
  slide.addShape(pres.shapes.LINE, { x: SW - pad, y: SH - pad - len, w: 0, h: len, line: { color: col, width: 0.75 } });
}

function addTopBar(slide, sectionName, pageNum) {
  slide.addText(
    [
      { text: "POLYCODE ", options: { color: INK } },
      { text: "// ", options: { color: INK_DIM } },
      { text: "HARNESS", options: { color: INK } },
    ],
    {
      x: MARGIN_L,
      y: HEADER_Y,
      w: 6.2,
      h: 0.32,
      fontFace: FONT_MONO,
      fontSize: 11,
      charSpacing: 2,
      margin: 0,
    },
  );
  slide.addText(
    [
      { text: "§ ", options: { color: INK_DIM } },
      { text: sectionName.toUpperCase() + "   ", options: { color: INK_DIM } },
      { text: String(pageNum).padStart(2, "0"), options: { color: CORAL } },
      { text: " / ", options: { color: INK_DIM } },
      { text: String(TOTAL).padStart(2, "0"), options: { color: INK_DIM } },
    ],
    {
      x: SW - 5.2 - MARGIN_R,
      y: HEADER_Y,
      w: 5.2,
      h: 0.32,
      fontFace: FONT_MONO,
      fontSize: 11,
      charSpacing: 2,
      align: "right",
      margin: 0,
    },
  );
}

function addEyebrow(slide, text, x, y, w, color = CORAL) {
  slide.addText(text, {
    x,
    y,
    w,
    h: 0.28,
    fontFace: FONT_MONO,
    fontSize: 11,
    color,
    charSpacing: 2.5,
    margin: 0,
  });
}

function addHairline(slide, x, y, w) {
  slide.addShape(pres.shapes.LINE, {
    x,
    y,
    w,
    h: 0,
    line: { color: HAIRLINE, width: 0.75 },
  });
}

function contentSlide(section, page) {
  const slide = pres.addSlide();
  slide.background = { color: BG };
  addCornerMarks(slide);
  addTopBar(slide, section, page);
  return slide;
}

// ------------------------------------------------------------------
// SLIDE 1 — Cover
// ------------------------------------------------------------------
{
  const slide = pres.addSlide();
  slide.background = { color: BG };
  addCornerMarks(slide);

  slide.addImage({
    path: IMG.control,
    x: 7.15,
    y: 0,
    w: 6.183,
    h: 7.5,
    sizing: { type: "cover", w: 6.183, h: 7.5 },
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 7.15,
    y: 0,
    w: 0.08,
    h: 7.5,
    fill: { color: CORAL },
  });

  slide.addShape(pres.shapes.OVAL, {
    x: MARGIN_L,
    y: HEADER_Y + 0.08,
    w: 0.14,
    h: 0.14,
    fill: { color: CORAL },
    line: { color: CORAL, width: 0 },
  });
  slide.addText("ALPHA  ·  0.1.0  ·  LOCAL TUI", {
    x: MARGIN_L + 0.28,
    y: HEADER_Y,
    w: 6.2,
    h: 0.32,
    fontFace: FONT_MONO,
    fontSize: 11,
    color: INK_DIM,
    charSpacing: 2.5,
    margin: 0,
  });

  addEyebrow(slide, "COMPANY HARNESS  /  WORK TALK", MARGIN_L, 1.7, 6.4);

  slide.addText("polycode", {
    x: MARGIN_L,
    y: 2.1,
    w: 6.4,
    h: 1.05,
    fontFace: FONT_HEAD,
    fontSize: 48,
    bold: true,
    color: INK,
    margin: 0,
  });
  slide.addText("A coding agent we host.\nOne loop. Many models.", {
    x: MARGIN_L,
    y: 3.2,
    w: 6.3,
    h: 1.15,
    fontFace: FONT_SERIF,
    fontSize: 22,
    color: CORAL,
    margin: 0,
  });
  slide.addText(
    "Graphs sit on the loop. They are not a second agent framework, not LangChain, and not Grok Build cloud.",
    {
      x: MARGIN_L,
      y: 4.5,
      w: 6.2,
      h: 0.9,
      fontFace: FONT_BODY,
      fontSize: 15,
      color: INK_DIM,
      margin: 0,
    },
  );

  slide.addText("GASAN", {
    x: MARGIN_L,
    y: 6.55,
    w: 3.2,
    h: 0.28,
    fontFace: FONT_MONO,
    fontSize: 12,
    color: INK,
    charSpacing: 2,
    margin: 0,
  });
  slide.addText("3  ·  SEP  ·  2026", {
    x: 3.6,
    y: 6.55,
    w: 3.2,
    h: 0.28,
    fontFace: FONT_MONO,
    fontSize: 12,
    color: INK_DIM,
    align: "right",
    margin: 0,
  });

  slide.addNotes(
    "Open with the TUI already running on the other screen. One sentence: this is a terminal coding agent we host, not a website and not a LangChain demo. Then go live.",
  );
}

// ------------------------------------------------------------------
// SLIDE 2 — In one breath
// ------------------------------------------------------------------
{
  const slide = contentSlide("WHAT IT IS", 2);
  addEyebrow(slide, "IN ONE BREATH", MARGIN_L, 0.85, 8);
  slide.addText("A Claude-Code-shaped TUI on a provider-blind engine.", {
    x: MARGIN_L,
    y: 1.18,
    w: 12.1,
    h: 0.5,
    fontFace: FONT_HEAD,
    fontSize: 22,
    bold: true,
    color: INK,
    margin: 0,
  });

  const cards = [
    {
      k: "IS",
      color: SAGE,
      lines: [
        "Terminal coding agent, local first",
        "Same loop for Grok, Gemini, OpenAI, Muse, NIM, Qwen, Anthropic (native SDK)",
        "Depth-1 children, worktrees, dashboard",
        "JSON graphs with file checkpoints",
      ],
    },
    {
      k: "IS NOT",
      color: ROSE,
      lines: [
        "Not LangChain / LangGraph",
        "Not Grok Build cloud or Rhai workflows",
        "Not a multi-tenant hosted product",
        "Not nested agent swarms",
      ],
    },
    {
      k: "ISOLATION",
      color: CORAL,
      lines: [
        "Bring your own key",
        "Docker --network none + path jail",
        "No training-tier models by default",
        "Hosted HTTP is a scaffold only",
      ],
    },
  ];
  cards.forEach((c, i) => {
    const x = 0.6 + i * 4.15;
    slide.addShape(pres.shapes.RECTANGLE, {
      x,
      y: 1.9,
      w: 3.95,
      h: 4.55,
      fill: { color: CARD },
      shadow: softShadow(),
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x,
      y: 1.9,
      w: 0.08,
      h: 4.55,
      fill: { color: c.color },
    });
    slide.addText(c.k, {
      x: x + 0.28,
      y: 2.1,
      w: 3.5,
      h: 0.35,
      fontFace: FONT_MONO,
      fontSize: 13,
      color: c.color,
      charSpacing: 2,
      margin: 0,
    });
    c.lines.forEach((line, j) => {
      slide.addText(line, {
        x: x + 0.28,
        y: 2.6 + j * 0.85,
        w: 3.45,
        h: 0.75,
        fontFace: FONT_BODY,
        fontSize: 14,
        color: INK,
        margin: 0,
      });
    });
  });
  slide.addNotes(
    "Three boxes, then stop. Isolation is BYOK + docker + no training-tier defaults — say that if someone asks 'how is this company-hosted.'",
  );
}

// ------------------------------------------------------------------
// SLIDE 3 — Constraints
// ------------------------------------------------------------------
{
  const slide = contentSlide("CONSTRAINTS", 3);
  addEyebrow(slide, "WHAT WE REFUSED", MARGIN_L, 0.85, 10);
  slide.addText("The harness is the product. Wrappers are not.", {
    x: MARGIN_L,
    y: 1.18,
    w: 12,
    h: 0.45,
    fontFace: FONT_HEAD,
    fontSize: 22,
    bold: true,
    color: INK,
    margin: 0,
  });

  const rows = [
    {
      n: "01",
      t: "Own the tool loop",
      d: "The SDK streams. We run tools. Permissions, redaction, and the dashboard only exist if we own that loop.",
    },
    {
      n: "02",
      t: "Canonical types, vendor at the edge",
      d: "core never imports a provider SDK. Add a model by writing an adapter — not by forking the agent.",
    },
    {
      n: "03",
      t: "One depth of children",
      d: "Explore / researcher / general / review. Children cannot spawn. Parent-only: task, graph.",
    },
    {
      n: "04",
      t: "Deny before convenience",
      d: "Protected paths beat a “safe” short-circuit. Env files are not process env. Safe is not skip-the-gate.",
    },
  ];
  rows.forEach((r, i) => {
    const y = 1.8 + i * 1.2;
    slide.addText(r.n, {
      x: MARGIN_L,
      y,
      w: 0.7,
      h: 0.9,
      fontFace: FONT_MONO,
      fontSize: 16,
      color: CORAL,
      margin: 0,
      valign: "middle",
    });
    slide.addText(r.t, {
      x: 1.45,
      y,
      w: 10.8,
      h: 0.38,
      fontFace: FONT_HEAD,
      fontSize: 16,
      bold: true,
      color: INK,
      margin: 0,
    });
    slide.addText(r.d, {
      x: 1.45,
      y: y + 0.38,
      w: 10.8,
      h: 0.5,
      fontFace: FONT_BODY,
      fontSize: 14,
      color: INK_DIM,
      margin: 0,
    });
  });
  slide.addNotes(
    "These four are the talk if the demo dies. Especially: we own the loop; we did not import LangGraph.",
  );
}

// ------------------------------------------------------------------
// SLIDE 4 — Architecture
// ------------------------------------------------------------------
{
  const slide = pres.addSlide();
  slide.background = { color: BG };
  addCornerMarks(slide);
  addTopBar(slide, "ARCHITECTURE", 4);

  slide.addImage({
    path: IMG.layers,
    x: 0,
    y: 0.85,
    w: 5.7,
    h: 6.65,
    sizing: { type: "cover", w: 5.7, h: 6.65 },
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 5.62,
    y: 0.85,
    w: 0.08,
    h: 6.65,
    fill: { color: CORAL },
  });

  addEyebrow(slide, "ONE LOOP, MANY SKINS", 5.95, 0.85, 6.8);
  slide.addText("You never talk to a vendor shape.", {
    x: 5.95,
    y: 1.18,
    w: 6.8,
    h: 0.55,
    fontFace: FONT_HEAD,
    fontSize: 20,
    bold: true,
    color: INK,
    margin: 0,
  });

  const layers = [
    { k: "TUI / CLI", v: "Ink composer, /slash, y/a/n, dashboard" },
    { k: "Agent.run()", v: "stream → tools → permission → sandbox" },
    { k: "Canonical events", v: "text_delta · tool_call · stop · error" },
    { k: "Provider adapter", v: "the only AI-SDK-aware code" },
    { k: "Sandbox", v: "local jail or docker --network none" },
    { k: "Graph / team", v: "children + checkpoints on that loop" },
  ];
  layers.forEach((L, i) => {
    const y = 1.9 + i * 0.8;
    slide.addText(L.k, {
      x: 5.95,
      y,
      w: 6.7,
      h: 0.28,
      fontFace: FONT_MONO,
      fontSize: 12,
      color: CORAL,
      charSpacing: 1.2,
      margin: 0,
    });
    slide.addText(L.v, {
      x: 5.95,
      y: y + 0.28,
      w: 6.7,
      h: 0.32,
      fontFace: FONT_BODY,
      fontSize: 14,
      color: INK,
      margin: 0,
    });
  });
  slide.addNotes(
    "Point at the glass: each pane is a package. The law: core never imports a provider. TUI and HTTP both construct an Agent.",
  );
}

// ------------------------------------------------------------------
// SLIDE 5 — Packages
// ------------------------------------------------------------------
{
  const slide = contentSlide("MONOREPO", 5);
  addEyebrow(slide, "PNPM WORKSPACE  ·  NODE 20/22", MARGIN_L, 0.85, 12);
  slide.addText("Packages depend inward. core has no provider SDK.", {
    x: MARGIN_L,
    y: 1.18,
    w: 12,
    h: 0.4,
    fontFace: FONT_HEAD,
    fontSize: 20,
    bold: true,
    color: INK,
    margin: 0,
  });

  const pkgs = [
    { n: "core", d: "loop, permissions, spawn, compaction" },
    { n: "tools", d: "read, glob, task, graph, …" },
    { n: "sandbox", d: "path jail, docker, worktrees" },
    { n: "providers", d: "AI SDK adapters only" },
    { n: "tui", d: "Ink, dashboard, statusline" },
    { n: "graph", d: "state, edges, file checkpointer" },
    { n: "workflows", d: "TS sequential / parallel budget" },
    { n: "secrets", d: "keychain, allowlisted .env" },
    { n: "cli / server", d: "pnpm dev  ·  POST /chat SSE" },
  ];
  pkgs.forEach((p, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.6 + col * 4.15;
    const y = 1.75 + row * 1.65;
    slide.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: 3.95,
      h: 1.48,
      fill: { color: CARD },
      shadow: softShadow(),
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: 3.95,
      h: 0.06,
      fill: { color: CORAL },
    });
    slide.addText("@" + "polycode/" + p.n, {
      x: x + 0.2,
      y: y + 0.22,
      w: 3.55,
      h: 0.38,
      fontFace: FONT_MONO,
      fontSize: 13,
      color: CORAL,
      margin: 0,
    });
    slide.addText(p.d, {
      x: x + 0.2,
      y: y + 0.68,
      w: 3.55,
      h: 0.55,
      fontFace: FONT_BODY,
      fontSize: 14,
      color: INK,
      margin: 0,
    });
  });
  slide.addNotes(
    "Don't tour every package. Hit core, providers, graph. Mention Anthropic is native SDK, not AI SDK.",
  );
}

// ------------------------------------------------------------------
// SLIDE 6 — The loop
// ------------------------------------------------------------------
{
  const slide = pres.addSlide();
  slide.background = { color: BG };
  addCornerMarks(slide);
  addTopBar(slide, "THE LOOP", 6);

  addEyebrow(slide, "REACT, NOT A HIDDEN SDK TOOL RUNNER", MARGIN_L, 0.85, 7.4);
  slide.addText("One stream. We execute the tools.", {
    x: MARGIN_L,
    y: 1.18,
    w: 7.4,
    h: 0.5,
    fontFace: FONT_HEAD,
    fontSize: 20,
    bold: true,
    color: INK,
    margin: 0,
  });

  const steps = [
    "You submit. Hooks can block.",
    "Router may pick cheap / strong / long.",
    "provider.stream() → canonical events.",
    "Safe tools parallel; writers sequential.",
    "Deny + protect, then mode, then y/a/n.",
    "sandbox.exec only. Output redacted.",
    "At 85% context: elide, then summarize.",
  ];
  steps.forEach((s, i) => {
    const y = 1.85 + i * 0.62;
    slide.addText(String(i + 1).padStart(2, "0"), {
      x: MARGIN_L,
      y,
      w: 0.55,
      h: 0.5,
      fontFace: FONT_MONO,
      fontSize: 14,
      color: CORAL,
      margin: 0,
      valign: "middle",
    });
    slide.addText(s, {
      x: 1.25,
      y,
      w: 6.5,
      h: 0.5,
      fontFace: FONT_BODY,
      fontSize: 15,
      color: INK,
      margin: 0,
      valign: "middle",
    });
  });

  slide.addImage({
    path: IMG.loop,
    x: 8.05,
    y: 1.75,
    w: 4.65,
    h: 3.7,
    sizing: { type: "cover", w: 4.65, h: 3.7 },
  });
  slide.addText("Permission order is a security feature.", {
    x: 8.05,
    y: 5.6,
    w: 4.65,
    h: 0.7,
    fontFace: FONT_SERIF,
    fontSize: 14,
    italic: true,
    color: INK_DIM,
    margin: 0,
  });
  slide.addNotes(
    "Modes: plan / ask / acceptEdits / yolo. Demo stays in ask, with a brief plan refuse. Repeat prompts lead with a = session always.",
  );
}

// ------------------------------------------------------------------
// SLIDE 7 — Multi-agent
// ------------------------------------------------------------------
{
  const slide = contentSlide("AGENTS", 7);
  addEyebrow(slide, "DEPTH ONE IS A FEATURE", MARGIN_L, 0.85, 12);
  slide.addText("Fan-out is not a graph. A graph is a graph.", {
    x: MARGIN_L,
    y: 1.18,
    w: 12,
    h: 0.45,
    fontFace: FONT_HEAD,
    fontSize: 22,
    bold: true,
    color: INK,
    margin: 0,
  });

  const cells = [
    { t: "Parent", d: "Full tools. Can call task and graph. Statusline c:N while kids run." },
    { t: "Explore / researcher", d: "Read-only (plus web for researcher). Safe for a live stage." },
    { t: "General / review", d: "Writers. Two in one turn get git worktrees. Isolated permission engine." },
    { t: "/team", d: "Workflow: parallel explore + worktree implement + review. Budgeted. Not a DAG." },
    { t: "/dashboard", d: "Peek, attach, kill. Last graph thread as a dim line. Ctrl+\\." },
    { t: "Caps", d: "8 live children, 32 finished GC, loops 15s–24h, max 4. No depth-2." },
  ];
  cells.forEach((c, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.6 + col * 4.15;
    const y = 1.85 + row * 2.35;
    slide.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: 3.95,
      h: 2.15,
      fill: { color: CARD },
      shadow: softShadow(),
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: 0.08,
      h: 2.15,
      fill: { color: i < 3 ? CORAL : SAGE },
    });
    slide.addText(c.t, {
      x: x + 0.28,
      y: y + 0.2,
      w: 3.5,
      h: 0.4,
      fontFace: FONT_HEAD,
      fontSize: 16,
      bold: true,
      color: INK,
      margin: 0,
    });
    slide.addText(c.d, {
      x: x + 0.28,
      y: y + 0.7,
      w: 3.5,
      h: 1.2,
      fontFace: FONT_BODY,
      fontSize: 14,
      color: INK_DIM,
      margin: 0,
    });
  });
  slide.addNotes(
    "If someone says 'LangGraph agents': /team is a workflow. /graph is the state machine. Same children, different runtime.",
  );
}

// ------------------------------------------------------------------
// SLIDE 8 — Graphs
// ------------------------------------------------------------------
{
  const slide = contentSlide("GRAPHS", 8);
  addEyebrow(slide, "LANGGRAPH-SHAPED  ·  ZERO LANGCHAIN", MARGIN_L, 0.85, 12);
  slide.addText("State, edges, super-step, checkpointer — on our loop.", {
    x: MARGIN_L,
    y: 1.18,
    w: 12,
    h: 0.42,
    fontFace: FONT_HEAD,
    fontSize: 20,
    bold: true,
    color: INK,
    margin: 0,
  });

  const map = [
    { a: "State", b: "JSON object, replace or append" },
    { a: "Node", b: "spawnChild; prompt fills from state" },
    { a: "Edge", b: "fixed, or if.field includes / equals" },
    { a: "Super-step", b: "all ready nodes, Promise.all, then save" },
    { a: "Checkpoint", b: ".polycode/graph-runs/<thread>.json" },
    { a: "Interrupt", b: "/graph resume <id> continues the machine" },
  ];
  map.forEach((m, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.6 + col * 6.3;
    const y = 1.75 + row * 1.05;
    slide.addText(m.a, {
      x,
      y,
      w: 2.1,
      h: 0.85,
      fontFace: FONT_MONO,
      fontSize: 13,
      color: CORAL,
      margin: 0,
      valign: "middle",
    });
    slide.addText(m.b, {
      x: x + 2.15,
      y,
      w: 3.9,
      h: 0.85,
      fontFace: FONT_BODY,
      fontSize: 15,
      color: INK,
      margin: 0,
      valign: "middle",
    });
  });

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.6,
    y: 5.05,
    w: 12.1,
    h: 1.55,
    fill: { color: CARD },
  });
  slide.addText("STAGE GRAPH", {
    x: 0.85,
    y: 5.18,
    w: 11.6,
    h: 0.28,
    fontFace: FONT_MONO,
    fontSize: 11,
    color: SAGE,
    charSpacing: 2,
    margin: 0,
  });
  slide.addText("demo    START → explore → __end__     explore-only, no worktree, 8 bullets", {
    x: 0.85,
    y: 5.5,
    w: 11.6,
    h: 0.4,
    fontFace: FONT_MONO,
    fontSize: 16,
    color: INK,
    margin: 0,
  });
  slide.addText("Parent graph tool · /graphs prints DAGs · onStep progress · dashboard last thread", {
    x: 0.85,
    y: 5.95,
    w: 11.6,
    h: 0.4,
    fontFace: FONT_BODY,
    fontSize: 14,
    color: INK_DIM,
    margin: 0,
  });
  slide.addNotes(
    "Live: /graphs then /graph show demo then /graph demo …. research-implement is the two-node writer graph — do not run it on stage.",
  );
}

// ------------------------------------------------------------------
// SLIDE 9 — Scars
// ------------------------------------------------------------------
{
  const slide = contentSlide("SCARS", 9);
  addEyebrow(slide, "CRANKY UNTIL APPROVE  ·  THEN A BUDDY IN THE CHAIR", MARGIN_L, 0.85, 12);
  slide.addText("Green tests are not UX. These were.", {
    x: MARGIN_L,
    y: 1.18,
    w: 12,
    h: 0.42,
    fontFace: FONT_HEAD,
    fontSize: 22,
    bold: true,
    color: INK,
    margin: 0,
  });

  const scars = [
    {
      t: ".env as RCE",
      d: "Copied every KEY=VALUE. NODE_OPTIONS could load attacker code. Fix: allowlist provider keys only.",
    },
    {
      t: "Safe skipped the jail",
      d: "read of .env auto-allowed. Fix: deny and protect run first. Order of checks is the feature.",
    },
    {
      t: "Jared, permissions 2/5",
      d: "bash + wc on Windows, then retries. /hepl looked like a crash. Fix: glob counts; a for session; system copy, not red unknown.",
    },
    {
      t: "“We are LangGraph”",
      d: "Fan-out looked like a graph. It wasn’t. Fix: @polycode/graph — named honestly, implemented on the loop.",
    },
  ];
  scars.forEach((s, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.6 + col * 6.3;
    const y = 1.8 + row * 2.35;
    slide.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: 6.05,
      h: 2.15,
      fill: { color: CARD },
      shadow: softShadow(),
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: 6.05,
      h: 0.06,
      fill: { color: AMBER },
    });
    slide.addText(s.t, {
      x: x + 0.25,
      y: y + 0.25,
      w: 5.55,
      h: 0.4,
      fontFace: FONT_HEAD,
      fontSize: 16,
      bold: true,
      color: AMBER,
      margin: 0,
    });
    slide.addText(s.d, {
      x: x + 0.25,
      y: y + 0.75,
      w: 5.55,
      h: 1.15,
      fontFace: FONT_BODY,
      fontSize: 14,
      color: INK,
      margin: 0,
    });
  });
  slide.addNotes(
    "Jared would use it again (4/5). The fail was chrome and bash-for-inventory. Teach a for session-always if a prompt pops.",
  );
}

// ------------------------------------------------------------------
// SLIDE 10 — Demo
// ------------------------------------------------------------------
{
  const slide = contentSlide("LIVE", 10);
  addEyebrow(slide, "ASK MODE  ·  NO YOLO  ·  NO --SERVE", MARGIN_L, 0.85, 12);
  slide.addText("Type this. Don’t narrate over it.", {
    x: MARGIN_L,
    y: 1.18,
    w: 12,
    h: 0.42,
    fontFace: FONT_HEAD,
    fontSize: 22,
    bold: true,
    color: INK,
    margin: 0,
  });

  const beats = [
    { c: "what is this repo?", n: "glob / grep / read — not bash + wc" },
    { c: "/hepl", n: "system: not sent to the model. Did you mean /help?" },
    { c: "/mode plan, then try an edit", n: "write refused. Permissions are visible." },
    { c: "/graphs", n: "ASCII DAGs, including demo" },
    { c: "/graph demo how the loop works…", n: "progress lines, child, checkpoint" },
    { c: "/dashboard", n: "kids + last graph thread. Statusline c:N" },
  ];
  beats.forEach((b, i) => {
    const y = 1.72 + i * 0.78;
    slide.addText(String(i + 1), {
      x: MARGIN_L,
      y,
      w: 0.4,
      h: 0.65,
      fontFace: FONT_MONO,
      fontSize: 16,
      color: CORAL,
      margin: 0,
      valign: "middle",
    });
    slide.addText(b.c, {
      x: 1.15,
      y,
      w: 6.6,
      h: 0.65,
      fontFace: FONT_MONO,
      fontSize: 15,
      color: INK,
      margin: 0,
      valign: "middle",
    });
    slide.addText(b.n, {
      x: 7.85,
      y,
      w: 4.85,
      h: 0.65,
      fontFace: FONT_BODY,
      fontSize: 14,
      color: INK_DIM,
      margin: 0,
      valign: "middle",
    });
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.6,
    y: 6.55,
    w: 12.1,
    h: 0.5,
    fill: { color: CARD },
  });
  slide.addText("BACKUP  /explore what is this repo?    ·    if bash prompts, press a (session)", {
    x: 0.8,
    y: 6.58,
    w: 11.7,
    h: 0.42,
    fontFace: FONT_MONO,
    fontSize: 13,
    color: SAGE,
    margin: 0,
    valign: "middle",
  });
  slide.addNotes(
    "Backup: /explore what is this repo? Cite packages/core and packages/graph. Full cheat sheet: docs/demo-script.md. If bash prompts, press a.",
  );
}

// ------------------------------------------------------------------
// SLIDE 11 — Shipped
// ------------------------------------------------------------------
{
  const slide = contentSlide("SHIPPED", 11);
  addEyebrow(slide, "SQUASH TO MAIN  ·  PRIVATE REPO", MARGIN_L, 0.85, 12);
  slide.addText("Built in the open of our own git history.", {
    x: MARGIN_L,
    y: 1.18,
    w: 12,
    h: 0.42,
    fontFace: FONT_HEAD,
    fontSize: 22,
    bold: true,
    color: INK,
    margin: 0,
  });

  const stats = [
    { v: "#5–#10", l: "kernel through FORME" },
    { v: "314", l: "unit tests next to the bug" },
    { v: "3", l: "cranky rounds to APPROVE" },
    { v: "4/5", l: "Jared: would use again" },
  ];
  stats.forEach((s, i) => {
    const x = 0.6 + i * 3.15;
    slide.addShape(pres.shapes.RECTANGLE, {
      x,
      y: 1.8,
      w: 3.0,
      h: 1.85,
      fill: { color: CARD },
      shadow: softShadow(),
    });
    slide.addText(s.v, {
      x,
      y: 1.95,
      w: 3.0,
      h: 0.7,
      fontFace: FONT_HEAD,
      fontSize: 26,
      bold: true,
      color: CORAL,
      align: "center",
      margin: 0,
    });
    slide.addText(s.l, {
      x: x + 0.12,
      y: 2.7,
      w: 2.76,
      h: 0.75,
      fontFace: FONT_BODY,
      fontSize: 13,
      color: INK_DIM,
      align: "center",
      margin: 0,
    });
  });

  const prs = [
    "#5  company harness kernel",
    "#6  TUI / Grok / multi-agent",
    "#7  harden + beta logger",
    "#8  permission spam + /hepl",
    "#9  @polycode/graph",
    "#10 FORgasan narrative",
  ];
  prs.forEach((p, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    slide.addText(p, {
      x: 0.7 + col * 6.3,
      y: 4.0 + row * 0.7,
      w: 6.0,
      h: 0.55,
      fontFace: FONT_MONO,
      fontSize: 16,
      color: INK,
      margin: 0,
    });
  });
  slide.addNotes(
    "This PR (demo graph, parent graph tool, DAG, deck) may still be unmerged at talk time — say what's on the branch if so. Numbers are unit tests, not a live TTY count.",
  );
}

// ------------------------------------------------------------------
// SLIDE 12 — Next
// ------------------------------------------------------------------
{
  const slide = contentSlide("NEXT", 12);
  addEyebrow(slide, "HONEST BACKLOG", MARGIN_L, 0.85, 12);
  slide.addText("Ship the loop we own. Don’t fake a cloud.", {
    x: MARGIN_L,
    y: 1.18,
    w: 12,
    h: 0.5,
    fontFace: FONT_HEAD,
    fontSize: 22,
    bold: true,
    color: INK,
    margin: 0,
  });

  const next = [
    { n: "01", t: "Live TTY is the real test", d: "Windows Terminal, a buddy, the survey. Vitest does not replace that." },
    { n: "02", t: "Hosted mode stays dark", d: "POST /chat exists. Tenant isolation does not. Do not bind it public." },
    { n: "03", t: "Graph v1 has no cross-thread store", d: "Long-term facts stay in memory.md. Decide if that is enough." },
    { n: "04", t: "Smoke the other providers", d: "Multi-model is an architecture claim. Prove it on Gemini and Muse, not only Grok." },
  ];
  next.forEach((r, i) => {
    const y = 1.85 + i * 1.15;
    slide.addText(r.n, {
      x: MARGIN_L,
      y,
      w: 0.7,
      h: 0.9,
      fontFace: FONT_MONO,
      fontSize: 16,
      color: CORAL,
      margin: 0,
      valign: "middle",
    });
    slide.addText(r.t, {
      x: 1.45,
      y,
      w: 10.8,
      h: 0.38,
      fontFace: FONT_HEAD,
      fontSize: 16,
      bold: true,
      color: INK,
      margin: 0,
    });
    slide.addText(r.d, {
      x: 1.45,
      y: y + 0.4,
      w: 10.8,
      h: 0.45,
      fontFace: FONT_BODY,
      fontSize: 14,
      color: INK_DIM,
      margin: 0,
    });
  });
  slide.addNotes(
    "Close: the ask is to keep building this harness in-house — graphs on our loop, keys on our box. Questions.",
  );
}

pres.writeFile({ fileName: path.join(__dirname, "polycode-harness.pptx") }).then(() => {
  console.log("wrote docs/polycode-harness.pptx");
});
