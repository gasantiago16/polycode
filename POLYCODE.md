# polycode conventions

Diagnose → Implement → Cranky (`/review` or `/cranky`) → `pnpm test` → Merge.

- Do not merge a cranky **REJECT** (any open `bug`). Nits and suggestions do not block.
- Do not commit `.env` or API keys.
- Compaction is automatic at 85% of the model window (`/compact`, `/context`).
- Child agents (`task`, `/explore`, `/review`) are depth 1. They share the parent's sandbox and permission engine unless `isolation: "worktree"`; only context is isolated by default.
- Writes stay on the parent thread except the review child's jail under `.polycode/reviews/` and detached worktrees under `.polycode/worktrees/` (`/worktree apply` to copy back).
- JSON workflows live in `.polycode/workflows/`. Lifecycle hooks are sandbox shell commands; `PreToolUse` / `UserPromptSubmit` may deny.
- Curated memory is `.polycode/memory.md` (`/memory`, `memory` tool). Images attach with `/image` or `@file.png`.
- Plugins live in `.polycode/plugins/<name>/`. Editors talk to `poly --serve` at `/ide`. LSP is opt-in via `.polycode/lsp.json`.
