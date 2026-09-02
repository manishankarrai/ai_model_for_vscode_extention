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

    switch (intent) {

      case "bug_analysis":

        return {
          steps: [
            "Understand the user's reported problem",
            "Search the indexed project for relevant code",
            "Inspect the highest-ranked files",
            "Check related symbols and dependencies",
            "Identify the most likely root cause",
            "Prepare evidence-based findings"
          ],

          tools: [
            "search",
            "read_file",
            "list_files"
          ]
        };

      case "architecture":

        return {
          steps: [
            "Understand the project structure",
            "Inspect important entry points",
            "Inspect dependencies",
            "Inspect major symbols",
            "Describe the architecture",
            "Identify architectural risks"
          ],

          tools: [
            "list_files",
            "read_file",
            "search"
          ]
        };

      case "analyze":

        return {
          steps: [
            "Understand the requested analysis",
            "Find relevant files",
            "Inspect relevant implementation",
            "Analyze correctness and risks",
            "Prepare recommendations"
          ],

          tools: [
            "search",
            "read_file"
          ]
        };

      default:

        return {
          steps: [
            "Understand the user's question",
            "Find relevant project context",
            "Answer using available context"
          ],

          tools: [
            "search",
            "read_file"
          ]
        };
    }
  }
}