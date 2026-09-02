# Agent graphs (LangGraph-shaped)

polycode does **not** depend on LangChain/LangGraph. Those libraries own a Python/JS
state-machine runtime (StateGraph + checkpointer + store) tightly coupled to LangChain
messages. polycode already has a provider-blind ReAct loop, canonical tools, permissions,
and JSON sessions. This package maps the *useful* LangGraph ideas onto that loop.

## What LangGraph actually is

| Primitive | LangGraph | polycode graph |
|---|---|---|
| State | typed channels + reducers | JSON object, `replace` or `append` per key |
| Node | function `(state) => patch` | child **agent** (`spawnChild`) with a `{{state}}` prompt |
| Edge | fixed or conditional | `{ from, to }` or `{ from, to, if: { field, includes } }` |
| Super-step | run ready nodes (possibly parallel) | same: all `next` nodes in one `Promise.all` |
| Checkpointer | thread-scoped snapshot after each super-step | `.polycode/graph-runs/<thread>.json` |
| Interrupt | `interruptBefore` / human-in-the-loop | pause, `/graph resume <id>` |
| Store (cross-thread) | deferred | not in v1 — use `.polycode/memory.md` |

We do **not** import `@langchain/langgraph`. It would smash the canonical message/tool
seam and pull a second agent stack.

## Authoring

Project file `.polycode/graphs/<name>.json` (or `graphs/` under the user config dir).
Bundled: `demo` (stage-safe one-node explore, no worktree), `explore`, `research-implement`.

```json
{
  "name": "research-implement",
  "description": "Explore then worktree implement",
  "nodes": {
    "explore": {
      "subagent_type": "explore",
      "prompt": "Survey:\n\n{{query}}"
    },
    "implement": {
      "subagent_type": "general",
      "isolation": "worktree",
      "prompt": "Implement.\n\n{{query}}\n\n{{last}}"
    }
  },
  "edges": [
    { "from": "__start__", "to": "explore" },
    { "from": "explore", "to": "implement" },
    { "from": "implement", "to": "__end__" }
  ]
}
```

Conditional: `{ "from": "explore", "to": "__end__", "if": { "field": "last", "includes": "REJECT" } }`.
If any `if` matches, those edges win; otherwise unconditional edges from that node.

`interruptBefore: ["implement"]` writes a checkpoint with `status: interrupted` and waits
for `/graph resume <thread>`.

## TUI

| Command | Effect |
|---|---|
| `/graphs` | Bundled + user + project graphs, each with a one-line ASCII DAG |
| `/graph show <name>` | Full DAG + description |
| `/graph <name> [query]` | Compile, run, checkpoint each super-step (progress lines as it goes) |
| `/graph` / `/graph list` | Saved threads under `.polycode/graph-runs/` |
| `/graph status <id>` | Dump checkpoint |
| `/graph resume <id>` | Continue interrupted/failed |

The parent also has a `graph` tool (stripped from children) so the model can invoke a named
pipeline instead of chaining `task` calls. Statusline shows `c:N` while children run;
`/dashboard` prints the last graph thread under the child list.

Each node is a depth-1 child: same tools, sandbox, permission engine as `/team`. Worktree
nodes still isolate writes. Prefer `/graph demo <query>` on a live stage — it is explore-only.

## Persistence

Checkpoints are **not** chat transcripts (those stay in `.polycode/sessions/`). A graph
thread stores `state`, `next`, `history`, and `status` so a crash or `/exit` can resume
the machine, not only the last assistant message.

Caps: `maxSteps` 1–64 (default 16), checkpoint file 256k, thread id `[A-Za-z0-9._-]`.
