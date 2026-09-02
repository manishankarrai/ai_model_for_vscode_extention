import * as vscode from "vscode";

import {
  readTextFile
} from "../utils/FileUtils";

export class ReadFileTool {

  async execute(
    filePath: string
  ): Promise<string> {

    const workspace =
      vscode.workspace.workspaceFolders?.[0];

    if (!workspace) {
      throw new Error(
        "No workspace opened"
      );
    }

    const uri =
      vscode.Uri.joinPath(
        workspace.uri,
        filePath
      );

    return readTextFile(uri);
  }
}