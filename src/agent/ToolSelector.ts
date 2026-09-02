import {
  Intent,
  ToolName
} from "../models/types";

export class ToolSelector {

  select(
    intent: Intent
  ): ToolName[] {

    switch (intent) {

      case "bug_analysis":
        return [
          "search",
          "read_file"
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