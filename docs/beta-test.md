# Beta test — buddy playbook

polycode is a **terminal** coding agent (not a website). Your buddy runs it on their
machine, or sits at yours. Results of automated checks + a fill-in checklist are logged
**locally** under `.polycode/beta-logs/` (gitignored — never committed, no API keys).

## You (host)

From the repo:

```powershell
corepack pnpm -C "C:\Users\gasan\OneDrive\Dev\Projects\polycode" install
corepack pnpm -C "C:\Users\gasan\OneDrive\Dev\Projects\polycode" beta -- --tester you
```

That runs typecheck + the unit suite and writes two local files (gitignored):

- `.polycode/beta-logs/<timestamp>_you.md`
- `.polycode/beta-logs/LATEST.md` (last **automated** run — send this one; checklist-only does not overwrite it)

Live model round-trip (needs a Grok key already saved):

```powershell
corepack pnpm -C "C:\Users\gasan\OneDrive\Dev\Projects\polycode" beta -- --tester you --smoke xai:grok-4.3
```

Checklist-only (no test run — just a blank log for a session):

```powershell
corepack pnpm -C "C:\Users\gasan\OneDrive\Dev\Projects\polycode" beta -- --tester buddy --checklist-only
```

Send your buddy **that markdown file** after they fill the checkboxes. Not `.env`, not the keychain.

## Your buddy (first 10 minutes)

1. Node 20+ installed.
2. In the repo:

```powershell
corepack pnpm install
corepack pnpm dev
```

3. Settings: arrow to **xAI (Grok)** (not Meta Muse). Enter → paste `xai-…` key → Enter.
   Chat should open. If stuck, they have a Grok key in `.env` as `XAI_API_KEY=` or `GROK_API_KEY=` and press **i**.
4. Work through the checklist in the log file (or below). Mark pass/fail. No keys in notes.
5. Quit with `/exit`.

### What to try

| Try | Expect |
|---|---|
| `/help` | Overlay of commands, Esc closes |
| `/mo` + Tab | Completes toward `/mode` or `/model` |
| “what is this repo?” | Tools run; answer mentions polycode |
| `/mode plan` then “edit README” | Writes refused |
| `/mode ask` then a tiny edit | `y` / `a` / `n` prompt |
| `/team add a comment in README` | Explorers, then a worktree implement (git repo) |
| `/dashboard` | Child list; Enter peek; `a` attach |
| Long turn + **Ctrl+B** | Composer comes back; kids still in dashboard |
| `/loop 15s say ping` | Recurring line; `/loop stop` ends it |
| `/hepl` | Error “did you mean /help?” — not sent to Grok |

## Safety for a buddy on your box

- Use **ask** mode (`/mode ask`), not yolo.
- They should not need `--serve` (hosted HTTP).
- Their key: they paste their own Grok key, or you temporarily set one and `/settings` when they leave.
- Logs in `.polycode/beta-logs/` are local only.

## After the session

Give them the survey (pick one):

- Fill-in page: open [`beta-survey.html`](beta-survey.html) in a browser — Download answers, drop the `.md` in `.polycode/beta-logs/`
- Markdown: [`beta-survey.md`](beta-survey.md)

```powershell
corepack pnpm beta -- --tester buddy-name --checklist-only
```

Keep the filled survey in `.polycode/beta-logs/`. Not `.env`, not the keychain.
