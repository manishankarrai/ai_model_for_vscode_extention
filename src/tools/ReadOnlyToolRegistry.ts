import {
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
}