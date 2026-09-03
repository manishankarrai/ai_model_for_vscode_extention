import * as vscode from "vscode";

import {
  AIRequest,
  AIResponse,
} from "../models/types";

import { IntentDetector } from "./IntentDetector";
import { Planner } from "./Planner";
import { ToolSelector } from "./ToolSelector";
import { InvestigationEngine } from "./InvestigationEngine";

import { ProjectIndexer } from "../intelligence/ProjectIndexer";
import { SearchEngine } from "../intelligence/SearchEngine";
import { RelevanceRanker } from "../intelligence/RelevanceRanker";
import {
  ContextBuilder,
  InvestigationContextEvidence
} from "../intelligence/ContextBuilder";

import { BackendClient } from "../backend/BackendClient";

import { ConversationState } from "../state/ConversationState";
import { TaskState } from "../state/TaskState";

import { TokenEstimator } from "../utils/TokenEstimator";
import { Logger } from "../utils/Logger";

import { ReadOnlyGuard } from "../safety/ReadOnlyGuard";
import { ProjectUnderstanding } from "../project/project-understanding";


export class Agent {

  private readonly intentDetector =
    new IntentDetector();

  private readonly planner =
    new Planner();

  private readonly toolSelector =
    new ToolSelector();

  private readonly searchEngine =
    new SearchEngine();

  private readonly ranker =
    new RelevanceRanker();

  private readonly contextBuilder =
    new ContextBuilder();

  private readonly backend =
    new BackendClient();

  private readonly tokenEstimator =
    new TokenEstimator();

  // Stage 3
  private readonly investigationEngine:
    InvestigationEngine;


  constructor(
    private readonly indexer: ProjectIndexer,

    private readonly projectUnderstanding:
      ProjectUnderstanding,

    private readonly conversation:
      ConversationState,

    private readonly taskState:
      TaskState,

    private readonly logger: Logger
  ) {

    this.investigationEngine =
      new InvestigationEngine(
        logger
      );
  }


  async process(
    question: string,
    accessToken: string
  ): Promise<AIResponse> {

    // --------------------------------------------------------
    // Workspace validation
    // --------------------------------------------------------

    const workspace =
      vscode.workspace.workspaceFolders?.[0];

    if (!workspace) {
      throw new Error(
        "Please open a workspace first."
      );
    }

    if (!question.trim()) {
      throw new Error(
        "Question cannot be empty."
      );
    }


    // --------------------------------------------------------
    // Intent
    // --------------------------------------------------------

    const intent =
      this.intentDetector.detect(
        question
      );

    const requestId =
      this.createRequestId();


    this.taskState.start(
      requestId,
      question,
      intent
    );


    this.logger.info(
      "M3 task started",
      {
        requestId,
        intent
      }
    );


    this.conversation.addUserMessage(
      question
    );


    try {

      // ------------------------------------------------------
      // Ensure project index
      // ------------------------------------------------------

      let index =
        this.indexer.getIndex();


      if (!index) {

        this.taskState.setStatus(
          "investigating"
        );


        this.logger.info(
          "No project index found. Building index."
        );


        index =
          await this.indexer.build(
            workspace.uri
          );
      }


      // ------------------------------------------------------
      // Project Model
      // ------------------------------------------------------

      const projectModel =
        this.projectUnderstanding.getModel();


      // ------------------------------------------------------
      // Local Plan
      // ------------------------------------------------------

      this.taskState.setStatus(
        "planning"
      );


      const plan =
        this.planner.createPlan(
          intent,
          question
        );


      const selectedTools =
        this.toolSelector.select(
          intent
        );


      for (
        const tool of selectedTools
      ) {

        ReadOnlyGuard.assertAllowed(
          tool
        );
      }


      this.logger.info(
        "Local plan created",
        {
          steps: plan.steps,
          tools: plan.tools,
          maxSteps: plan.maxSteps,
          maxFiles: plan.maxFiles,
          maxChars: plan.maxChars
        }
      );


      // ======================================================
      // STAGE 3
      // SEARCH
      // ======================================================

      this.taskState.setStatus(
        "investigating"
      );


      this.logger.info(
        "Starting local search",
        {
          question
        }
      );


      const searchResults =
        await this.searchEngine.search(
          question,
          index,
          50
        );


      this.logger.info(
        "Local search completed",
        {
          results:
            searchResults.length
        }
      );


      // ======================================================
      // STAGE 3
      // RANK SEARCH RESULTS
      // ======================================================

      const ranked =
        this.ranker.rank(
          question,
          index,
          searchResults,
          projectModel
        );


      this.logger.info(
        "Local search results ranked",
        {
          results:
            ranked.length,

          topResults:
            ranked
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


      // ======================================================
      // STAGE 3.1
      // DEEP LOCAL INVESTIGATION
      // ======================================================

      this.logger.info(
        "Starting deep local investigation",
        {
          rankedResults:
            ranked.length,

          maxSteps:
            plan.maxSteps,

          maxFiles:
            plan.maxFiles,

          maxChars:
            plan.maxChars
        }
      );


      const investigation =
        await this.investigationEngine.investigate(
          question,
          index,
          ranked,
          {
            maxSteps:
              plan.maxSteps,

            maxFiles:
              plan.maxFiles,

            maxChars:
              plan.maxChars
          }
        );


      // ------------------------------------------------------
      // Investigation logging
      // ------------------------------------------------------

      this.logger.info(
        "Investigation completed",
        {
          question,

          steps:
            investigation.steps.length,

          files:
            investigation.filesInvestigated.length,

          evidence:
            investigation.evidence.length,

          stoppedReason:
            investigation.stoppedReason
        }
      );


      this.logger.info(
        "Investigation files discovered",
        {
          files:
            investigation.filesInvestigated
        }
      );


      this.logger.info(
        "Investigation evidence collected",
        {
          evidence:
            investigation.evidence.map(
              item => ({
                path:
                  item.path,

                score:
                  item.score,

                symbols:
                  item.symbols,

                dependencies:
                  item.dependencies,

                relatedSymbols:
                  item.relatedSymbols ?? []
              })
            )
        }
      );


      // ======================================================
      // CONTEXT
      // ======================================================

      const config =
        vscode.workspace
          .getConfiguration("m3");


      const maxFiles =
        config.get<number>(
          "maxFilesInContext",
          30
        );


      const maxChars =
        config.get<number>(
          "maxContextChars",
          300000
        );


      // ------------------------------------------------------
      // Convert investigation evidence
      // into ContextBuilder format
      // ------------------------------------------------------

      const investigationEvidence:
        InvestigationContextEvidence[] =
        investigation.evidence.map(
          evidence => ({
            path:
              evidence.path,

            score:
              evidence.score,

            reason:
              evidence.reason,

            content:
              evidence.content,

            symbols:
              evidence.symbols,

            dependencies:
              evidence.dependencies,

            relatedSymbols:
              evidence.relatedSymbols
          })
        );


      this.logger.info(
        "Merging investigation evidence into context",
        {
          evidenceFiles:
            investigationEvidence.length,

          files:
            investigationEvidence.map(
              evidence =>
                evidence.path
            )
        }
      );


      // ------------------------------------------------------
      // Build final context
      // ------------------------------------------------------

      const context =
        await this.contextBuilder.build(
          index,
          ranked,
          projectModel,
          {
            maxFiles,
            maxChars
          },
          investigationEvidence
        );


      this.logger.info(
        "Investigation evidence merged into context",
        {
          contextFiles:
            context.files.length,

          contextPaths:
            context.files.map(
              file =>
                file.path
            )
        }
      );


      // ------------------------------------------------------
      // Task files
      // ------------------------------------------------------

      this.taskState.setFiles(
        context.files.map(
          file =>
            file.path
        )
      );


      // ------------------------------------------------------
      // Token estimation
      // ------------------------------------------------------

      const estimatedTokens =
        this.tokenEstimator.estimateFiles(
          context.files
        );


      this.logger.info(
        "Context built",
        {
          files:
            context.files.length,

          characters:
            context.files.reduce(
              (total, file) =>
                total +
                file.content.length,
              0
            ),

          estimatedTokens
        }
      );


      // ======================================================
      // BACKEND AI
      // ======================================================

      this.taskState.setStatus(
        "sending"
      );


      const request: AIRequest = {

        action:
          intent,

        request_id:
          requestId,

        question,

        project: {

          id:
            this.createProjectId(
              workspace.uri
            ),

          name:
            workspace.name,

          indexVersion:
            index.version
        },

        context,

        plan:
          plan.steps
      };


      this.logger.info(
        "Sending request to AI backend",
        {
          requestId,

          contextFiles:
            context.files.length,

          estimatedTokens
        }
      );


      const response =
        await this.backend.sendAIRequest(
          request,
          accessToken
        );


      this.logger.info(
        "Answer received from API",
        response
      );


      // ------------------------------------------------------
      // Task completion
      // ------------------------------------------------------

      this.taskState.setAICalls(
        response.usage.ai_api_calls
      );


      this.conversation.addAssistantMessage(
        response.answer
      );


      this.taskState.complete();


      this.logger.info(
        "M3 task completed",
        {
          requestId,

          aiCalls:
            response.usage.ai_api_calls,

          inputTokens:
            response.usage.input_tokens,

          outputTokens:
            response.usage.output_tokens,

          totalTokens:
            response.usage.total_tokens,

          estimatedCost:
            response.usage.estimated_cost,

          latencyMs:
            Date.now() -
            this.taskState.get().startedAt
        }
      );


      return response;


    } catch (error) {

      this.taskState.fail();


      this.logger.error(
        "M3 task failed",
        error
      );


      throw error;
    }
  }


  // ========================================================
  // Conversation
  // ========================================================

  getConversation() {
    return this.conversation.getMessages();
  }


  // ========================================================
  // Task State
  // ========================================================

  getTaskState() {
    return this.taskState.get();
  }


  // ========================================================
  // Clear Conversation
  // ========================================================

  clearConversation(): void {
    this.conversation.clear();
  }


  // ========================================================
  // Request ID
  // ========================================================

  private createRequestId(): string {

    return [
      Date.now().toString(36),

      Math.random()
        .toString(36)
        .slice(2, 10)
    ].join("-");
  }


  // ========================================================
  // Project ID
  // ========================================================

  private createProjectId(
    uri: vscode.Uri
  ): string {

    // Do not send the absolute workspace path
    // to the backend as project identity.
    //
    // We intentionally create a stable local
    // project identifier from the workspace URI.

    let hash = 0;


    const value =
      uri.toString();


    for (
      let i = 0;
      i < value.length;
      i++
    ) {

      hash =
        (hash << 5) -
        hash +
        value.charCodeAt(i);


      hash |= 0;
    }


    return `project-${Math.abs(hash)}`;
  }
}
