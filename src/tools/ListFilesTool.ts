import { flow } from "../utils/flowLog";

import {
  ProjectIndex
} from "../models/types";

export class ListFilesTool {

  execute(
    index: ProjectIndex
  ): string[] {
    flow("ListFilesTool.execute", 1, "enter");

    return Array.from(
      index.files.keys()
    );
  }
}