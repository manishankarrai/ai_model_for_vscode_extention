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

interface ContextRegion {
  startLine: number;
  endLine: number;
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

        const content =
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

        const focusedContent =
          this.buildFocusedContent(
            content,
            result,
            index,
            remaining
          );

        if (!focusedContent) {
          continue;
        }

        files.push({
          path: result.path,
          content: focusedContent
        });

        totalChars +=
          focusedContent.length;

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
      indexSummary,
      evidence: rankedFiles.map(
        result => ({
          path: result.path,
          score: result.score,
          reason: result.reason,
          matchedSymbols:
            result.matchedSymbols ?? [],
          matchedTerms:
            result.matchedTerms ?? []
        })
      )
    };
  }

  // ----------------------------------------------------------
  // Focused context
  // ----------------------------------------------------------

  private buildFocusedContent(
    content: string,
    result: SearchResult,
    index: ProjectIndex,
    maxChars: number
  ): string {

    const lines =
      content.split(/\r?\n/);

    if (lines.length === 0) {
      return "";
    }

    // --------------------------------------------------------
    // Priority 1:
    // Focus around matched symbols.
    // --------------------------------------------------------

    const symbolRegions =
      this.findSymbolRegions(
        result,
        index,
        lines.length
      );

    if (symbolRegions.length > 0) {

      const focused =
        this.extractRegions(
          lines,
          symbolRegions
        );

      if (
        focused.length <=
        maxChars
      ) {
        return focused;
      }

      return this.limitFocusedContent(
        lines,
        symbolRegions,
        maxChars
      );
    }

    // --------------------------------------------------------
    // Priority 2:
    // No symbols found.
    //
    // Focus around matched term occurrences.
    // --------------------------------------------------------

    const termRegions =
      this.findTermRegions(
        result,
        lines.length,
        lines
      );

    if (termRegions.length > 0) {

      const focused =
        this.extractRegions(
          lines,
          termRegions
        );

      if (
        focused.length <=
        maxChars
      ) {
        return focused;
      }

      return this.limitFocusedContent(
        lines,
        termRegions,
        maxChars
      );
    }

    // --------------------------------------------------------
    // Priority 3:
    // No symbol or term location found.
    //
    // Keep beginning-of-file fallback.
    // --------------------------------------------------------

    return content.slice(
      0,
      maxChars
    );
  }

  // ----------------------------------------------------------
  // Find symbol locations
  // ----------------------------------------------------------

  private findSymbolRegions(
    result: SearchResult,
    index: ProjectIndex,
    totalLines: number
  ): ContextRegion[] {

    const matchedSymbols =
      new Set(
        result.matchedSymbols ?? []
      );

    if (
      matchedSymbols.size === 0
    ) {
      return [];
    }

    const regions: ContextRegion[] = [];

    for (
      const symbol of index.symbols
    ) {

      if (
        symbol.filePath !==
        result.path
      ) {
        continue;
      }

      if (
        !matchedSymbols.has(
          symbol.name
        )
      ) {
        continue;
      }

      const line =
        Math.max(
          0,
          symbol.line - 1
        );

      const startLine =
        Math.max(
          0,
          line - 15
        );

      const endLine =
        Math.min(
          totalLines - 1,
          line + 35
        );

      regions.push({
        startLine,
        endLine
      });
    }

    return this.mergeRegions(
      regions
    );
  }

  // ----------------------------------------------------------
  // Find matched term locations
  // ----------------------------------------------------------

  private findTermRegions(
    result: SearchResult,
    totalLines: number,
    lines: string[]
  ): ContextRegion[] {

    const matchedTerms =
      [
        ...new Set(
          (result.matchedTerms ?? [])
            .map(term =>
              term.toLowerCase().trim()
            )
            .filter(Boolean)
        )
      ];

    if (
      matchedTerms.length === 0
    ) {
      return [];
    }

    const regions: ContextRegion[] = [];

    for (
      const term of matchedTerms
    ) {

      let occurrences = 0;

      for (
        let lineIndex = 0;
        lineIndex < totalLines;
        lineIndex++
      ) {

        const line =
          lines[lineIndex];

        const lowerLine =
          line.toLowerCase();

        if (
          !lowerLine.includes(term)
        ) {
          continue;
        }

        // ----------------------------------------------------
        // Keep the number of regions reasonable.
        //
        // We don't want a common word to cause the entire
        // file to be selected.
        // ----------------------------------------------------

        if (occurrences >= 3) {
          break;
        }

        const startLine =
          Math.max(
            0,
            lineIndex - 8
          );

        const endLine =
          Math.min(
            totalLines - 1,
            lineIndex + 12
          );

        regions.push({
          startLine,
          endLine
        });

        occurrences++;
      }
    }

    return this.mergeRegions(
      regions
    );
  }

  // ----------------------------------------------------------
  // Merge overlapping regions
  // ----------------------------------------------------------

  private mergeRegions(
    regions: ContextRegion[]
  ): ContextRegion[] {

    if (regions.length <= 1) {
      return regions;
    }

    const sorted =
      [...regions].sort(
        (a, b) =>
          a.startLine -
          b.startLine
      );

    const merged: ContextRegion[] = [];

    for (
      const region of sorted
    ) {

      const previous =
        merged[
          merged.length - 1
        ];

      if (!previous) {

        merged.push({
          ...region
        });

        continue;
      }

      if (
        region.startLine <=
        previous.endLine + 1
      ) {

        previous.endLine =
          Math.max(
            previous.endLine,
            region.endLine
          );

      } else {

        merged.push({
          ...region
        });
      }
    }

    return merged;
  }

  // ----------------------------------------------------------
  // Extract regions
  // ----------------------------------------------------------

  private extractRegions(
    lines: string[],
    regions: ContextRegion[]
  ): string {

    const output: string[] = [];

    for (
      const region of regions
    ) {

      if (
        output.length > 0
      ) {

        output.push(
          "\n// ... omitted unrelated code ...\n"
        );
      }

      for (
        let line =
          region.startLine;
        line <= region.endLine;
        line++
      ) {

        output.push(
          lines[line]
        );
      }
    }

    return output.join("\n");
  }

  // ----------------------------------------------------------
  // Enforce character limit while preserving focused regions
  // ----------------------------------------------------------

  private limitFocusedContent(
    lines: string[],
    regions: ContextRegion[],
    maxChars: number
  ): string {

    const output: string[] = [];

    let totalChars = 0;

    for (
      const region of regions
    ) {

      if (
        totalChars >= maxChars
      ) {
        break;
      }

      if (
        output.length > 0
      ) {

        const separator =
          "\n// ... omitted unrelated code ...\n";

        if (
          totalChars +
          separator.length >
          maxChars
        ) {
          break;
        }

        output.push(
          separator
        );

        totalChars +=
          separator.length;
      }

      for (
        let line =
          region.startLine;
        line <= region.endLine;
        line++
      ) {

        const lineContent =
          lines[line];

        const addition =
          output.length === 0
            ? lineContent
            : `\n${lineContent}`;

        if (
          totalChars +
          addition.length >
          maxChars
        ) {

          const remaining =
            maxChars -
            totalChars;

          if (remaining > 0) {

            output.push(
              addition.slice(
                0,
                remaining
              )
            );
          }

          return output.join("");
        }

        output.push(
          addition
        );

        totalChars +=
          addition.length;
      }
    }

    return output.join("");
  }

  // ----------------------------------------------------------
  // Project summary
  // ----------------------------------------------------------

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

      if (
        projectModel.entryPoints.length > 0
      ) {

        lines.push("");
        lines.push(
          "Entry Points:"
        );

        for (
          const entryPoint of
          projectModel.entryPoints
        ) {

          lines.push(
            `- ${entryPoint.filePath} (${entryPoint.type})`
          );
        }
      }

      if (
        projectModel.modules.length > 0
      ) {

        lines.push("");
        lines.push(
          "Modules:"
        );

        for (
          const module of
          projectModel.modules.slice(0, 30)
        ) {

          lines.push(
            `- ${module.name}: ${module.path}`
          );
        }
      }

      if (
        projectModel.configFiles.length > 0
      ) {

        lines.push("");
        lines.push(
          "Configuration:"
        );

        for (
          const file of
          projectModel.configFiles.slice(0, 30)
        ) {

          lines.push(
            `- ${file}`
          );
        }
      }

      if (
        projectModel.testFiles.length > 0
      ) {

        lines.push("");
        lines.push(
          "Tests:"
        );

        for (
          const file of
          projectModel.testFiles.slice(0, 30)
        ) {

          lines.push(
            `- ${file}`
          );
        }
      }
    }

    return lines.join("\n");
  }
}
