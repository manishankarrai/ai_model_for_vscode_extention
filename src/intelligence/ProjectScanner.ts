import { flow } from "../utils/flowLog";

import * as path from "path";
import * as vscode from "vscode";

import {
  ProjectFile
} from "../models/types";

import {
  getLanguage,
  hashContent,
  isIgnoredPath,
  normalizePath,
  readTextFile
} from "../utils/FileUtils";

export class ProjectScanner {
  async scan(
    rootUri: vscode.Uri
  ): Promise<ProjectFile[]> {
    flow("ProjectScanner.scan", 1, "enter", { root: rootUri.fsPath });

    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(
        rootUri,
        "**/*"
      ),
      "**/{node_modules,.git,vendor,dist,build,out,.next,.angular,coverage}/**"
    );

    const result: ProjectFile[] = [];

    for (const uri of files) {

      if (isIgnoredPath(uri.fsPath)) {
        continue;
      }

      try {

        const stat =
          await vscode.workspace.fs.stat(uri);

        if (
          stat.type !== vscode.FileType.File
        ) {
          continue;
        }

        // Avoid huge/binary files.
        if (stat.size > 500_000) {
          continue;
        }

        const content =
          await readTextFile(uri);

        if (this.isProbablyBinary(content)) {
          continue;
        }

        const hash =
          await hashContent(content);

        result.push({
          path: normalizePath(
            path.relative(
              rootUri.fsPath,
              uri.fsPath
            )
          ),

          absolutePath: uri.fsPath,

          size: stat.size,

          language: getLanguage(
            uri.fsPath
          ),

          hash,

          modifiedAt: stat.mtime
        });

      } catch {
        // A file can disappear while scanning.
        continue;
      }
    }

    return result;
  }

  private isProbablyBinary(
    content: string
  ): boolean {
    flow("ProjectScanner.isProbablyBinary", 1, "enter");

    const sample =
      content.slice(0, 1000);

    return sample.includes("\0");
  }
}