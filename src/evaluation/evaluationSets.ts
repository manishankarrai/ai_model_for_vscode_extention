import { flow } from "../utils/flowLog";

export type EvaluationCategory =
  | "architecture"
  | "bug_analysis"
  | "implementation"
  | "selected_code";

export interface EvaluationCase {
  id: string;
  category: EvaluationCategory;
  question: string;
  expectedPaths: string[];
}

export function stage12EvaluationSet(): EvaluationCase[] {
  flow("stage12EvaluationSet", 1, "enter");
  return [
    {
      id: "arch-boundaries",
      category: "architecture",
      question: "How are the extension and backend separated?",
      expectedPaths: ["src/agent/Agent.ts", "services.go"]
    },
    {
      id: "bug-null-guard",
      category: "bug_analysis",
      question: "Why can rollback fail after an approved edit?",
      expectedPaths: ["src/safety/CodeChangeApplier.ts"]
    },
    {
      id: "impl-plan",
      category: "implementation",
      question: "How should Ask mode skip investigation?",
      expectedPaths: ["src/intelligence/contextSelection.ts"]
    },
    {
      id: "selected-code",
      category: "selected_code",
      question: "What does the highlighted helper return?",
      expectedPaths: ["src/ui/M3ViewProvider.ts"]
    }
  ];
}

export function fileSelectionScore(
  citedPaths: string[],
  expectedPaths: string[]
): number {
  if (expectedPaths.length === 0) {
    return 1;
  }

  const cited = new Set(citedPaths);
  const matched = expectedPaths.filter((path) => cited.has(path)).length;
  return matched / expectedPaths.length;
}
