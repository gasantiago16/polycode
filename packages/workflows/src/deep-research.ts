import type { WorkflowFile } from "./runner.js";

export function deepResearchWorkflow(): WorkflowFile {
  return {
    name: "deep-research",
    description: "3 researcher children, then synthesize a cited report",
    budget: 8,
    parallel: [
      {
        description: "angle-core",
        subagent_type: "researcher",
        prompt:
          "Research this angle and cite URLs. Fail closed if you cannot fetch a primary.\n\n$query",
      },
      {
        description: "angle-primaries",
        subagent_type: "researcher",
        prompt:
          "Research this angle and cite URLs. Fail closed if you cannot fetch a primary.\n\n$query primary sources official documentation",
      },
      {
        description: "angle-criticism",
        subagent_type: "researcher",
        prompt:
          "Research this angle and cite URLs. Fail closed if you cannot fetch a primary.\n\n$query criticism limitations caveats",
      },
    ],
    synthesize: {
      subagent_type: "general",
      prompt:
        `Write a cited research report to docs/research/$slug.md from these researcher notes. ` +
        `Include: question, findings, source URLs, holes, what we must not claim. Do not invent sources.\n\n$query\n\n$results`,
    },
  };
}
