# polycode beta survey

Takes ~10 minutes after a TUI session. **Do not paste API keys.**

Name: _______________  
Date: _______________  
OS / terminal: Windows Terminal / macOS Terminal / other: _______________  
Time spent: _____ minutes

## First run

| | Pass | Fail | Skip |
|---|---|---|---|
| `corepack pnpm install` then `corepack pnpm dev` started | | | |
| Arrow to **xAI (Grok)** (not Meta Muse), pasted key, landed in **chat** (not stuck on settings) | | | |
| If already keyed: chat opened without a settings loop | | | |

Stuck on settings? What did you see?

________________________________________________________________

## Try these (ask mode, not yolo)

| Try | Expect | Pass | Fail | Skip | Notes |
|---|---|---|---|---|---|
| `/help` | Overlay; Esc closes | | | | |
| `/mo` then Tab | Completes toward `/mode` or `/model` | | | | |
| `what is this repo?` | Tools run; answer cites files | | | | |
| `/mode plan` then “edit README” | Writes refused | | | | |
| `/mode ask` then a tiny edit | `y` / `a` / `n` prompt | | | | |
| `/team add a comment in README` | Explorers, then worktree implement | | | | |
| `/dashboard` or Ctrl+\\ | Child list; Enter peek; `a` attach | | | | |
| Long turn + **Ctrl+B** | Composer back; kids still in dashboard | | | | |
| `/loop 15s say ping` then `/loop stop` | Recurring line, then stops | | | | |
| `/hepl` | Suggests `/help` — **not** sent to Grok | | | | |
| `/exit` then `corepack pnpm dev -- --continue` | Session resumes | | | | |

## Ratings (1 = broken / awful · 3 = ok · 5 = I’d use this)

| | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Getting in (install + first run) | | | | | |
| Chat / streaming feel | | | | | |
| Slash commands + Tab complete | | | | | |
| Permission prompts (plan / ask) | | | | | |
| Multi-agent (`/team`, dashboard, Ctrl+B) | | | | | |
| Overall vs Cursor / Claude Code / Grok Build | | | | | |

Would you use this again?  Yes / Maybe / No

## Open

What felt good?

________________________________________________________________

What was confusing or broken? (no keys)

________________________________________________________________

One thing to fix before the next person sits down:

________________________________________________________________

Anything else?

________________________________________________________________

Drop this file in `.polycode/beta-logs/` (gitignored) or send it back. Not `.env`, not the keychain.
