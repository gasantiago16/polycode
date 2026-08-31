---
name: forme
description: >
  Write FOR{Name}.md plus a visual self-contained HTML twin. Use when the user
  says FOR[name], FORME, /forme, or wants a project narrative.
---

# FORME — FOR{Name} project narrative (MD + HTML)

Produce **two** files. Do not ship MD only or HTML only. This harness has **no image generator** — use inline SVG + CSS cards.

## Name and paths

1. User said `FOR[Alice]` / `for gasan` → that name. Else prior `FOR*.md`. Else git user.name / `gasan`.
2. Prefer `docs/FOR{Name}.md` + `docs/FOR{Name}.html`. Else repo root.
3. File stem: no spaces (`FORgasan`).

## Research first

Read README, docs/architecture.md, package layout, recent scars. Do not invent.

## Required H2s (MD + HTML)

1. What this project is (in one breath)
2. The map of the code
3. Architecture
4. Technologies we chose (and why)
5. How the parts talk to each other
6. Bugs, scars, and how we fixed them
7. Pitfalls to avoid next time
8. What good engineers did here
9. Lessons you can steal
10. Where to go next

Voice: engaging, plain, honest about mistakes. HTML: dark essay theme, embedded CSS, TOC, at least 4 visual devices (stat chips, SVG diagram, scar cards, package cards). No CDN mermaid. No secrets.

Arguments from the user (name / extra focus): $ARGUMENTS
