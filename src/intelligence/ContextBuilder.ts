import * as vscode from "vscode";

import {
  AIContext,
  ProjectIndex,
  SearchResult
} from "../models/types";

import {
  readTextFile
} from "../utils/FileUtils";

export interface ContextOptions {
  maxFiles: number;
  maxChars: number;
}

export class ContextBuilder {

  async build(
    index: ProjectIndex,
    rankedFiles: SearchResult[],
    options: ContextOptions
  ): Promise<AIContext> {

    const files = [];

    let totalChars = 0;

    for (
      const result of rankedFiles
    ) {

      if (
        files.length >=
        options.maxFiles
      ) {
        break;
      }

      const indexed =
        index.files.get(
          result.path
        );

      if (!indexed) {
        continue;
      }

      try {

        let content =
          await readTextFile(
            vscode.Uri.file(
              indexed.file.absolutePath
            )
          );

        const remaining =
          options.maxChars -
          totalChars;

        if (remaining <= 0) {
          break;
        }

        if (
          content.length >
          remaining
        ) {

          content =
            content.slice(
              0,
              remaining
            );
        }

        files.push({
          path: result.path,
          content
        });

        totalChars +=
          content.length;

      } catch {
        continue;
      }
    }

    const indexSummary =
      this.createIndexSummary(
        index
      );

    return {
      files,
      indexSummary
    };
  }

  private createIndexSummary(
    index: ProjectIndex
  ): string {

    const lines: string[] = [];

    lines.push(
      `Project root: ${index.rootPath}`
    );

    lines.push(
      `Indexed files: ${index.files.size}`
    );

    lines.push(
      `Symbols: ${index.symbols.length}`
    );

    lines.push(
      `Dependencies: ${index.dependencies.length}`
    );

    lines.push(
      `Index version: ${index.version}`
    );

    lines.push("");

    lines.push("Files:");

    for (
      const file of index.files.values()
    ) {

      lines.push(
        `- ${file.file.path} (${file.file.language})`
      );
    }

    lines.push("");

    lines.push("Important symbols:");

    for (
      const symbol of index.symbols.slice(
        0,
        100
      )
    ) {

      lines.push(
        `- ${symbol.name} [${symbol.kind}] ${symbol.filePath}:${symbol.line}`
      );
    }

    lines.push("");

    lines.push("Dependencies:");

    for (
      const dependency of index.dependencies.slice(
        0,
        100
      )
    ) {

      lines.push(
        `- ${dependency.source} -> ${dependency.target}`
      );
    }

    return lines.join("\n");
  }
}