import * as vscode from "vscode";

import {
  AIRequest,
  AIResponse,
  Intent
} from "../models/types";

import { IntentDetector } from "./IntentDetector";
import { Planner } from "./Planner";
import { ToolSelector } from "./ToolSelector";

import { ProjectIndexer } from "../intelligence/ProjectIndexer";
import { SearchEngine } from "../intelligence/SearchEngine";
import { RelevanceRanker } from "../intelligence/RelevanceRanker";
import { ContextBuilder } from "../intelligence/ContextBuilder";

import { BackendClient } from "../backend/BackendClient";

import { ConversationState } from "../state/ConversationState";
import { TaskState } from "../state/TaskState";

import { TokenEstimator } from "../utils/TokenEstimator";
import { Logger } from "../utils/Logger";

import { ReadOnlyGuard } from "../safety/ReadOnlyGuard";

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

  constructor(
    private readonly indexer: ProjectIndexer,

    private readonly conversation:
      ConversationState,

    private readonly taskState:
      TaskState,

    private readonly logger: Logger
  ) {}

  async process(
    question: string,
    accessToken: string
  ): Promise<AIResponse> {

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
      // Ensure index
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
      // Local plan
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
          tools: plan.tools
        }
      );

      // ------------------------------------------------------
      // Search
      // ------------------------------------------------------

      this.taskState.setStatus(
        "investigating"
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
          results: searchResults.length
        }
      );

      // ------------------------------------------------------
      // Rank
      // ------------------------------------------------------

      const ranked =
        this.ranker.rank(
          question,
          index,
          searchResults
        );

      // ------------------------------------------------------
      // Context
      // ------------------------------------------------------

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

      const context =
        await this.contextBuilder.build(
          index,
          ranked,
          {
            maxFiles,
            maxChars
          }
        );

      this.taskState.setFiles(
        context.files.map(
          file => file.path
        )
      );

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

      // ------------------------------------------------------
      // Backend
      // ------------------------------------------------------

      this.taskState.setStatus(
        "sending"
      );

      const request: AIRequest = {
        action: intent,

        request_id: requestId,

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

        plan: plan.steps
      };

      const response =
        await this.backend.sendAIRequest(
          request,
          accessToken
        );
      this.logger.info("answer of api call .........................." , response);

      this.taskState.setAICalls(
        response.usage.ai_api_calls
      );

      this.conversation.addAssistantMessage(
        response.answer
      );
      //actions need here so we print all answers

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

  getConversation() {
    return this.conversation.getMessages();
  }

  getTaskState() {
    return this.taskState.get();
  }

  clearConversation(): void {
    this.conversation.clear();
  }

  private createRequestId(): string {

    return [
      Date.now().toString(36),

      Math.random()
        .toString(36)
        .slice(2, 10)
    ].join("-");
  }

  private createProjectId(
    uri: vscode.Uri
  ): string {

    // Do not send the absolute workspace path
    // to the backend as project identity.
    //
    // We intentionally create a stable local
    // project identifier from the workspace name
    // and a non-sensitive hash-like value.

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