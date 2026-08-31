import type { WorkflowFile } from "./runner.js";

/** Grok-Build-shaped fan-out: two explorers in parallel, then a worktree implementer, then review. */
export function teamWorkflow(): WorkflowFile {
  return {
    name: "team",
    description: "Parallel explore, then implement in a worktree, then review",
    budget: 8,
    parallel: [
      {
        description: "explore-code",
        subagent_type: "explore",
        prompt:
          "Read-only survey. Find the files, types, and call sites needed for:\n\n$query\n\nReturn: paths, current behavior, risks, and a tight implementation sketch. Do not edit.",
      },
      {
        description: "explore-verify",
        subagent_type: "explore",
        prompt:
          "Read-only. How should we verify this change?\n\n$query\n\nReturn: existing tests to run, gaps, and a verification checklist. Do not edit.",
      },
    ],
    steps: [
      {
        description: "implement",
        subagent_type: "general",
        isolation: "worktree",
        prompt:
          "Implement this task in the isolated worktree. Use the research notes. Run the relevant tests if they exist.\n\n$query\n\n$results",
      },
      {
        description: "review",
        subagent_type: "review",
        prompt:
          "Review the implementation described below. Write the review markdown to `.polycode/reviews/team-$slug.md`.\n\n$query\n\n$results",
      },
    ],
  };
}
