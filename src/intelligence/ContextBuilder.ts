import * as vscode from "vscode";

import {
  AIContext,
  ProjectIndex,
  SearchResult
} from "../models/types";

import {
  ProjectModel
} from "../project/project-model";

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
    projectModel: ProjectModel | undefined,
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
        index,
        projectModel
      );

    return {
      files,
      indexSummary
    };
  }

  private createIndexSummary(
    index: ProjectIndex,
    projectModel?: ProjectModel
  ): string {

    const lines: string[] = [];

    lines.push(
      "Project Overview"
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

    if (projectModel) {
      lines.push("");

      lines.push(
        `Languages: ${projectModel.languages.join(", ") || "unknown"}`
      );

      lines.push(
        `Frameworks: ${projectModel.frameworks.join(", ") || "none detected"}`
      );

      lines.push(
        `Entry points: ${projectModel.entryPoints.length}`
      );

      lines.push(
        `Modules: ${projectModel.modules.length}`
      );

      lines.push(
        `Configuration files: ${projectModel.configFiles.length}`
      );

      lines.push(
        `Test files: ${projectModel.testFiles.length}`
      );

      if (projectModel.entryPoints.length > 0) {
        lines.push("");
        lines.push("Entry Points:");

        for (const entryPoint of projectModel.entryPoints) {
          lines.push(
            `- ${entryPoint.filePath} (${entryPoint.type})`
          );
        }
      }

      if (projectModel.modules.length > 0) {
        lines.push("");
        lines.push("Modules:");

        for (const module of projectModel.modules.slice(0, 30)) {
          lines.push(
            `- ${module.name}: ${module.path}`
          );
        }
      }

      if (projectModel.configFiles.length > 0) {
        lines.push("");
        lines.push("Configuration:");

        for (const file of projectModel.configFiles.slice(0, 30)) {
          lines.push(`- ${file}`);
        }
      }

      if (projectModel.testFiles.length > 0) {
        lines.push("");
        lines.push("Tests:");

        for (const file of projectModel.testFiles.slice(0, 30)) {
          lines.push(`- ${file}`);
        }
      }
    }

    return lines.join("\n");
  }
}