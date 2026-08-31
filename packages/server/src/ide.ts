export interface IdeSnapshot {
  file?: string;
  selection?: string;
  language?: string;
  diagnostics?: string;
}

export interface IdeCatalog {
  plugins: Array<{ name: string; description: string; version?: string; source: string }>;
  skills: Array<{ name: string; description: string; source: string }>;
  tools: string[];
  agents: string[];
}

export function formatIdeBlock(snap: IdeSnapshot | undefined): string {
  if (!snap || (!snap.file && !snap.selection && !snap.diagnostics)) return "";
  const lines = ["<ide>"];
  if (snap.file) lines.push(`Active file: ${snap.file}${snap.language ? ` (${snap.language})` : ""}`);
  if (snap.selection) lines.push(`Selection:\n${snap.selection.slice(0, 8_000)}`);
  if (snap.diagnostics) lines.push(`Diagnostics:\n${snap.diagnostics.slice(0, 4_000)}`);
  lines.push("</ide>");
  return lines.join("\n");
}
