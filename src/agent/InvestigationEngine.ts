import * as vscode from "vscode";

import {
  ProjectIndex,
  SearchResult,
  SymbolInfo
} from "../models/types";

import {
  ReadOnlyToolRegistry
} from "../tools/ReadOnlyToolRegistry";

import {
  DependencyResolver
} from "../intelligence/DependencyResolver";

import {
  SymbolRelationshipGraph,
  SymbolRelationship
} from "../intelligence/SymbolRelationshipGraph";

export interface InvestigationStep {
  step: number;

  action:
    | "search"
    | "read_file"
    | "follow_symbol"
    | "follow_dependency";

  target: string;

  reason: string;

  files: string[];

  completed: boolean;
}

export interface InvestigationEvidence {
  path: string;

  score: number;

  reason: string;

  content: string;

  symbols: string[];

  dependencies: string[];

  relatedSymbols?: string[];
}

export interface InvestigationResult {
  question: string;

  steps: InvestigationStep[];

  evidence: InvestigationEvidence[];

  filesInvestigated: string[];

  completed: boolean;

  stoppedReason:
    | "completed"
    | "max_steps"
    | "max_files"
    | "max_chars";
}

export interface InvestigationOptions {
  maxSteps?: number;

  maxFiles?: number;

  maxChars?: number;

  maxSearchResults?: number;
}

export class InvestigationEngine {

  private readonly tools =
    new ReadOnlyToolRegistry();

  private readonly dependencyResolver =
    new DependencyResolver();

  private readonly symbolGraph =
    new SymbolRelationshipGraph();

  async investigate(
    question: string,
    index: ProjectIndex,
    options: InvestigationOptions = {}
  ): Promise<InvestigationResult> {

    const maxSteps =
      options.maxSteps ?? 10;

    const maxFiles =
      options.maxFiles ?? 10;

    const maxChars =
      options.maxChars ?? 30000;

    const maxSearchResults =
      options.maxSearchResults ?? 10;

    /*
     * Build the initial symbol graph from the
     * already-existing ProjectIndex.
     *
     * No filesystem scan happens here.
     */
    this.symbolGraph.build(
      index
    );

    const steps:
      InvestigationStep[] = [];

    const evidence:
      InvestigationEvidence[] = [];

    const filesInvestigated =
      new Set<string>();

    const pendingFiles:
      string[] = [];

    const queuedFiles =
      new Set<string>();

    const followedDependencies =
      new Set<string>();

    const followedSymbols =
      new Set<string>();

    let totalChars = 0;

    /*
     * ------------------------------------------------
     * STEP 1: Initial search
     * ------------------------------------------------
     */

    if (
      steps.length >= maxSteps
    ) {
      return this.createResult(
        question,
        steps,
        evidence,
        filesInvestigated,
        "max_steps"
      );
    }

    const searchResults =
      await this.tools.search.execute(
        question,
        index,
        maxSearchResults
      );

    steps.push({
      step:
        steps.length + 1,

      action:
        "search",

      target:
        question,

      reason:
        "find files relevant to the user's question",

      files:
        searchResults.map(
          result => result.path
        ),

      completed:
        true
    });

    /*
     * Queue initial search results.
     */
    for (
      const result of searchResults
    ) {

      if (
        !queuedFiles.has(
          result.path
        )
      ) {

        pendingFiles.push(
          result.path
        );

        queuedFiles.add(
          result.path
        );
      }
    }

    /*
     * ------------------------------------------------
     * Investigation loop
     * ------------------------------------------------
     */

    while (
      pendingFiles.length > 0
    ) {

      if (
        steps.length >= maxSteps
      ) {

        return this.createResult(
          question,
          steps,
          evidence,
          filesInvestigated,
          "max_steps"
        );
      }

      if (
        filesInvestigated.size >=
        maxFiles
      ) {

        return this.createResult(
          question,
          steps,
          evidence,
          filesInvestigated,
          "max_files"
        );
      }

      if (
        totalChars >= maxChars
      ) {

        return this.createResult(
          question,
          steps,
          evidence,
          filesInvestigated,
          "max_chars"
        );
      }

      const filePath =
        pendingFiles.shift();

      if (!filePath) {
        break;
      }

      if (
        filesInvestigated.has(
          filePath
        )
      ) {
        continue;
      }

      /*
       * ------------------------------------------------
       * Read file
       * ------------------------------------------------
       */

      let content: string;

      try {

        content =
          await this.tools.readFile.execute(
            filePath
          );

      } catch {

        continue;
      }

      filesInvestigated.add(
        filePath
      );

      totalChars +=
        content.length;

      steps.push({
        step:
          steps.length + 1,

        action:
          "read_file",

        target:
          filePath,

        reason:
          "inspect relevant implementation",

        files: [
          filePath
        ],

        completed:
          true
      });

      /*
       * ------------------------------------------------
       * Build symbol reference relationships
       * ------------------------------------------------
       */

      this.symbolGraph
        .addFileReferenceRelationships(
          filePath,
          content,
          index
        );

      const indexedFile =
        index.files.get(
          filePath
        );

      if (!indexedFile) {
        continue;
      }

      /*
       * ------------------------------------------------
       * Create evidence
       * ------------------------------------------------
       */

      const relatedSymbols:
        string[] = [];

      for (
        const symbol
          of indexedFile.symbols
      ) {

        const relationships =
          this.symbolGraph
            .getRelatedSymbols(
              symbol
            );

        for (
          const relationship
            of relationships
        ) {

          relatedSymbols.push(
            `${relationship.to.name} (${relationship.type})`
          );
        }
      }

      const uniqueRelatedSymbols =
        [
          ...new Set(
            relatedSymbols
          )
        ];

      evidence.push({
        path:
          filePath,

        score:
          this.getEvidenceScore(
            filePath,
            searchResults
          ),

        reason:
          this.getEvidenceReason(
            filePath,
            searchResults
          ),

        content:
          this.limitContent(
            content,
            maxChars -
              (
                totalChars -
                content.length
              )
          ),

        symbols:
          indexedFile.symbols.map(
            symbol =>
              symbol.name
          ),

        dependencies:
          indexedFile.dependencies.map(
            dependency =>
              dependency.target
          ),

        relatedSymbols:
          uniqueRelatedSymbols
      });

      /*
       * ------------------------------------------------
       * Follow dependencies
       * ------------------------------------------------
       */

      for (
        const dependency
          of indexedFile.dependencies
      ) {

        if (
          steps.length >= maxSteps
        ) {
          break;
        }

        const dependencyKey =
          [
            dependency.source,
            dependency.target
          ].join("->");

        if (
          followedDependencies.has(
            dependencyKey
          )
        ) {
          continue;
        }

        followedDependencies.add(
          dependencyKey
        );

        const resolvedFiles =
          await this.dependencyResolver.resolve(
            dependency,
            index
          );

        if (
          resolvedFiles.length === 0
        ) {
          continue;
        }

        for (
          const resolvedFile
            of resolvedFiles
        ) {

          if (
            filesInvestigated.has(
              resolvedFile
            )
          ) {
            continue;
          }

          if (
            !queuedFiles.has(
              resolvedFile
            )
          ) {

            pendingFiles.push(
              resolvedFile
            );

            queuedFiles.add(
              resolvedFile
            );
          }
        }

        steps.push({
          step:
            steps.length + 1,

          action:
            "follow_dependency",

          target:
            dependency.target,

          reason:
            `follow project dependency from ${dependency.source}`,

          files:
            resolvedFiles,

          completed:
            true
        });
      }

      /*
       * ------------------------------------------------
       * Follow related symbols
       * ------------------------------------------------
       */

      for (
        const symbol
          of indexedFile.symbols
      ) {

        if (
          steps.length >= maxSteps
        ) {
          break;
        }

        const symbolKey =
          [
            symbol.filePath,
            symbol.name,
            symbol.line
          ].join(":");

        if (
          followedSymbols.has(
            symbolKey
          )
        ) {
          continue;
        }

        followedSymbols.add(
          symbolKey
        );

        const relationships =
          this.symbolGraph
            .getRelatedSymbols(
              symbol
            );

        for (
          const relationship
            of relationships
        ) {

          if (
            steps.length >= maxSteps
          ) {
            break;
          }

          const targetFile =
            relationship.to.filePath;

          if (
            filesInvestigated.has(
              targetFile
            )
          ) {
            continue;
          }

          if (
            !queuedFiles.has(
              targetFile
            )
          ) {

            pendingFiles.push(
              targetFile
            );

            queuedFiles.add(
              targetFile
            );
          }

          steps.push({
            step:
              steps.length + 1,

            action:
              "follow_symbol",

            target:
              relationship.to.name,

            reason:
              relationship.reason,

            files: [
              targetFile
            ],

            completed:
              true
          });
        }
      }
    }

    return this.createResult(
      question,
      steps,
      evidence,
      filesInvestigated,
      "completed"
    );
  }

  private getEvidenceScore(
    filePath: string,
    searchResults: SearchResult[]
  ): number {

    const result =
      searchResults.find(
        item =>
          item.path === filePath
      );

    return result?.score ?? 0;
  }

  private getEvidenceReason(
    filePath: string,
    searchResults: SearchResult[]
  ): string {

    const result =
      searchResults.find(
        item =>
          item.path === filePath
      );

    if (!result) {
      return "file discovered through project relationships";
    }

    return result.reason;
  }

  private limitContent(
    content: string,
    remainingChars: number
  ): string {

    if (
      remainingChars <= 0
    ) {
      return "";
    }

    return content.slice(
      0,
      Math.min(
        content.length,
        remainingChars
      )
    );
  }

  private createResult(
    question: string,
    steps: InvestigationStep[],
    evidence: InvestigationEvidence[],
    filesInvestigated: Set<string>,
    stoppedReason:
      | "completed"
      | "max_steps"
      | "max_files"
      | "max_chars"
  ): InvestigationResult {

    return {
      question,

      steps,

      evidence,

      filesInvestigated:
        [...filesInvestigated],

      completed:
        stoppedReason ===
        "completed",

      stoppedReason
    };
  }
}