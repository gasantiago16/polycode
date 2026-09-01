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
Bundled: `explore`, `research-implement`.

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
| `/graphs` | Bundled + user + project graphs |
| `/graph <name> [query]` | Compile, run, checkpoint each super-step |
| `/graph` / `/graph list` | Saved threads under `.polycode/graph-runs/` |
| `/graph status <id>` | Dump checkpoint |
| `/graph resume <id>` | Continue interrupted/failed |

Each node is a depth-1 child: same tools, sandbox, permission engine as `/team`. Worktree
nodes still isolate writes.

## Persistence

Checkpoints are **not** chat transcripts (those stay in `.polycode/sessions/`). A graph
thread stores `state`, `next`, `history`, and `status` so a crash or `/exit` can resume
the machine, not only the last assistant message.

Caps: `maxSteps` 1–64 (default 16), checkpoint file 256k, thread id `[A-Za-z0-9._-]`.
