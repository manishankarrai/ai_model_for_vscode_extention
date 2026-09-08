import { flow } from "../utils/flowLog";

import {
  Intent,
  AgentToolName
} from "../models/types";

export class ToolSelector {

  select(
    intent: Intent
  ): AgentToolName[] {
    flow("ToolSelector.select", 1, "enter", { intent });

    switch (intent) {

      case "implementation":
        return [
          "search",
          "read_file",
          "list_files",
          "edit_file",
          "create_file",
          "run_tests",
          "get_diagnostics"
        ];

      case "bug_analysis":
        return [
          "search",
          "read_file",
          "get_diagnostics",
          "edit_file",
          "run_tests"
        ];

      case "architecture":
        return [
          "list_files",
          "read_file",
          "search"
        ];

      case "analyze":
        return [
          "search",
          "read_file"
        ];

      case "chat":
      default:
        return [
          "search",
          "read_file"
        ];
    }
  }
}