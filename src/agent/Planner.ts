import { flow } from "../utils/flowLog.ts";

import type {
  Intent,
  InvestigationPlan,
  AgentToolName
} from "../models/types.ts";

export class Planner {

  createPlan(
    intent: Intent,
    question: string,
    selectedPathCount = 0
  ): InvestigationPlan {
    flow("Planner.createPlan", 1, "enter", { intent });

    const normalizedQuestion =
      question.toLowerCase();

    const limits = this.getLimits(
      intent,
      normalizedQuestion,
      selectedPathCount
    );

    /*
     * ------------------------------------------------------------
     * BUG ANALYSIS
     * ------------------------------------------------------------
     *
     * Bug investigation needs the deepest investigation because
     * the agent may need to follow:
     *
     * handler
     *   ↓
     * service
     *   ↓
     * middleware
     *   ↓
     * database
     *   ↓
     * dependency
     */

    switch (intent) {

      case "implementation":

        return {
          steps: [
            "Understand the requested behavior and acceptance criteria",
            "Locate the owning modules and entry points",
            "Inspect related symbols, dependencies, and existing patterns",
            "Trace the current execution flow",
            "Design the smallest compatible implementation",
            "Identify tests and validation commands",
            "Prepare an ordered implementation plan with risks"
          ],

          tools: [
            "search",
            "read_file",
            "list_files",
            "edit_file",
            "create_file",
            "run_command",
            "run_tests"
          ],

          maxSteps: limits.maxSteps,

          maxFiles: limits.maxFiles,

          maxChars: limits.maxChars,

          maxSearchResults: limits.maxSearchResults,

          depth: "deep"
        };

      case "bug_analysis":

        return {
          steps: [
            "Understand the user's reported problem",
            "Search the indexed project for relevant code",
            "Inspect the highest-ranked files",
            "Check related symbols and dependencies",
            "Trace the relevant execution flow",
            "Identify the most likely root cause",
            "Prepare evidence-based findings"
          ],

          tools: [
            "search",
            "read_file",
            "list_files",
            "get_diagnostics",
            "edit_file",
            "run_tests"
          ],

          maxSteps: limits.maxSteps,

          maxFiles: limits.maxFiles,

          maxChars: limits.maxChars,

          maxSearchResults: limits.maxSearchResults,

          depth: "deep"
        };

      /*
       * ----------------------------------------------------------
       * ARCHITECTURE
       * ----------------------------------------------------------
       */

      case "architecture":

        return {
          steps: [
            "Understand the project structure",
            "Inspect important entry points",
            "Inspect dependencies",
            "Inspect major symbols",
            "Trace relationships between modules",
            "Describe the architecture",
            "Identify architectural risks"
          ],

          tools: [
            "list_files",
            "read_file",
            "search"
          ],

          maxSteps: limits.maxSteps,

          maxFiles: limits.maxFiles,

          maxChars: limits.maxChars,

          maxSearchResults: limits.maxSearchResults,

          depth: "deep"
        };

      /*
       * ----------------------------------------------------------
       * ANALYSIS
       * ----------------------------------------------------------
       */

      case "analyze":

        return {
          steps: [
            "Understand the requested analysis",
            "Find relevant files",
            "Inspect relevant implementation",
            "Analyze correctness and risks",
            "Check related symbols and dependencies",
            "Prepare recommendations"
          ],

          tools: [
            "search",
            "read_file"
          ],

          maxSteps: limits.maxSteps,

          maxFiles: limits.maxFiles,

          maxChars: limits.maxChars,

          maxSearchResults: limits.maxSearchResults,

          depth: "medium"
        };

      /*
       * ----------------------------------------------------------
       * CHAT
       * ----------------------------------------------------------
       *
       * Normal questions should remain cheap.
       *
       * Example:
       *
       * "Where is my JWT code?"
       *
       * There is no reason to investigate 15 files.
       */

      default:

        return {
          steps: [
            "Understand the user's question",
            "Find relevant project context",
            "Inspect relevant implementation",
            "Answer using available context"
          ],

          tools: [
            "search",
            "read_file"
          ],

          maxSteps: limits.maxSteps,

          maxFiles: limits.maxFiles,

          maxChars: limits.maxChars,

          maxSearchResults: limits.maxSearchResults,

          depth:
            this.isSimpleQuestion(
              normalizedQuestion
            )
              ? "shallow"
              : "medium"
        };
    }
  }

  /*
   * --------------------------------------------------------------
   * Simple question detection
   * --------------------------------------------------------------
   *
   * These questions usually don't need deep investigation.
   */

  private isSimpleQuestion(
    question: string
  ): boolean {
    flow("Planner.isSimpleQuestion", 1, "enter");

    const simplePatterns = [
      "where is",
      "where are",
      "what is",
      "what are",
      "which file",
      "which files",
      "show me",
      "find"
    ];

    return simplePatterns.some(
      pattern =>
        question.includes(pattern)
    );
  }

  private getLimits(
    intent: Intent,
    question: string,
    selectedPathCount: number
  ): Pick<InvestigationPlan, "maxSteps" | "maxFiles" | "maxChars" | "maxSearchResults"> {
    if (intent === "chat" && this.isSimpleQuestion(question)) {
      return {
        maxSteps: 6,
        maxFiles: 4,
        maxChars: 80_000,
        maxSearchResults: 12
      };
    }

    if (selectedPathCount > 0) {
      return {
        maxSteps: intent === "bug_analysis" ? 12 : 8,
        maxFiles: intent === "architecture" ? 16 : Math.max(8, selectedPathCount * 3),
        maxChars: 600_000,
        maxSearchResults: 40
      };
    }

    switch (intent) {
      case "implementation":
        return { maxSteps: 16, maxFiles: 12, maxChars: 800_000, maxSearchResults: 50 };
      case "bug_analysis":
        return { maxSteps: 18, maxFiles: 14, maxChars: 900_000, maxSearchResults: 60 };
      case "architecture":
        return { maxSteps: 20, maxFiles: 24, maxChars: 1_200_000, maxSearchResults: 80 };
      case "analyze":
        return { maxSteps: 10, maxFiles: 10, maxChars: 500_000, maxSearchResults: 40 };
      default:
        return { maxSteps: 8, maxFiles: 6, maxChars: 200_000, maxSearchResults: 24 };
    }
  }
}