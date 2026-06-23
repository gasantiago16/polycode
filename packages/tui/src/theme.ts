// Visual language modeled on Claude Code: a warm coral accent, soft grays,
// and the ⏺ / ⎿ / ✻ glyph set.
export const theme = {
  accent: "#d97757", // coral — primary accent (banner spark, bullets, prompt)
  accentDim: "#b5654a",
  text: "white",
  dim: "gray",
  tool: "#7aa2f7", // tool calls
  success: "#9ece6a",
  error: "#f7768e",
  warning: "#e0af68",
  code: "cyan",
} as const;

export const sym = {
  spark: "✻", // welcome / working
  bullet: "⏺", // assistant turn + tool call
  branch: "⎿", // tool result (indented)
  prompt: ">", // input prompt
  check: "✓",
  cross: "✗",
} as const;

// Whimsical working verbs (Claude Code flavor).
export const WORK_VERBS = [
  "Thinking",
  "Working",
  "Cooking",
  "Pondering",
  "Crunching",
  "Reasoning",
  "Brewing",
  "Noodling",
  "Computing",
  "Tinkering",
] as const;
