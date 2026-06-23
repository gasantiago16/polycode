/**
 * Render docs/*.md → docs/html/*.html with a shared template + nav.
 *   corepack pnpm docs
 *
 * Keeps the HTML in sync with the Markdown so the repo carries both formats
 * (full continuity) without hand-maintaining HTML.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = join(here, "..", "docs");
const outDir = join(docsDir, "html");

// Ordered nav. Files not listed are appended alphabetically.
const ORDER: Array<[string, string]> = [
  ["index.md", "Overview"],
  ["architecture.md", "Architecture"],
  ["getting-started.md", "Getting Started"],
  ["configuration.md", "Configuration"],
  ["providers.md", "Providers & Models"],
  ["security.md", "Security & Keys"],
  ["cli.md", "CLI Reference"],
  ["packages.md", "Packages"],
  ["deploy.md", "Build & Deploy"],
  ["continuity.md", "Continuity / Handoff"],
];

function htmlName(md: string): string {
  return md.replace(/\.md$/, ".html");
}

function rewriteLinks(html: string): string {
  // local .md links → .html (leave http(s) and anchors-only links alone)
  return html.replace(/href="(?!https?:)([^"]+?)\.md(#[^"]*)?"/g, 'href="$1.html$2"');
}

function page(title: string, body: string, nav: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · polycode docs</title>
<style>
  :root { --fg:#1c2128; --muted:#656d76; --bg:#fff; --side:#f6f8fa; --bd:#d0d7de; --link:#0969da; --code:#f6f8fa; }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:var(--fg); background:var(--bg); }
  .wrap { display:flex; min-height:100vh; }
  nav { width:260px; flex:0 0 260px; background:var(--side); border-right:1px solid var(--bd); padding:24px 18px; }
  nav h1 { font-size:18px; margin:0 0 14px; }
  nav a { display:block; padding:6px 10px; border-radius:6px; color:var(--fg); text-decoration:none; font-size:14px; }
  nav a:hover { background:#eaeef2; }
  nav a.active { background:#ddf4ff; color:var(--link); font-weight:600; }
  main { flex:1; padding:40px 48px; max-width:860px; }
  a { color:var(--link); text-decoration:none; }
  a:hover { text-decoration:underline; }
  h1,h2,h3 { line-height:1.25; }
  h1 { border-bottom:1px solid var(--bd); padding-bottom:.3em; }
  h2 { border-bottom:1px solid var(--bd); padding-bottom:.3em; margin-top:2em; }
  code { background:var(--code); padding:.15em .4em; border-radius:6px; font-size:85%; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; }
  pre { background:var(--code); padding:16px; border-radius:8px; overflow:auto; }
  pre code { background:none; padding:0; }
  table { border-collapse:collapse; width:100%; margin:1em 0; display:block; overflow-x:auto; }
  th,td { border:1px solid var(--bd); padding:6px 12px; text-align:left; }
  th { background:var(--side); }
  blockquote { margin:1em 0; padding:.2em 1em; color:var(--muted); border-left:4px solid var(--bd); }
  footer { color:var(--muted); font-size:13px; margin-top:48px; border-top:1px solid var(--bd); padding-top:16px; }
</style>
</head>
<body>
<div class="wrap">
<nav><h1>polycode docs</h1>${nav}</nav>
<main>
${body}
<footer>Generated from <code>docs/*.md</code> by <code>scripts/build-docs.ts</code> — run <code>corepack pnpm docs</code> to refresh.</footer>
</main>
</div>
</body>
</html>`;
}

function main(): void {
  const present = new Set(readdirSync(docsDir).filter((f) => f.endsWith(".md")));
  const ordered = ORDER.filter(([f]) => present.has(f));
  for (const f of [...present].sort()) {
    if (!ordered.some(([o]) => o === f)) ordered.push([f, f.replace(/\.md$/, "")]);
  }

  mkdirSync(outDir, { recursive: true });

  for (const [file, title] of ordered) {
    const md = readFileSync(join(docsDir, file), "utf8");
    const body = rewriteLinks(marked.parse(md, { async: false }) as string);
    const nav = ordered
      .map(([f, t]) => {
        const active = f === file ? ' class="active"' : "";
        return `<a href="${htmlName(f)}"${active}>${t}</a>`;
      })
      .join("\n");
    writeFileSync(join(outDir, htmlName(file)), page(title, body, nav), "utf8");
  }

  console.log(`docs: rendered ${ordered.length} page(s) → ${outDir}`);
}

main();
