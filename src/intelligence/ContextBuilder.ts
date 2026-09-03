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


export interface InvestigationContextEvidence {
  path: string;

  score: number;

  reason: string;

  content?: string;

  symbols?: string[];

  dependencies?: string[];

  relatedSymbols?: string[];
}


interface ContextRegion {
  startLine: number;
  endLine: number;
}


export class ContextBuilder {

  // ========================================================
  // Build final AI context
  // ========================================================

  async build(
    index: ProjectIndex,
    rankedFiles: SearchResult[],
    projectModel: ProjectModel | undefined,
    options: ContextOptions,
    investigationEvidence:
      InvestigationContextEvidence[] = []
  ): Promise<AIContext> {

    const files: {
      path: string;
      content: string;
    }[] = [];


    let totalChars = 0;


    this.logContextStart(
      rankedFiles,
      investigationEvidence,
      options
    );


    // --------------------------------------------------------
    // Merge normal ranking + investigation evidence
    // --------------------------------------------------------

    const finalRankedFiles =
      this.mergeInvestigationEvidence(
        rankedFiles,
        investigationEvidence
      );


    this.logFinalRanking(
      finalRankedFiles
    );


    // ========================================================
    // Build context files
    // ========================================================

    for (
      const result of finalRankedFiles
    ) {

      // ------------------------------------------------------
      // maxFiles
      // ------------------------------------------------------

      if (
        files.length >=
        options.maxFiles
      ) {

        break;
      }


      // ------------------------------------------------------
      // Get indexed file
      // ------------------------------------------------------

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


        // ----------------------------------------------------
        // maxChars
        // ----------------------------------------------------

        const remaining =
          options.maxChars -
          totalChars;


        if (
          remaining <= 0
        ) {

          break;
        }


        // ----------------------------------------------------
        // Build focused context
        // ----------------------------------------------------

        const focusedContent =
          this.buildFocusedContent(
            content,
            result,
            index,
            remaining
          );


        if (
          !focusedContent
        ) {

          continue;
        }


        files.push({

          path:
            result.path,

          content:
            focusedContent
        });


        totalChars +=
          focusedContent.length;


        this.logFileAdded(
          result,
          focusedContent,
          totalChars,
          files.length
        );


      } catch (error) {

        this.logFileReadFailure(
          result.path,
          error
        );

        continue;
      }
    }


    // ========================================================
    // Project summary
    // ========================================================

    const indexSummary =
      this.createIndexSummary(
        index,
        projectModel,
        investigationEvidence
      );


    this.loggerInfo(
      "ContextBuilder completed",
      {
        files:
          files.length,

        totalChars,

        maxFiles:
          options.maxFiles,

        maxChars:
          options.maxChars,

        investigationEvidence:
          investigationEvidence.length
      }
    );


    return {

      files,

      indexSummary,

      evidence:
        finalRankedFiles.map(
          result => ({

            path:
              result.path,

            score:
              result.score,

            reason:
              result.reason,

            matchedSymbols:
              result.matchedSymbols ?? [],

            matchedTerms:
              result.matchedTerms ?? []
          })
        )
    };
  }


  // ========================================================
  // Merge investigation evidence
  // ========================================================

  private mergeInvestigationEvidence(
    rankedFiles: SearchResult[],
    investigationEvidence:
      InvestigationContextEvidence[]
  ): SearchResult[] {

    const resultMap =
      new Map<string, SearchResult>();


    // --------------------------------------------------------
    // 1. Add normal search/ranked results
    // --------------------------------------------------------

    for (
      const result of rankedFiles
    ) {

      resultMap.set(
        result.path,
        {
          ...result,

          matchedSymbols: [
            ...(result.matchedSymbols ?? [])
          ],

          matchedTerms: [
            ...(result.matchedTerms ?? [])
          ]
        }
      );
    }


    // --------------------------------------------------------
    // 2. Merge investigation evidence
    // --------------------------------------------------------

    for (
      const investigation
        of investigationEvidence
    ) {

      const existing =
        resultMap.get(
          investigation.path
        );


      // ======================================================
      // File already exists in search results
      // ======================================================

      if (existing) {

        const investigationBoost =
          this.calculateInvestigationBoost(
            investigation
          );


        existing.score +=
          investigationBoost;


        existing.reason =
          this.mergeReasons(
            existing.reason,
            investigation.reason
          );


        // ----------------------------------------------------
        // Merge symbols
        // ----------------------------------------------------

        existing.matchedSymbols = [
          ...(existing.matchedSymbols ?? []),

          ...(investigation.symbols ?? [])
        ];


        // ----------------------------------------------------
        // Merge related symbols
        // ----------------------------------------------------

        existing.matchedSymbols = [
          ...(existing.matchedSymbols ?? []),

          ...this.extractRelatedSymbolNames(
            investigation.relatedSymbols ?? []
          )
        ];


        this.removeDuplicates(
          existing
        );


        continue;
      }


      // ======================================================
      // File discovered only by investigation
      // ======================================================

      const investigationScore =
        this.calculateInvestigationScore(
          investigation
        );


      resultMap.set(
        investigation.path,
        {

          path:
            investigation.path,

          score:
            investigationScore,

          matches:
            0,

          reason:
            this.buildInvestigationReason(
              investigation
            ),

          matchedSymbols:
            [
              ...(investigation.symbols ?? []),

              ...this.extractRelatedSymbolNames(
                investigation.relatedSymbols ?? []
              )
            ],

          matchedTerms:
            []
        }
      );
    }


    // --------------------------------------------------------
    // 3. Final cleanup
    // --------------------------------------------------------

    const results =
      Array.from(
        resultMap.values()
      );


    for (
      const result of results
    ) {

      this.removeDuplicates(
        result
      );
    }


    // --------------------------------------------------------
    // 4. Sort by final relevance
    // --------------------------------------------------------

    results.sort(
      (a, b) => {

        if (
          b.score !== a.score
        ) {

          return b.score - a.score;
        }


        // If scores are equal, prefer files with
        // more matched symbols.

        const aSymbols =
          a.matchedSymbols?.length ?? 0;

        const bSymbols =
          b.matchedSymbols?.length ?? 0;


        if (
          bSymbols !== aSymbols
        ) {

          return bSymbols - aSymbols;
        }


        // Finally keep deterministic ordering.

        return a.path.localeCompare(
          b.path
        );
      }
    );


    return results;
  }


  // ========================================================
  // Investigation boost
  // ========================================================

  private calculateInvestigationBoost(
    evidence:
      InvestigationContextEvidence
  ): number {

    /*
     * Investigation evidence should matter more than
     * a simple boolean "+25".
     *
     * Base boost:
     *   20
     *
     * Evidence score:
     *   up to 30 additional points
     *
     * Symbol evidence:
     *   +5
     *
     * Dependency evidence:
     *   +5
     *
     * Related symbol evidence:
     *   +5
     */

    const baseBoost =
      20;


    const scoreBoost =
      Math.min(
        Math.max(
          evidence.score,
          0
        ),
        30
      );


    const symbolBoost =
      (
        evidence.symbols?.length ?? 0
      ) > 0
        ? 5
        : 0;


    const dependencyBoost =
      (
        evidence.dependencies?.length ?? 0
      ) > 0
        ? 5
        : 0;


    const relatedSymbolBoost =
      (
        evidence.relatedSymbols?.length ?? 0
      ) > 0
        ? 5
        : 0;


    return (
      baseBoost +
      scoreBoost +
      symbolBoost +
      dependencyBoost +
      relatedSymbolBoost
    );
  }


  // ========================================================
  // Investigation-only file score
  // ========================================================

  private calculateInvestigationScore(
    evidence:
      InvestigationContextEvidence
  ): number {

    /*
     * Investigation-only files did not appear in the
     * original search results.
     *
     * Give them a meaningful score so they can enter
     * the final context.
     */

    const baseScore =
      30;


    const evidenceScore =
      Math.min(
        Math.max(
          evidence.score,
          0
        ),
        30
      );


    const symbolScore =
      Math.min(
        (evidence.symbols?.length ?? 0) * 3,
        15
      );


    const dependencyScore =
      Math.min(
        (evidence.dependencies?.length ?? 0) * 2,
        10
      );


    const relatedSymbolScore =
      Math.min(
        (evidence.relatedSymbols?.length ?? 0) * 2,
        10
      );


    return (
      baseScore +
      evidenceScore +
      symbolScore +
      dependencyScore +
      relatedSymbolScore
    );
  }


  // ========================================================
  // Investigation reason
  // ========================================================

  private buildInvestigationReason(
    evidence:
      InvestigationContextEvidence
  ): string {

    const reasons: string[] = [];


    reasons.push(
      "discovered during investigation"
    );


    if (
      evidence.reason
    ) {

      reasons.push(
        evidence.reason
      );
    }


    if (
      (
        evidence.symbols?.length ?? 0
      ) > 0
    ) {

      reasons.push(
        `${evidence.symbols!.length} relevant symbols`
      );
    }


    if (
      (
        evidence.dependencies?.length ?? 0
      ) > 0
    ) {

      reasons.push(
        `${evidence.dependencies!.length} dependencies`
      );
    }


    if (
      (
        evidence.relatedSymbols?.length ?? 0
      ) > 0
    ) {

      reasons.push(
        `${evidence.relatedSymbols!.length} related symbols`
      );
    }


    return reasons.join(
      "; "
    );
  }


  // ========================================================
  // Merge reasons
  // ========================================================

  private mergeReasons(
    existingReason: string,
    investigationReason: string
  ): string {

    if (
      !investigationReason
    ) {

      return existingReason;
    }


    if (
      existingReason.includes(
        investigationReason
      )
    ) {

      return existingReason;
    }


    if (
      existingReason
    ) {

      return (
        `${existingReason}; investigation: ${investigationReason}`
      );
    }


    return (
      `investigation: ${investigationReason}`
    );
  }


  // ========================================================
  // Extract related symbol names
  // ========================================================

  private extractRelatedSymbolNames(
    relatedSymbols: string[]
  ): string[] {

    return relatedSymbols
      .map(
        symbol => {

          /*
           * Relationship metadata currently looks like:
           *
           * "authenticate (call)"
           *
           * or:
           *
           * "UserService (dependency)"
           *
           * Keep the symbol name and remove the relationship
           * suffix.
           */

          const match =
            symbol.match(
              /^(.+?)\s+\([^)]+\)$/
            );


          if (match) {

            return match[1].trim();
          }


          return symbol.trim();
        }
      )
      .filter(Boolean);
  }


  // ========================================================
  // Focused context
  // ========================================================

  private buildFocusedContent(
    content: string,
    result: SearchResult,
    index: ProjectIndex,
    maxChars: number
  ): string {

    const lines =
      content.split(/\r?\n/);


    if (
      lines.length === 0
    ) {

      return "";
    }


    // --------------------------------------------------------
    // Priority 1:
    // Matched symbols
    // --------------------------------------------------------

    const symbolRegions =
      this.findSymbolRegions(
        result,
        index,
        lines.length
      );


    if (
      symbolRegions.length > 0
    ) {

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
    // Matched terms
    // --------------------------------------------------------

    const termRegions =
      this.findTermRegions(
        result,
        lines.length,
        lines
      );


    if (
      termRegions.length > 0
    ) {

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
    // Beginning of file
    // --------------------------------------------------------

    return content.slice(
      0,
      maxChars
    );
  }


  // ========================================================
  // Find symbol locations
  // ========================================================

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


    const regions:
      ContextRegion[] = [];


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


  // ========================================================
  // Find matched term locations
  // ========================================================

  private findTermRegions(
    result: SearchResult,
    totalLines: number,
    lines: string[]
  ): ContextRegion[] {

    const matchedTerms =
      [
        ...new Set(
          (result.matchedTerms ?? [])
            .map(
              term =>
                term
                  .toLowerCase()
                  .trim()
            )
            .filter(Boolean)
        )
      ];


    if (
      matchedTerms.length === 0
    ) {

      return [];
    }


    const regions:
      ContextRegion[] = [];


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
          !lowerLine.includes(
            term
          )
        ) {

          continue;
        }


        if (
          occurrences >= 3
        ) {

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


  // ========================================================
  // Merge overlapping regions
  // ========================================================

  private mergeRegions(
    regions: ContextRegion[]
  ): ContextRegion[] {

    if (
      regions.length <= 1
    ) {

      return regions;
    }


    const sorted =
      [...regions].sort(
        (a, b) =>
          a.startLine -
          b.startLine
      );


    const merged:
      ContextRegion[] = [];


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


  // ========================================================
  // Extract regions
  // ========================================================

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

        line <=
        region.endLine;

        line++
      ) {

        output.push(
          lines[line]
        );
      }
    }


    return output.join(
      "\n"
    );
  }


  // ========================================================
  // Enforce character limit
  // ========================================================

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
        totalChars >=
        maxChars
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

        line <=
        region.endLine;

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


          if (
            remaining > 0
          ) {

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


  // ========================================================
  // Project summary
  // ========================================================

  private createIndexSummary(
    index: ProjectIndex,
    projectModel:
      ProjectModel | undefined,
    investigationEvidence:
      InvestigationContextEvidence[] = []
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


    // --------------------------------------------------------
    // Investigation summary
    // --------------------------------------------------------

    if (
      investigationEvidence.length > 0
    ) {

      lines.push("");

      lines.push(
        `Investigation evidence files: ${investigationEvidence.length}`
      );


      lines.push(
        "Files discovered during investigation:"
      );


      for (
        const evidence
          of investigationEvidence.slice(
            0,
            20
          )
      ) {

        lines.push(
          `- ${evidence.path}`
        );
      }
    }


    // --------------------------------------------------------
    // Project model
    // --------------------------------------------------------

    if (
      projectModel
    ) {

      lines.push("");


      lines.push(
        `Languages: ${
          projectModel.languages.join(", ") ||
          "unknown"
        }`
      );


      lines.push(
        `Frameworks: ${
          projectModel.frameworks.join(", ") ||
          "none detected"
        }`
      );


      lines.push(
        `Entry points: ${
          projectModel.entryPoints.length
        }`
      );


      lines.push(
        `Modules: ${
          projectModel.modules.length
        }`
      );


      lines.push(
        `Configuration files: ${
          projectModel.configFiles.length
        }`
      );


      lines.push(
        `Test files: ${
          projectModel.testFiles.length
        }`
      );


      // ------------------------------------------------------
      // Entry points
      // ------------------------------------------------------

      if (
        projectModel.entryPoints.length > 0
      ) {

        lines.push("");

        lines.push(
          "Entry Points:"
        );


        for (
          const entryPoint
            of projectModel.entryPoints
        ) {

          lines.push(
            `- ${entryPoint.filePath} (${entryPoint.type})`
          );
        }
      }


      // ------------------------------------------------------
      // Modules
      // ------------------------------------------------------

      if (
        projectModel.modules.length > 0
      ) {

        lines.push("");

        lines.push(
          "Modules:"
        );


        for (
          const module
            of projectModel.modules.slice(
              0,
              30
            )
        ) {

          lines.push(
            `- ${module.name}: ${module.path}`
          );
        }
      }


      // ------------------------------------------------------
      // Configuration
      // ------------------------------------------------------

      if (
        projectModel.configFiles.length > 0
      ) {

        lines.push("");

        lines.push(
          "Configuration:"
        );


        for (
          const file
            of projectModel.configFiles.slice(
              0,
              30
            )
        ) {

          lines.push(
            `- ${file}`
          );
        }
      }


      // ------------------------------------------------------
      // Tests
      // ------------------------------------------------------

      if (
        projectModel.testFiles.length > 0
      ) {

        lines.push("");

        lines.push(
          "Tests:"
        );


        for (
          const file
            of projectModel.testFiles.slice(
              0,
              30
            )
        ) {

          lines.push(
            `- ${file}`
          );
        }
      }
    }


    return lines.join(
      "\n"
    );
  }


  // ========================================================
  // Remove duplicate metadata
  // ========================================================

  private removeDuplicates(
    result: SearchResult
  ): void {

    result.matchedTerms =
      [
        ...new Set(
          result.matchedTerms ?? []
        )
      ];


    result.matchedSymbols =
      [
        ...new Set(
          result.matchedSymbols ?? []
        )
      ];
  }


  // ========================================================
  // Logging helpers
  // ========================================================

  private logContextStart(
    rankedFiles: SearchResult[],
    investigationEvidence:
      InvestigationContextEvidence[],
    options: ContextOptions
  ): void {

    this.loggerInfo(
      "ContextBuilder starting",
      {
        rankedFiles:
          rankedFiles.length,

        investigationEvidence:
          investigationEvidence.length,

        maxFiles:
          options.maxFiles,

        maxChars:
          options.maxChars
      }
    );
  }


  private logFinalRanking(
    results: SearchResult[]
  ): void {

    this.loggerInfo(
      "Final context ranking created",
      {
        total:
          results.length,

        topFiles:
          results
            .slice(0, 10)
            .map(
              result => ({
                path:
                  result.path,

                score:
                  result.score,

                reason:
                  result.reason
              })
            )
      }
    );
  }


  private logFileAdded(
    result: SearchResult,
    content: string,
    totalChars: number,
    fileCount: number
  ): void {

    this.loggerInfo(
      "Context file added",
      {
        path:
          result.path,

        score:
          result.score,

        characters:
          content.length,

        totalChars,

        fileCount
      }
    );
  }


  private logFileReadFailure(
    filePath: string,
    error: unknown
  ): void {

    this.loggerInfo(
      "Failed to read context file",
      {
        file:
          filePath,

        error:
          error instanceof Error
            ? error.message
            : String(error)
      }
    );
  }


  /*
   * ContextBuilder does not currently receive Logger
   * through its constructor.
   *
   * Keep logging optional so this class remains compatible
   * with the existing Agent construction:
   *
   *     new ContextBuilder()
   *
   * If Logger is injected later, this method can be replaced
   * with this.logger.info(...).
   */
  private loggerInfo(
    message: string,
    data?: unknown
  ): void {

    // Intentionally empty.
    //
    // Agent already logs the major ContextBuilder stages.
    //
    // Keeping this helper allows detailed logging to be added
    // later without changing the ContextBuilder API.
  }
}
