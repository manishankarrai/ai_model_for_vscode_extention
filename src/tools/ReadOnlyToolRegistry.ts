import {
  ProjectIndex,
  SearchResult,
  ToolName
} from "../models/types";

import { ReadFileTool } from "./ReadFileTool";
import { SearchTool } from "./SearchTool";
import { ListFilesTool } from "./ListFilesTool";

export class ReadOnlyToolRegistry {

  readonly readFile =
    new ReadFileTool();

  readonly search =
    new SearchTool();

  readonly listFiles =
    new ListFilesTool();

  getAvailableTools(): ToolName[] {

    return [
      "read_file",
      "search",
      "list_files"
    ];
  }

  async execute(
    tool: ToolName,
    args: {
      filePath?: string;
      query?: string;
      index?: ProjectIndex;
    }
  ): Promise<
    string[] |
    string |
    SearchResult[]
  > {

    switch (tool) {

      case "read_file":

        if (!args.filePath) {
          throw new Error(
            "read_file requires filePath"
          );
        }

        return this.readFile.execute(
          args.filePath
        );

      case "search":

        if (!args.query) {
          throw new Error(
            "search requires query"
          );
        }

        if (!args.index) {
          throw new Error(
            "search requires project index"
          );
        }

        return this.search.execute(
          args.query,
          args.index
        );

      case "list_files":

        if (!args.index) {
          throw new Error(
            "list_files requires project index"
          );
        }

        return this.listFiles.execute(
          args.index
        );

      default:

        throw new Error(
          `Tool "${tool}" is not allowed`
        );
    }
  }
}