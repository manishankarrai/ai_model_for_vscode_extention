import {
  Intent,
  InvestigationPlan,
  ToolName
} from "../models/types";

export class Planner {

  createPlan(
    intent: Intent,
    question: string
  ): InvestigationPlan {

    const normalizedQuestion =
      question.toLowerCase();

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
            "list_files"
          ],

          maxSteps: 15,

          maxFiles: 18,

          maxChars: 60_000,

          maxSearchResults: 15,

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
            "list_files"
          ],

          maxSteps: 15,

          maxFiles: 15,

          maxChars: 50_000,

          maxSearchResults: 10,

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

          maxSteps: 12,

          maxFiles: 20,

          maxChars: 60_000,

          maxSearchResults: 15,

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

          maxSteps: 10,

          maxFiles: 12,

          maxChars: 40_000,

          maxSearchResults: 10,

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

          maxSteps:
            this.isSimpleQuestion(
              normalizedQuestion
            )
              ? 5
              : 8,

          maxFiles:
            this.isSimpleQuestion(
              normalizedQuestion
            )
              ? 6
              : 10,

          maxChars:
            this.isSimpleQuestion(
              normalizedQuestion
            )
              ? 20_000
              : 30_000,

          maxSearchResults:
            this.isSimpleQuestion(
              normalizedQuestion
            )
              ? 5
              : 8,

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
}