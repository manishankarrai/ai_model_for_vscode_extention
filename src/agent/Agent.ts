
import * as vscode from "vscode";

import {
  AIRequest,
  AIResponse,
  AIContext,
  AgentProfile,
  AgentEvent,
  AgentTaskStatus,
  ContextPart,
  ContextFile,
  InteractionMode,
  InvestigationResult,
  ImplementationPlan,
} from "../models/types";

import { IntentDetector } from "./IntentDetector";
import { Planner } from "./Planner";
import { ToolSelector } from "./ToolSelector";
import { InvestigationEngine } from "./InvestigationEngine";
import { InvestigationState } from "../intelligence/InvestigationState";

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
import { ProjectMemory } from "../state/ProjectMemory";
import { resolveRequestContext } from "../intelligence/contextSelection";
import { getToolPolicy, isToolAllowed } from "../tools/toolPolicy";
import { WorkspaceToolRegistry } from "../tools/WorkspaceToolRegistry";
import type { AgentToolName, CodeChange } from "../models/types";
import { CodeChangeApplier } from "../safety/CodeChangeApplier";


import { flow } from "../utils/flowLog";

// ============================================================
// Stage 4
// Adaptive reasoning types
// ============================================================

type AdaptiveToolName = AgentToolName;

interface AdaptiveToolRequest {
  tool: AdaptiveToolName;
  path?: string;
  targetPath?: string;
  target_path?: string;
  query?: string;
  command?: string;
  content?: string;
  original?: string;
  updated?: string;
  taskName?: string;
  task_name?: string;
  changes?: CodeChange[];
  reason?: string;
}


interface AdaptiveDecision {

  action:
    "FINAL_ANSWER"
    | "CONTINUE_INVESTIGATION";

  answer?:
    string;

  confidence:
    number;

  reason?:
    string;

  tool?:
    AdaptiveToolRequest;
}


/**
 * AIResponse from the backend with the Stage 4
 * adaptive decision.
 *
 * This intersection keeps Agent compatible if the
 * current AIResponse TypeScript model has not yet
 * been updated with decision.
 */
type AdaptiveAIResponse =
  AIResponse & {
    decision?: AdaptiveDecision;
    implementation_plan?: ImplementationPlan;
  };


/**
 * AIRequest used internally by the adaptive loop.
 *
 * `step` is added here without requiring the
 * base AIRequest interface to already contain it.
 */
type AdaptiveAIRequest =
  AIRequest & {
    step?: number;
  };


// ============================================================
// Adaptive tool execution limits
// ============================================================
//
// IMPORTANT:
//
// These are NOT investigation limits.
//
// Investigation limits belong to InvestigationState.
//
// These values only control how much work one individual
// adaptive tool execution may perform.
//
// ============================================================

const ADAPTIVE_MAX_SEARCH_RESULTS = 10;

const ADAPTIVE_MAX_LIST_FILES = 10;

const ADAPTIVE_MAX_FILE_CHARS = 20_000;


// ============================================================
// Agent
// ============================================================

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

  private lastRequest?: AdaptiveAIRequest;


  private readonly tokenEstimator =
    new TokenEstimator();


  // Stage 3
  private readonly investigationEngine:
    InvestigationEngine;

  private readonly workspaceTools: WorkspaceToolRegistry;


  constructor(
    private readonly indexer:
      ProjectIndexer,

    private readonly projectUnderstanding:
      ProjectUnderstanding,

    private readonly conversation:
      ConversationState,

    private readonly taskState:
      TaskState,

    private readonly projectMemory:
      ProjectMemory,

    private readonly logger:
      Logger,

    changeApplier = new CodeChangeApplier()
  ) {
    flow("Agent.constructor", 1, "enter");

    this.workspaceTools =
      new WorkspaceToolRegistry(changeApplier);

    this.investigationEngine =
      new InvestigationEngine(
        logger
      );
  }


  // ==========================================================
  // MAIN PROCESS
  // ==========================================================
  // responsible for handing message request and deliver to ai 
  async process(
    question: string,
    accessToken: string,
    selectedContext: ContextPart[] = [],
    mode: InteractionMode = "agent",
    agentProfile: AgentProfile = mode === "ask" ? "ask" : "coordinator",
    agentCount = 1,
    signal?: AbortSignal,
    onEvent?: (event: AgentEvent) => void
  ): Promise<AIResponse> {
    flow("Agent.process", 1, "enter", { mode, agentProfile, agentCount });

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
    flow("Agent.process", 2, "intent and request", { requestId, intent });

    if (onEvent && mode === "agent") {
      void this.backend.streamAgentEvents(
        requestId,
        accessToken,
        onEvent,
        signal
      ).catch(async (error: unknown) => {
        this.logger.warn(".............Agent event stream unavailable; loading task status", error);
        try {
          const task = await this.backend.getAgentTask(requestId, accessToken);
          for (const event of (task as AgentTaskStatus).events ?? []) {
            onEvent(event);
          }
        } catch (statusError) {
          this.logger.warn("Unable to reload agent task status", statusError);
        }
      });
    }


    this.taskState.start(
      requestId,
      question,
      intent
    );


    this.logger.info(
      "MM3 task started",
      {
        requestId,
        intent
      }
    );


    this.conversation.addUserMessage(
      question
    );


    try {

      // ======================================================
      // Ensure project index
      // ======================================================

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
      flow("Agent.process", 3, "index ready", { files: index.files.size });


      // ======================================================
      // Project model
      // ======================================================

      const projectModel =
        this.projectUnderstanding.getModel();


      // ======================================================
      // Local plan
      // ======================================================

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
          tool,
          mode
        );
      }


      flow("Agent.process", 4, "plan created", { intent, tools: selectedTools });

      this.logger.info(
        "Local plan created",
        {
          steps:
            plan.steps,

          tools:
            plan.tools,

          plannerMaxSteps:
            plan.maxSteps,

          plannerMaxFiles:
            plan.maxFiles,

          plannerMaxChars:
            plan.maxChars
        }
      );


      // ======================================================
      // STAGE 3
      // LOCAL SEARCH
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


      const searchResults = mode === "ask"
        ? []
        : await this.searchEngine.search(
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
      // RANK RESULTS
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

          plannerMaxSteps:
            plan.maxSteps,

          plannerMaxFiles:
            plan.maxFiles,

          plannerMaxChars:
            plan.maxChars
        }
      );


      let investigation: InvestigationResult;
      flow("Agent.process", 5, "investigation start", { mode });

      if (mode === "ask") {
        investigation = {
          question,
          steps: [],
          evidence: [],
          filesInvestigated: [],
          completed: true,
          stoppedReason: "completed"
        };
      } else {
        investigation =
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
      }

      this.projectMemory.addInvestigationArtifacts({
        findings:
          investigation.evidence
            .slice(0, 8)
            .map(
              evidence =>
                `${evidence.path}: ${evidence.reason}`
            ),
        dependencies:
          investigation.evidence
            .flatMap(
              evidence =>
                evidence.dependencies
            )
            .slice(0, 25),
        conventions:
          projectModel?.frameworks.map(
            framework =>
              `Framework: ${framework}`
          ) ?? [],
        architectureNotes:
          projectModel?.entryPoints.map(
            entry =>
              `Entry point: ${entry.filePath}`
          ) ?? []
      });

      void this.projectMemory.save();

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
      // CONTEXT CONFIGURATION
      // ======================================================

      const config =
        vscode.workspace
          .getConfiguration("mm3");


      const maxFiles =
        config.get<number>(
          "maxFilesInContext",
          1000
        );


      const maxChars =
        config.get<number>(
          "maxContextChars",
          5_000_000
        );


      // ------------------------------------------------------
      // Convert investigation evidence
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
      // Build context
      // ------------------------------------------------------

      let context: AIContext;

      if (mode === "ask") {
        context = resolveRequestContext({
          mode,
          selected: selectedContext,
          investigated: [],
          evidence: [],
          indexSummary: "",
          maxFiles
        });
      } else {
        const investigated =
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

        const selectedFiles =
          await this.readSelectedWorkspaceFiles(selectedContext);

        context = resolveRequestContext({
          mode,
          selected: selectedContext,
          investigated: [...selectedFiles, ...investigated.files],
          evidence: investigated.evidence,
          indexSummary: investigated.indexSummary,
          maxFiles
        });
      }


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
              (
                total,
                file
              ) =>
                total +
                file.content.length,
              0
            ),

          estimatedTokens
        }
      );


      // ======================================================
      // INITIAL AI REQUEST
      // ======================================================

      const request:
        AdaptiveAIRequest = {

        action:
          intent,

        request_id:
          requestId,

        question,

        mode,

        tool_policy: getToolPolicy(mode),

        agent: {
          profile: agentProfile,
          count: Math.max(1, Math.min(agentCount, mode === "ask" ? 1 : 5))
        },

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

        memory:
          this.projectMemory.getContextForAI(),

        plan:
          plan.steps
      };

      this.lastRequest = request;


      this.logger.info(
        "Initial AI request prepared",
        {
          requestId,

          contextFiles:
            context.files.length,

          estimatedTokens
        }
      );


      // ======================================================
      // STAGE 4
      // ADAPTIVE INVESTIGATION
      // ======================================================

      const response =
        await this.runAdaptiveInvestigation(
          request,
          accessToken,
          workspace.uri,
          index,
          projectModel,
          ranked,
          plan,
          context,
          signal,
          onEvent
        );


      // ------------------------------------------------------
      // Task completion
      // ------------------------------------------------------

      this.taskState.setAICalls(
        response.usage.ai_api_calls
      );


      if (
        response.answer &&
        response.answer.trim()
      ) {

        this.conversation.addAssistantMessage(
          response.answer
        );
      }


      this.taskState.complete();


      this.logger.info(
        "MM3 task completed",
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


      flow("Agent.process", 6, "complete", { requestId: response.request_id });
      return response;


    } catch (error) {
      flow("Agent.process", 7, "failed");

      this.taskState.fail();


      this.logger.error(
        "MM3 task failed",
        error
      );


      throw error;
    }
  }

  async retrySpecialist(
    profile: AgentProfile,
    accessToken: string,
    signal?: AbortSignal
  ): Promise<string> {
    flow("Agent.retrySpecialist", 1, "enter", { profile });
    if (!this.lastRequest || this.lastRequest.mode !== "agent") {
      throw new Error("No Agent request is available for specialist retry.");
    }

    const request = {
      ...this.lastRequest,
      agent: {
        profile,
        count: 1
      }
    };
    const result = await this.backend.retryAgent(
      request,
      request.request_id,
      profile,
      accessToken,
      signal
    ) as { answer: string };
    return result.answer;
  }

  private async readSelectedWorkspaceFiles(
    selected: ContextPart[]
  ): Promise<ContextFile[]> {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace || selected.length === 0) {
      return [];
    }

    const files: ContextFile[] = [];
    const seen = new Set<string>();

    for (const part of selected) {
      const relativePath = part.path.replace(/\\/g, "/");
      if (!relativePath || seen.has(relativePath)) {
        continue;
      }
      seen.add(relativePath);
      try {
        const uri = vscode.Uri.joinPath(
          workspace.uri,
          ...relativePath.split("/")
        );
        const document = await vscode.workspace.openTextDocument(uri);
        files.push({
          path: relativePath,
          content: document.getText()
        });
      } catch {
        if (part.content) {
          files.push({
            path: relativePath,
            content: part.content
          });
        }
      }
    }

    return files;
  }


  // ==========================================================
  // STAGE 4
  // ADAPTIVE INVESTIGATION LOOP
  // ==========================================================

  private async runAdaptiveInvestigation(
    initialRequest:
      AdaptiveAIRequest,

    accessToken:
      string,

    workspaceUri:
      vscode.Uri,

    index:
      any,

    projectModel:
      any,

    ranked:
      any[],

    plan:
      any,

    initialContext:
      any,

    signal?: AbortSignal,

    onEvent?: (event: AgentEvent) => void
  ): Promise<AIResponse> {
    flow("Agent.runAdaptiveInvestigation", 1, "enter");

    // --------------------------------------------------------
    // Central investigation state.
    //
    // This object owns:
    //
    // - max steps
    // - max files
    // - max evidence
    // - max AI calls
    // - max tool calls
    // - loop detection
    // - stop reason
    // --------------------------------------------------------

    const state =
      new InvestigationState();


    this.logger.info(
      "Adaptive investigation state created",
      {
        maxSteps:
          state.maxSteps,

        maxFiles:
          state.maxFiles,

        maxChars:
          state.maxChars,

        maxAICalls:
          state.maxAICalls,

        maxToolCalls:
          state.maxToolCalls
      }
    );


    // --------------------------------------------------------
    // Keep current request/context local to the loop.
    // --------------------------------------------------------

    let request:
      AdaptiveAIRequest =
      initialRequest;


    let context =
      initialContext;


    // --------------------------------------------------------
    // Aggregate AI usage across all adaptive calls.
    //
    // Each backend call returns usage for that call.
    // We need the final response to represent the complete
    // adaptive investigation.
    // --------------------------------------------------------

    const totalUsage = {

      input_tokens:
        0,

      output_tokens:
        0,

      total_tokens:
        0,

      ai_api_calls:
        0,

      estimated_cost:
        0,

      charged_credits:
        0,

      wallet_balance:
        0
    };


    // --------------------------------------------------------
    // Adaptive reasoning loop
    // --------------------------------------------------------

    for (;;) {
      flow("Agent.runAdaptiveInvestigation", 2, "loop tick");

      // ======================================================
      // START NEW ADAPTIVE STEP
      // ======================================================

      if (
        !state.startStep()
      ) {

        this.logger.info(
          "Adaptive investigation stopped before next step",
          {
            stopReason:
              state.stopReason,

            snapshot:
              state.getSnapshot()
          }
        );


        throw new Error(
          `Adaptive investigation stopped: ${state.stopReason}`
        );
      }


      const currentStep =
        state.steps;


      this.logger.info(
        "Adaptive reasoning step started",
        {
          step:
            currentStep,

          snapshot:
            state.getSnapshot()
        }
      );


      // ======================================================
      // AI CALL LIMIT
      // ======================================================

      if (
        !state.incrementAICalls()
      ) {

        this.logger.info(
          "Adaptive investigation stopped before AI call",
          {
            step:
              currentStep,

            stopReason:
              state.stopReason
          }
        );


        throw new Error(
          `Adaptive investigation stopped: ${state.stopReason}`
        );
      }


      // ======================================================
      // PREPARE REQUEST
      // ======================================================

      request = {

        ...request,

        context,

        step:
          currentStep
      };


      this.taskState.setStatus(
        "sending"
      );


      this.logger.info(
        "Sending adaptive reasoning request",
        {
          requestId:
            request.request_id,

          step:
            currentStep,

          aiCalls:
            state.aiCalls,

          maxAICalls:
            state.maxAICalls,

          contextFiles:
            context.files.length,

          contextChars:
            context.files.reduce(
              (
                total: number,
                file: any
              ) =>
                total +
                file.content.length,
              0
            )
        }
      );


      // ======================================================
      // BACKEND / GEMINI
      // ======================================================

      const rawResponse =
        await this.backend.sendAIRequest(
          request,
          accessToken,
          signal
        );


      const response =
        rawResponse as AdaptiveAIResponse;


      // ======================================================
      // AGGREGATE USAGE
      // ======================================================

      totalUsage.input_tokens +=
        response.usage.input_tokens;


      totalUsage.output_tokens +=
        response.usage.output_tokens;


      totalUsage.total_tokens +=
        response.usage.total_tokens;


      totalUsage.ai_api_calls +=
        response.usage.ai_api_calls;


      totalUsage.estimated_cost +=
        response.usage.estimated_cost;

      totalUsage.charged_credits +=
        response.usage.charged_credits ??
        response.usage.estimated_cost ??
        0;

      if (typeof response.usage.wallet_balance === "number") {
        totalUsage.wallet_balance =
          response.usage.wallet_balance;
      }


      // ======================================================
      // RESPONSE LOGGING
      // ======================================================

      this.logger.info(
        "Adaptive reasoning response received",
        {
          requestId:
            request.request_id,

          step:
            currentStep,

          action:
            response.decision?.action,

          confidence:
            response.decision?.confidence,

          reason:
            response.decision?.reason,

          tool:
            response.decision?.tool?.tool,

          aiCalls:
            state.aiCalls,

          totalTokens:
            response.usage.total_tokens
        }
      );


      // ======================================================
      // BACKWARD COMPATIBILITY
      // ======================================================
      //
      // If backend returns an old-style response without
      // a decision, treat it as FINAL_ANSWER.
      //
      // ======================================================

      if (!response.decision) {

        this.logger.info(
          "No adaptive decision returned. Treating response as final answer",
          {
            requestId:
              request.request_id,

            step:
              currentStep
          }
        );


        return {
          ...response,

          usage:
            totalUsage
        };
      }


      // ======================================================
      // FINAL ANSWER
      // ======================================================

      if (
        response.decision.action ===
        "FINAL_ANSWER"
      ) {

        const answer =
          response.answer?.trim()
          ||
          response.decision.answer?.trim()
          ||
          "";


        if (!answer) {

          state.stop(
            "insufficient_evidence"
          );


          this.logger.info(
            "Gemini returned FINAL_ANSWER without answer",
            {
              requestId:
                request.request_id,

              step:
                currentStep
            }
          );


          throw new Error(
            "Gemini returned FINAL_ANSWER without an answer."
          );
        }


        state.stop(
          "completed"
        );


        this.logger.info(
          "Adaptive reasoning finished",
          {
            requestId:
              request.request_id,

            step:
              currentStep,

            confidence:
              response.decision.confidence,

            reason:
              response.decision.reason,

            snapshot:
              state.getSnapshot()
          }
        );


        return {
          ...response,

          answer,

          usage:
            totalUsage,

          decision:
            response.decision
        };
      }


      // ======================================================
      // CONTINUE INVESTIGATION
      // ======================================================

      if (
        response.decision.action !==
        "CONTINUE_INVESTIGATION"
      ) {

        state.stop(
          "error"
        );


        throw new Error(
          `Unknown adaptive decision: ${response.decision.action}`
        );
      }


      // ======================================================
      // TOOL REQUEST
      // ======================================================

      const tool =
        response.decision.tool;


      if (!tool) {

        state.stop(
          "insufficient_evidence"
        );


        throw new Error(
          "Gemini requested CONTINUE_INVESTIGATION without a tool."
        );
      }


      // ======================================================
      // VALIDATE TOOL
      // ======================================================

      this.validateAdaptiveTool(
        tool
      );


      // ======================================================
      // TOOL REQUEST TRACKING (repeats are allowed)
      // ======================================================

      const toolKey =
        this.createToolRequestKey(
          tool
        );

      state.recordAIRequest(
        toolKey
      );


      // ======================================================
      // TOOL CALL LIMIT
      // ======================================================

      if (
        !state.incrementToolCalls()
      ) {

        this.logger.info(
          "Adaptive investigation stopped before tool execution",
          {
            requestId:
              request.request_id,

            step:
              currentStep,

            tool:
              tool.tool,

            stopReason:
              state.stopReason
          }
        );


        throw new Error(
          `Adaptive investigation stopped: ${state.stopReason}`
        );
      }


      this.taskState.setStatus(
        "investigating"
      );


      this.logger.info(
        "Executing local adaptive tool",
        {
          requestId:
            request.request_id,

          step:
            currentStep,

          tool:
            tool.tool,

          path:
            tool.path,

          query:
            tool.query,

          reason:
            tool.reason,

          toolCalls:
            state.toolCalls,

          maxToolCalls:
            state.maxToolCalls
        }
      );


      // ======================================================
      // EXECUTE TOOL LOCALLY
      // ======================================================

      let evidence: Array<{ path: string; content: string }>;

      try {
        evidence =
          await this.executeAdaptiveTool(
            tool,
            workspaceUri,
            index
          );

        // After file mutations or diagnostics, allow re-reading the same path.
        const mutatingTools = new Set([
          "edit_file",
          "write_file",
          "create_file",
          "delete_file",
          "rename_file",
          "move_file",
          "apply_change_set",
          "apply_patch",
          "get_diagnostics"
        ]);
        if (mutatingTools.has(tool.tool) && tool.path?.trim()) {
          state.clearPathInspectionKeys(tool.path.trim());
        }
        const target = tool.targetPath ?? tool.target_path;
        if (
          (tool.tool === "rename_file" || tool.tool === "move_file") &&
          target?.trim()
        ) {
          state.clearPathInspectionKeys(target.trim());
        }

        // Surface applied file diffs in chat during continuous agent edits.
        const fileChangeTools = new Set([
          "edit_file",
          "write_file",
          "create_file",
          "delete_file",
          "rename_file",
          "move_file",
          "apply_change_set",
          "apply_patch"
        ]);
        if (onEvent && fileChangeTools.has(tool.tool)) {
          const body = evidence
            .map((item) => item.content)
            .filter(Boolean)
            .join("\n\n");
          if (body.trim()) {
            onEvent({
              profile: (initialRequest.agent?.profile || "agent") as AgentEvent["profile"],
              type: "progress",
              message: "Updated `" + (tool.path || "file") + "`",
              timestamp: Date.now()
            });
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        if (message.includes("not approved")) {
          throw error;
        }
        this.logger.warn("Adaptive tool failed", error);
        evidence = [{
          path: `m3-tools/${tool.tool}.txt`,
          content: `tool=${tool.tool}\nsuccess=false\n${message}`
        }];
      }


      // ======================================================
      // NO EVIDENCE
      // ======================================================

      if (
        evidence.length === 0
      ) {

        this.logger.info(
          "Adaptive tool returned no evidence",
          {
            requestId:
              request.request_id,

            step:
              currentStep,

            tool:
              tool.tool
          }
        );


        continue;
      }


      // ======================================================
      // ADD EVIDENCE
      // ======================================================

      let addedChars = 0;

      let addedFiles = 0;


      for (
        const item of evidence
      ) {

        // ----------------------------------------------------
        // State has reached maximum evidence.
        // ----------------------------------------------------

        if (
          state.isStopped
        ) {

          break;
        }


        if (
          state.totalChars >=
          state.maxChars
        ) {

          state.stop(
            "max_chars"
          );

          break;
        }


        // ----------------------------------------------------
        // Normalize and validate path.
        // ----------------------------------------------------

        const normalizedPath =
          this.normalizeRelativePath(
            item.path
          );


        if (!normalizedPath) {
          continue;
        }


        if (
          this.isSensitivePath(
            normalizedPath
          )
        ) {
          continue;
        }


        // ----------------------------------------------------
        // Calculate remaining evidence budget.
        // ----------------------------------------------------

        const remaining =
          state.maxChars -
          state.totalChars;


        if (
          remaining <= 0
        ) {

          state.stop(
            "max_chars"
          );

          break;
        }


        const content =
          item.content.slice(
            0,
            Math.min(
              item.content.length,
              remaining,
              ADAPTIVE_MAX_FILE_CHARS
            )
          );


        if (!content) {
          continue;
        }


        // ----------------------------------------------------
        // Check if file already exists in context.
        // ----------------------------------------------------

        const existingIndex =
          context.files.findIndex(
            (file: any) =>
              file.path ===
              normalizedPath
          );


        // ----------------------------------------------------
        // Existing file:
        //
        // Replace its content with the newest evidence.
        //
        // The new content still counts against the adaptive
        // evidence budget because Gemini receives it again.
        // ----------------------------------------------------

        if (
          existingIndex >= 0
        ) {

          context.files[
            existingIndex
          ] = {

            ...context.files[
              existingIndex
            ],

            content
          };


          const accepted =
            this.addEvidenceChars(
              state,
              content.length
            );


          addedChars +=
            accepted;


          continue;
        }


        // ----------------------------------------------------
        // New file:
        //
        // Respect InvestigationState maxFiles.
        // ----------------------------------------------------

        if (
          state.investigatedCount >=
          state.maxFiles
        ) {

          state.stop(
            "max_files"
          );

          break;
        }


        // ----------------------------------------------------
        // Add new context file.
        // ----------------------------------------------------

        context.files.push({

          path:
            normalizedPath,

          content
        });


        state.markInvestigated(
          normalizedPath
        );


        const accepted =
          this.addEvidenceChars(
            state,
            content.length
          );


        addedChars +=
          accepted;


        addedFiles++;
      }


      // ======================================================
      // UPDATE TASK FILES
      // ======================================================

      this.taskState.setFiles(
        context.files.map(
          (file: any) =>
            file.path
        )
      );


      // ======================================================
      // TOKEN ESTIMATION
      // ======================================================

      const adaptiveTokens =
        this.tokenEstimator.estimateFiles(
          context.files
        );


      this.logger.info(
        "Adaptive evidence added",
        {
          requestId:
            request.request_id,

          step:
            currentStep,

          tool:
            tool.tool,

          evidenceItems:
            evidence.length,

          addedFiles,

          addedChars,

          totalEvidenceChars:
            state.totalChars,

          investigatedFiles:
            state.investigatedCount,

          contextFiles:
            context.files.length,

          estimatedTokens:
            adaptiveTokens
        }
      );


      // ======================================================
      // STOP IF STATE LIMIT WAS REACHED
      // ======================================================

      if (
        state.isStopped
      ) {

        this.logger.info(
          "Adaptive investigation stopped after evidence processing",
          {
            requestId:
              request.request_id,

            step:
              currentStep,

            stopReason:
              state.stopReason,

            snapshot:
              state.getSnapshot()
          }
        );


        throw new Error(
          `Adaptive investigation stopped: ${state.stopReason}`
        );
      }


      // ======================================================
      // PREPARE NEXT REQUEST
      // ======================================================

      request = {

        ...request,

        context,

        step:
          currentStep
      };


      this.logger.info(
        "Preparing next adaptive reasoning iteration",
        {
          requestId:
            request.request_id,

          nextStep:
            currentStep + 1,

          aiCalls:
            state.aiCalls,

          toolCalls:
            state.toolCalls,

          totalEvidenceChars:
            state.totalChars,

          investigatedFiles:
            state.investigatedCount
        }
      );


      // ------------------------------------------------------
      // Continue loop.
      //
      // Next cycle:
      //
      //   Agent
      //      ↓
      //   Backend
      //      ↓
      //   Gemini
      //      ↓
      //   decision
      //      ↓
      //   local tool
      //      ↓
      //   evidence
      //      ↓
      //   Agent
      //
      // ------------------------------------------------------
    }
  }


  // ==========================================================
  // ADD EVIDENCE CHARACTERS
  // ==========================================================

  private addEvidenceChars(
    state:
      InvestigationState,

    chars:
      number
  ): number {
    flow("Agent.addEvidenceChars", 1, "enter", { chars });

    if (
      chars <= 0
    ) {
      return 0;
    }


    const remaining =
      state.maxChars -
      state.totalChars;


    if (
      remaining <= 0
    ) {

      state.stop(
        "max_chars"
      );

      return 0;
    }


    const accepted =
      Math.min(
        chars,
        remaining
      );


    state.addChars(
      accepted
    );


    return accepted;
  }


  // ==========================================================
  // VALIDATE ADAPTIVE TOOL
  // ==========================================================

  private validateAdaptiveTool(
    tool:
      AdaptiveToolRequest
  ): void {
    flow("Agent.validateAdaptiveTool", 1, "enter", { tool: tool.tool });

    if (!isToolAllowed("agent", tool.tool)) {
      throw new Error(
        `Unsupported adaptive tool: ${tool.tool}`
      );
    }

    if (tool.tool === "read_file" && !tool.path?.trim()) {
      throw new Error("read_file requires a path.");
    }

    if (tool.tool === "search" && !tool.query?.trim()) {
      throw new Error("search requires a query.");
    }

    if (
      (tool.tool === "edit_file" || tool.tool === "write_file" || tool.tool === "create_file") &&
      !tool.path?.trim()
    ) {
      throw new Error(`${tool.tool} requires a path.`);
    }

    if (
      (tool.tool === "edit_file" || tool.tool === "write_file" || tool.tool === "create_file") &&
      !(tool.updated ?? tool.content)?.length &&
      !tool.changes?.length
    ) {
      throw new Error(`${tool.tool} requires file content.`);
    }

    if (
      (tool.tool === "delete_file") &&
      !tool.path?.trim()
    ) {
      throw new Error("delete_file requires a path.");
    }

    if (
      (tool.tool === "move_file" || tool.tool === "rename_file") &&
      (!tool.path?.trim() || !(tool.targetPath ?? tool.target_path)?.trim())
    ) {
      throw new Error(`${tool.tool} requires path and target_path.`);
    }

    if (tool.tool === "run_command" && !tool.command?.trim()) {
      throw new Error("run_command requires a command.");
    }

    if (tool.tool === "run_task" && !(tool.taskName ?? tool.task_name)?.trim()) {
      throw new Error("run_task requires a task_name.");
    }

    if (
      (tool.tool === "apply_change_set" || tool.tool === "apply_patch") &&
      !tool.changes?.length &&
      !(tool.path && (tool.updated ?? tool.content))
    ) {
      throw new Error(`${tool.tool} requires changes.`);
    }

    if (
      !tool.reason?.trim()
    ) {

      this.logger.info(
        "Adaptive tool request has no reason",
        {
          tool:
            tool.tool
        }
      );
    }
  }


  // ==========================================================
  // EXECUTE ADAPTIVE TOOL
  // ==========================================================
  //
  // IMPORTANT:
  //
  // Gemini never executes this method.
  //
  // Gemini only returns a structured tool request.
  //
  // The VS Code extension validates the request and
  // executes the read-only operation locally.
  //
  // ==========================================================

  private async executeAdaptiveTool(
    tool:
      AdaptiveToolRequest,

    workspaceUri:
      vscode.Uri,

    index:
      any
  ): Promise<Array<{
    path: string;
    content: string;
  }>> {
    flow("Agent.executeAdaptiveTool", 1, "enter", { tool: tool.tool });

    if (
      tool.tool ===
      "read_file"
    ) {

      return this.executeAdaptiveReadFile(
        tool.path!,
        workspaceUri
      );
    }

    if (
      tool.tool ===
      "search"
    ) {

      return this.executeAdaptiveSearch(
        tool.query!,
        index,
        workspaceUri
      );
    }

    if (
      tool.tool ===
      "list_files"
    ) {

      return this.executeAdaptiveListFiles(
        workspaceUri
      );
    }

    const result = await this.workspaceTools.execute(
      {
        tool: tool.tool,
        path: tool.path,
        targetPath: tool.targetPath ?? tool.target_path,
        query: tool.query,
        command: tool.command,
        content: tool.content,
        original: tool.original,
        updated: tool.updated,
        taskName: tool.taskName ?? tool.task_name,
        reason: tool.reason,
        changes: tool.changes
      },
      "agent"
    );

    return [{
      path: `m3-tools/${tool.tool}.txt`,
      content: [
        `tool=${result.tool}`,
        `success=${result.success}`,
        result.output
      ].join("\n")
    }];
  }


  // ==========================================================
  // LOCAL READ FILE
  // ==========================================================

  private async executeAdaptiveReadFile(
    relativePath:
      string,

    workspaceUri:
      vscode.Uri
  ): Promise<Array<{
    path: string;
    content: string;
  }>> {
    flow("Agent.executeAdaptiveReadFile", 1, "enter", { relativePath });

    const normalizedPath =
      this.normalizeRelativePath(
        relativePath
      );


    if (!normalizedPath) {

      throw new Error(
        "Invalid file path."
      );
    }


    // --------------------------------------------------------
    // Security check
    // --------------------------------------------------------

    if (
      this.isSensitivePath(
        normalizedPath
      )
    ) {

      throw new Error(
        `Access to sensitive file is blocked: ${normalizedPath}`
      );
    }


    const fileUri =
      vscode.Uri.joinPath(
        workspaceUri,
        ...normalizedPath.split("/")
      );


    try {

      const bytes =
        await vscode.workspace.fs.readFile(
          fileUri
        );


      let content =
        Buffer
          .from(bytes)
          .toString("utf8");


      if (
        content.length >
        ADAPTIVE_MAX_FILE_CHARS
      ) {

        content =
          content.slice(
            0,
            ADAPTIVE_MAX_FILE_CHARS
          );
      }


      this.logger.info(
        "Adaptive read_file completed",
        {
          path:
            normalizedPath,

          chars:
            content.length
        }
      );


      return [
        {
          path:
            normalizedPath,

          content
        }
      ];


    } catch (error) {

      this.logger.error(
        "Adaptive read_file failed",
        {
          path:
            normalizedPath,

          error
        }
      );


      throw new Error(
        `Unable to read file: ${normalizedPath}`
      );
    }
  }


  // ==========================================================
  // LOCAL SEARCH
  // ==========================================================

  private async executeAdaptiveSearch(
    query:
      string,

    index:
      any,

    workspaceUri:
      vscode.Uri
  ): Promise<Array<{
    path: string;
    content: string;
  }>> {
    flow("Agent.executeAdaptiveSearch", 1, "enter", { query });

    const searchResults =
      await this.searchEngine.search(
        query,
        index,
        ADAPTIVE_MAX_SEARCH_RESULTS
      );


    this.logger.info(
      "Adaptive search completed",
      {
        query,

        results:
          searchResults.length
      }
    );


    const results =
      searchResults.slice(
        0,
        ADAPTIVE_MAX_SEARCH_RESULTS
      );


    const evidence:
      Array<{
        path: string;
        content: string;
      }> = [];


    const seen =
      new Set<string>();


    for (
      const result of results
    ) {

      const normalizedPath =
        this.normalizeRelativePath(
          result.path
        );


      if (!normalizedPath) {
        continue;
      }


      if (
        seen.has(
          normalizedPath
        )
      ) {
        continue;
      }


      seen.add(
        normalizedPath
      );


      if (
        this.isSensitivePath(
          normalizedPath
        )
      ) {
        continue;
      }


      try {

        const fileEvidence =
          await this.executeAdaptiveReadFile(
            normalizedPath,
            workspaceUri
          );


        evidence.push(
          ...fileEvidence
        );


      } catch (error) {

        this.logger.info(
          "Adaptive search result could not be read",
          {
            path:
              normalizedPath,

            error
          }
        );
      }
    }


    return evidence;
  }


  // ==========================================================
  // LOCAL LIST FILES
  // ==========================================================

  private async executeAdaptiveListFiles(
    workspaceUri:
      vscode.Uri
  ): Promise<Array<{
    path: string;
    content: string;
  }>> {
    flow("Agent.executeAdaptiveListFiles", 1, "enter");

    const uris =
      await vscode.workspace.findFiles(
        "**/*",
        "**/{node_modules,.git,dist,build,out,coverage}/**",
        ADAPTIVE_MAX_LIST_FILES
      );


    const files:
      Array<{
        path: string;
        content: string;
      }> = [];


    for (
      const uri of uris
    ) {

      const relative =
        vscode.workspace.asRelativePath(
          uri,
          false
        );


      const normalizedPath =
        this.normalizeRelativePath(
          relative
        );


      if (!normalizedPath) {
        continue;
      }


      if (
        this.isSensitivePath(
          normalizedPath
        )
      ) {
        continue;
      }


      try {

        const fileEvidence =
          await this.executeAdaptiveReadFile(
            normalizedPath,
            workspaceUri
          );


        files.push(
          ...fileEvidence
        );


      } catch (error) {

        this.logger.info(
          "Adaptive list_files could not read file",
          {
            path:
              normalizedPath,

            error
          }
        );
      }
    }


    this.logger.info(
      "Adaptive list_files completed",
      {
        files:
          files.length
      }
    );


    return files;
  }


  // ==========================================================
  // PATH NORMALIZATION
  // ==========================================================

  private normalizeRelativePath(
    filePath:
      string
  ): string {
    flow("Agent.normalizeRelativePath", 1, "enter");

    let normalized =
      filePath
        .replace(
          /\\/g,
          "/"
        )
        .trim();


    // --------------------------------------------------------
    // Remove leading "./".
    // --------------------------------------------------------

    while (
      normalized.startsWith(
        "./"
      )
    ) {

      normalized =
        normalized.slice(
          2
        );
    }


    // --------------------------------------------------------
    // Never allow an absolute filesystem path.
    // --------------------------------------------------------

    if (
      normalized.startsWith(
        "/"
      )
    ) {

      return "";
    }


    // --------------------------------------------------------
    // Never allow Windows drive paths.
    // --------------------------------------------------------

    if (
      /^[A-Za-z]:/.test(
        normalized
      )
    ) {

      return "";
    }


    // --------------------------------------------------------
    // Prevent path traversal.
    // --------------------------------------------------------

    const parts =
      normalized.split(
        "/"
      );


    if (
      parts.some(
        part =>
          part ===
          ".."
      )
    ) {

      return "";
    }


    return parts
      .filter(
        part =>
          part.length > 0 &&
          part !== "."
      )
      .join(
        "/"
      );
  }


  // ==========================================================
  // SENSITIVE PATH PROTECTION
  // ==========================================================

  private isSensitivePath(
    filePath:
      string
  ): boolean {
    flow("Agent.isSensitivePath", 1, "enter");

    const normalized =
      filePath
        .replace(
          /\\/g,
          "/"
        )
        .toLowerCase();


    const fileName =
      normalized
        .split("/")
        .pop() ?? "";


    // Environment files (.env, .env.prod, etc.) are allowed so the agent
    // can read/update project configuration when the user asks.


    // --------------------------------------------------------
    // Private keys / certificates
    // --------------------------------------------------------

    const blockedExtensions = [
      ".pem",
      ".key",
      ".p12",
      ".pfx",
      ".crt",
      ".cer",
      ".der"
    ];


    if (
      blockedExtensions.some(
        extension =>
          normalized.endsWith(
            extension
          )
      )
    ) {

      return true;
    }


    // --------------------------------------------------------
    // Common credential files
    // --------------------------------------------------------

    const blockedNames = [
      "id_rsa",
      "id_dsa",
      "id_ecdsa",
      "id_ed25519",
      "credentials",
      "credentials.json",
      "service-account.json"
    ];


    if (
      blockedNames.includes(
        fileName
      )
    ) {

      return true;
    }


    // --------------------------------------------------------
    // Secret / password / token files
    // --------------------------------------------------------

    if (
      fileName.includes(
        "secret"
      )
      ||
      fileName.includes(
        "password"
      )
      ||
      fileName.includes(
        "token"
      )
    ) {

      return true;
    }


    return false;
  }


  // ==========================================================
  // TOOL REQUEST KEY
  // ==========================================================

  private createToolRequestKey(
    tool:
      AdaptiveToolRequest
  ): string {
    flow("Agent.createToolRequestKey", 1, "enter", { tool: tool.tool });

    return [
      tool.tool,
      tool.path ?? "",
      tool.targetPath ?? tool.target_path ?? "",
      tool.query ?? "",
      tool.command ?? "",
      tool.taskName ?? tool.task_name ?? ""
    ].join(
      "|"
    );
  }


  // ==========================================================
  // CONVERSATION
  // ==========================================================

  getConversation() {
    flow("Agent.getConversation", 1, "enter");
    return this.conversation.getMessages();
  }


  // ==========================================================
  // TASK STATE
  // ==========================================================

  getTaskState() {
    flow("Agent.getTaskState", 1, "enter");
    return this.taskState.get();
  }


  // ==========================================================
  // CLEAR CONVERSATION
  // ==========================================================

  clearConversation(): void {
    flow("Agent.clearConversation", 1, "enter");

    this.conversation.clear();
  }


  // ==========================================================
  // REQUEST ID
  // ==========================================================

  private createRequestId(): string {
    flow("Agent.createRequestId", 1, "enter");

    return [
      Date.now().toString(36),

      Math.random()
        .toString(36)
        .slice(2, 10)
    ].join(
      "-"
    );
  }


  // ==========================================================
  // PROJECT ID
  // ==========================================================

  private createProjectId(
    uri:
      vscode.Uri
  ): string {
    flow("Agent.createProjectId", 1, "enter");

    // --------------------------------------------------------
    // Never send the absolute workspace path as project
    // identity.
    //
    // A deterministic local hash is used instead.
    // --------------------------------------------------------

    let hash =
      0;


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

