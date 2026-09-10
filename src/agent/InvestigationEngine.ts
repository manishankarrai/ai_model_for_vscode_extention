import { flow } from "../utils/flowLog";

import {
  ProjectIndex,
  SearchResult
} from "../models/types";

import {
  ReadOnlyToolRegistry
} from "../tools/ReadOnlyToolRegistry";

import {
  DependencyResolver
} from "../intelligence/DependencyResolver";

import {
  SymbolRelationshipGraph
} from "../intelligence/SymbolRelationshipGraph";

import {
  Logger
} from "../utils/Logger";

import {
  InvestigationState
} from "../intelligence/InvestigationState";


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
}


export class InvestigationEngine {

  private readonly tools =
    new ReadOnlyToolRegistry();

  private readonly dependencyResolver =
    new DependencyResolver();

  private readonly symbolGraph:
    SymbolRelationshipGraph;


  constructor(
    private readonly logger: Logger
  ) {
    flow("InvestigationEngine.constructor", 1, "enter");

    this.symbolGraph =
      new SymbolRelationshipGraph(
        logger
      );
  }


  async investigate(
    question: string,
    index: ProjectIndex,
    rankedResults: SearchResult[],
    options: InvestigationOptions = {}
  ): Promise<InvestigationResult> {
    flow("InvestigationEngine.investigate", 1, "enter", { maxFiles: options.maxFiles });

    // --------------------------------------------------------
    // Investigation limits
    // --------------------------------------------------------

    const maxSteps =
      options.maxSteps ?? 1000;

    const maxFiles =
      options.maxFiles ?? 1000;

    const maxChars =
      options.maxChars ?? 5_000_000;


    const state =
      new InvestigationState();


    const steps:
      InvestigationStep[] = [];


    const evidence:
      InvestigationEvidence[] = [];


    // --------------------------------------------------------
    // Start investigation
    // --------------------------------------------------------

    this.logger.info(
      "Starting investigation",
      {
        question,

        maxSteps,

        maxFiles,

        maxChars,

        rankedResults:
          rankedResults.length
      }
    );


    // --------------------------------------------------------
    // Build symbol relationship graph
    // --------------------------------------------------------

    this.logger.info(
      "Building symbol relationship graph"
    );


    this.symbolGraph.build(
      index
    );


    // ========================================================
    // STEP 1
    // Ranked search results
    // ========================================================
    //
    // Search and ranking have already happened in Agent.
    //
    // Agent:
    //
    // SearchEngine
    //      ↓
    // RelevanceRanker
    //      ↓
    // rankedResults
    //      ↓
    // InvestigationEngine
    //
    // Therefore this engine does NOT search again.
    // ========================================================

    if (
      state.steps >= maxSteps
    ) {

      return this.createResult(
        question,
        steps,
        evidence,
        state,
        "max_steps"
      );
    }


    steps.push({

      step:
        steps.length + 1,

      action:
        "search",

      target:
        question,

      reason:
        "use ranked search results as investigation starting points",

      files:
        rankedResults.map(
          result =>
            result.path
        ),

      completed:
        true
    });


    state.incrementSteps();


    // --------------------------------------------------------
    // Queue ranked files
    // --------------------------------------------------------
    //
    // RelevanceRanker has already sorted these files.
    //
    // InvestigationState uses FIFO ordering.
    //
    // Therefore the highest-ranked files are investigated
    // first.
    // --------------------------------------------------------

    for (
      const result of rankedResults
    ) {

      state.queueFile(
        result.path
      );
    }


    this.logger.info(
      "Ranked investigation results queued",
      {
        results:
          rankedResults.length,

        queuedFiles:
          state.pendingCount
      }
    );


    // ========================================================
    // Investigation loop
    // ========================================================

    while (
      state.pendingCount > 0
    ) {

      // ------------------------------------------------------
      // Step budget
      // ------------------------------------------------------

      if (
        state.steps >= maxSteps
      ) {

        this.logger.info(
          "Investigation stopped: maximum steps reached",
          {
            steps:
              state.steps,

            maxSteps
          }
        );


        return this.createResult(
          question,
          steps,
          evidence,
          state,
          "max_steps"
        );
      }


      // ------------------------------------------------------
      // File budget
      // ------------------------------------------------------

      if (
        state.investigatedCount >= maxFiles
      ) {

        this.logger.info(
          "Investigation stopped: maximum files reached",
          {
            files:
              state.investigatedCount,

            maxFiles
          }
        );


        return this.createResult(
          question,
          steps,
          evidence,
          state,
          "max_files"
        );
      }


      // ------------------------------------------------------
      // Character budget
      // ------------------------------------------------------

      if (
        state.totalChars >= maxChars
      ) {

        this.logger.info(
          "Investigation stopped: maximum characters reached",
          {
            totalChars:
              state.totalChars,

            maxChars
          }
        );


        return this.createResult(
          question,
          steps,
          evidence,
          state,
          "max_chars"
        );
      }


      // ------------------------------------------------------
      // Get next file
      // ------------------------------------------------------

      const filePath =
        state.nextFile();


      if (!filePath) {
        break;
      }


      // ------------------------------------------------------
      // Prevent duplicate investigation
      // ------------------------------------------------------

      if (
        state.isInvestigated(
          filePath
        )
      ) {

        continue;
      }


      // ======================================================
      // READ FILE
      // ======================================================

      let content: string;


      try {

        content =
          await this.tools.readFile.execute(
            filePath
          );

      } catch (error) {

        this.logger.info(
          "Failed to read investigation file",
          {
            file:
              filePath,

            error:
              error instanceof Error
                ? error.message
                : String(error)
          }
        );


        continue;
      }


      // ------------------------------------------------------
      // Track investigated file
      // ------------------------------------------------------

      state.markInvestigated(
        filePath
      );


      state.addChars(
        content.length
      );


      // ------------------------------------------------------
      // Record read step
      // ------------------------------------------------------

      if (
        state.steps >= maxSteps
      ) {

        return this.createResult(
          question,
          steps,
          evidence,
          state,
          "max_steps"
        );
      }


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


      state.incrementSteps();


      this.logger.info(
        "Investigation file completed",
        {
          file:
            filePath,

          steps:
            state.steps,

          investigatedFiles:
            state.investigatedCount,

          pendingFiles:
            state.pendingCount,

          totalChars:
            state.totalChars
        }
      );


      // ======================================================
      // BUILD FILE RELATIONSHIPS
      // ======================================================

      this.symbolGraph
        .addFileReferenceRelationships(
          filePath,
          content,
          index
        );


      await this.symbolGraph
        .buildCallRelationships(
          filePath,
          index
        );


      // ------------------------------------------------------
      // Get indexed file
      // ------------------------------------------------------

      const indexedFile =
        index.files.get(
          filePath
        );


      if (!indexedFile) {

        this.logger.info(
          "Indexed file metadata not found",
          {
            file:
              filePath
          }
        );

        continue;
      }


      // ======================================================
      // CREATE EVIDENCE
      // ======================================================

      const relatedSymbols:
        string[] = [];


      for (
        const symbol of indexedFile.symbols
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
            rankedResults
          ),

        reason:
          this.getEvidenceReason(
            filePath,
            rankedResults
          ),

        content:
          this.limitContent(
            content,
            maxChars -
              (
                state.totalChars -
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


      this.logger.info(
        "Investigation evidence created",
        {
          file:
            filePath,

          score:
            this.getEvidenceScore(
              filePath,
              rankedResults
            ),

          symbols:
            indexedFile.symbols.length,

          dependencies:
            indexedFile.dependencies.length,

          relatedSymbols:
            uniqueRelatedSymbols.length
        }
      );


      // ======================================================
      // FOLLOW DEPENDENCIES
      // ======================================================

      for (
        const dependency
          of indexedFile.dependencies
      ) {

        if (
          state.steps >= maxSteps
        ) {
          break;
        }


        // ----------------------------------------------------
        // Dependency deduplication
        // ----------------------------------------------------

        if (
          state.hasFollowedDependency(
            dependency.source,
            dependency.target
          )
        ) {

          continue;
        }


        state.markDependencyFollowed(
          dependency.source,
          dependency.target
        );


        // ----------------------------------------------------
        // Resolve dependency
        // ----------------------------------------------------

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


        // ----------------------------------------------------
        // Queue dependency files
        // ----------------------------------------------------

        for (
          const resolvedFile
            of resolvedFiles
        ) {

          if (
            state.isInvestigated(
              resolvedFile
            )
          ) {

            continue;
          }


          state.queueFile(
            resolvedFile
          );
        }


        // ----------------------------------------------------
        // Record dependency step
        // ----------------------------------------------------

        if (
          state.steps >= maxSteps
        ) {
          break;
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


        state.incrementSteps();


        this.logger.info(
          "Following dependency",
          {
            source:
              dependency.source,

            target:
              dependency.target,

            resolvedFiles
          }
        );
      }


      // ======================================================
      // FOLLOW ACTUAL CALL RELATIONSHIPS
      // ======================================================
      //
      // IMPORTANT:
      //
      // The graph may contain different relationship types:
      //
      // - call
      // - same_file
      // - name_reference
      // - dependency
      //
      // Investigation must only follow actual CALL edges
      // when performing call-chain exploration.
      // ======================================================

      for (
        const symbol
          of indexedFile.symbols
      ) {

        if (
          state.steps >= maxSteps
        ) {
          break;
        }


        const relationships =
          this.symbolGraph
            .getRelatedSymbols(
              symbol
            );


        // ----------------------------------------------------
        // Only actual calls
        // ----------------------------------------------------

        const callRelationships =
          relationships.filter(
            relationship =>
              relationship.type === "call"
          );


        for (
          const relationship
            of callRelationships
        ) {

          if (
            state.steps >= maxSteps
          ) {
            break;
          }


          const targetFile =
            relationship.to.filePath;


          // --------------------------------------------------
          // Already investigated
          // --------------------------------------------------

          if (
            state.isInvestigated(
              targetFile
            )
          ) {

            continue;
          }


          // --------------------------------------------------
          // Already followed
          // --------------------------------------------------

          if (
            state.hasFollowedCall(
              relationship.from.filePath,
              relationship.from.name,
              relationship.to.filePath,
              relationship.to.name
            )
          ) {

            continue;
          }


          state.markCallFollowed(

            relationship.from.filePath,

            relationship.from.name,

            relationship.to.filePath,

            relationship.to.name
          );


          // --------------------------------------------------
          // Queue target file
          // --------------------------------------------------

          const queued =
            state.queueFile(
              targetFile
            );


          if (!queued) {

            continue;
          }


          // --------------------------------------------------
          // Record call step
          // --------------------------------------------------

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


          state.incrementSteps();


          this.logger.info(
            "Following call relationship",
            {
              from:
                relationship.from.name,

              fromFile:
                relationship.from.filePath,

              to:
                relationship.to.name,

              toFile:
                relationship.to.filePath
            }
          );
        }
      }
    }


    // ========================================================
    // INVESTIGATION COMPLETED
    // ========================================================

    this.logger.info(
      "Investigation completed",
      {
        question,

        steps:
          state.steps,

        investigatedFiles:
          state.investigatedCount,

        totalChars:
          state.totalChars,

        evidence:
          evidence.length
      }
    );


    return this.createResult(
      question,
      steps,
      evidence,
      state,
      "completed"
    );
  }


  // ========================================================
  // Evidence score
  // ========================================================

  private getEvidenceScore(
    filePath: string,
    rankedResults: SearchResult[]
  ): number {
    flow("InvestigationEngine.getEvidenceScore", 1, "enter", { filePath });

    const result =
      rankedResults.find(
        item =>
          item.path === filePath
      );


    return result?.score ?? 0;
  }


  // ========================================================
  // Evidence reason
  // ========================================================

  private getEvidenceReason(
    filePath: string,
    rankedResults: SearchResult[]
  ): string {
    flow("InvestigationEngine.getEvidenceReason", 1, "enter", { filePath });

    const result =
      rankedResults.find(
        item =>
          item.path === filePath
      );


    if (!result) {

      return (
        "file discovered through project relationships"
      );
    }


    return result.reason;
  }


  // ========================================================
  // Limit content
  // ========================================================

  private limitContent(
    content: string,
    remainingChars: number
  ): string {
    flow("InvestigationEngine.limitContent", 1, "enter");

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


  // ========================================================
  // Create result
  // ========================================================

  private createResult(
    question: string,

    steps: InvestigationStep[],

    evidence: InvestigationEvidence[],

    state: InvestigationState,

    stoppedReason:
      | "completed"
      | "max_steps"
      | "max_files"
      | "max_chars"
  ): InvestigationResult {
    flow("InvestigationEngine.createResult", 1, "enter", { stoppedReason, steps: steps.length });

    return {

      question,

      steps,

      evidence,

      filesInvestigated:
        state.getInvestigatedFiles(),

      completed:
        stoppedReason ===
        "completed",

      stoppedReason
    };
  }
}
