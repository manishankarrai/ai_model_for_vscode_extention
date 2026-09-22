
import * as vscode from "vscode";

import {
  AIRequest,
  AIResponse,
  AIContext,
  Intent,
  AgentProfile,
  AgentEvent,
  AgentTaskStatus,
  ContextPart,
  ContextFile,
  InteractionMode,
  ImplementationPlan,
} from "../models/types";

import { InvestigationState } from "../intelligence/InvestigationState";
import { hasSufficientAdaptiveConfidence } from "../intelligence/confidence";

import {
  AgentTaskRecord,
  AgentTaskStateResponse,
  BackendClient
} from "../backend/BackendClient";

import { ConversationState } from "../state/ConversationState";
import { TaskState } from "../state/TaskState";

import { Logger } from "../utils/Logger";

import { getToolPolicy, isToolAllowed } from "../tools/toolPolicy";
import {
  ToolApprovalHandler,
  WorkspaceToolRegistry
} from "../tools/WorkspaceToolRegistry";
import type {
  AgentToolName,
  CodeChange,
  ToolApprovalStatus
} from "../models/types";
import { CodeChangeApplier } from "../safety/CodeChangeApplier";
import { adaptiveLimits } from "../config/adaptiveLimits";
import { chunkContextParts } from "../intelligence/contextSelection";


import { flow } from "../utils/flowLog";

// ============================================================
// Stage 4
// Adaptive reasoning types
// ============================================================

type AdaptiveToolName = AgentToolName;

interface AdaptiveToolRequest {
  tool: AdaptiveToolName;
  path?: string;
  offset?: number;
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

interface AdaptiveToolResult {
  tool: AdaptiveToolName;
  path?: string;
  success: boolean;
  approval?: ToolApprovalStatus;
  reason?: string;
  output: string;
  error?: string;
}

interface AdaptiveToolExecution {
  evidence: ContextFile[];
  success: boolean;
  output: string;
  approval?: ToolApprovalStatus;
  error?: string;
}

interface AdaptiveLimitExtension {
  toolCalls: number;
  aiCalls: number;
}

type AdaptiveLimitHandler = (details: {
  reason: "max_tool_calls" | "max_ai_calls";
  currentLimit: number;
  currentToolLimit: number;
  currentAICallLimit: number;
}) => Promise<AdaptiveLimitExtension | undefined>;


interface AdaptiveDecision {

  intent?: Exclude<Intent, "auto">;

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

  tools?:
    AdaptiveToolRequest[];
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
    tool_results?: AdaptiveToolResult[];
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

const ADAPTIVE_MAX_SEARCH_RESULTS = adaptiveLimits.maxSearchResults;

const ADAPTIVE_MAX_LIST_FILES = adaptiveLimits.maxListFiles;
const ADAPTIVE_MAX_MANIFEST_FILES = adaptiveLimits.ADAPTIVE_MAX_MANIFEST_FILES;
const ADAPTIVE_MANIFEST_PAGE_CHARS =  adaptiveLimits.ADAPTIVE_MANIFEST_PAGE_CHARS;
const ADAPTIVE_MAX_SEARCH_FILE_BYTES =  adaptiveLimits.ADAPTIVE_MAX_SEARCH_FILE_BYTES;
const ADAPTIVE_MANIFEST_CACHE_TTL_MS = adaptiveLimits.ADAPTIVE_MANIFEST_CACHE_TTL_MS;
const ADAPTIVE_TOOL_CONCURRENCY = adaptiveLimits.ADAPTIVE_TOOL_CONCURRENCY;

const ADAPTIVE_MAX_FILE_CHARS = adaptiveLimits.maxFileChars;
const ADAPTIVE_MAX_TOOL_OUTPUT_CHARS = adaptiveLimits.maxToolOutputChars;
const MIN_ADAPTIVE_CONFIDENCE = adaptiveLimits.minConfidence;
const ACTIVE_TASK_STORAGE_KEY = "mm3.activeAgentTask";


// ============================================================
// Agent
// ============================================================

export class Agent {
  private readonly backend =
    new BackendClient();

  private lastRequest?: AdaptiveAIRequest;

  private manifestCache?: {
    workspaceKey: string;
    content: string;
    expiresAt: number;
  };


  private readonly workspaceTools: WorkspaceToolRegistry;


  constructor(
    private readonly conversation:
      ConversationState,

    private readonly taskState:
      TaskState,

    private readonly logger:
      Logger,

    changeApplier = new CodeChangeApplier(),
    private readonly taskStorage?: vscode.Memento
  ) {
    flow("Agent.constructor", 1, "enter");

    this.workspaceTools =
      new WorkspaceToolRegistry(changeApplier, taskStorage);
  }

  setApprovalHandler(handler: ToolApprovalHandler | undefined): void {
    this.workspaceTools.setApprovalHandler(handler);
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
    onEvent?: (event: AgentEvent) => void,
    onLimitReached?: AdaptiveLimitHandler
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


    const requestAction: Intent = "auto";


    const requestId =
      this.createRequestId();
    flow("Agent.process", 2, "backend investigation requested", { requestId, requestAction });

    if (onEvent && mode === "agent") {
      void this.backend.streamAgentEvents(
        requestId,
        accessToken,
        onEvent,
        signal
      ).catch(async (error: unknown) => {
        this.logger.warn(".............Agent event stream unavailable; loading task status", error);
        try {
          const state = await this.backend.getAgentTaskState(requestId, accessToken);
          for (const event of state.task.events ?? []) {
            onEvent(event);
          }
        } catch (statusError) {
          try {
            const task = await this.backend.getAgentTask(requestId, accessToken);
            for (const event of (task as AgentTaskStatus).events ?? []) {
              onEvent(event);
            }
          } catch (legacyStatusError) {
            this.logger.warn("Unable to reload agent task status", legacyStatusError);
          }
        }
      });
    }


    this.taskState.start(
      requestId,
      question,
      requestAction
    );


    this.logger.info(
      "MM3 task started",
      {
        requestId,
        requestAction
      }
    );


    this.conversation.addUserMessage(
      question
    );

    await this.clearPersistedTask();

    this.emitProgress(onEvent, agentProfile, "Starting backend investigation.");


    try {

      // ======================================================
      // Start with explicit user context; the backend requests any further tools.
      // ======================================================

      const initialContext: AIContext = {
        files: [],
        indexSummary: "",
        evidence: [],
        parts: chunkContextParts(
          selectedContext,
          adaptiveLimits.maxFileChars,
          adaptiveLimits.maxChars
        )
      };
      const backendRequest: AdaptiveAIRequest = {
        action: requestAction,
        request_id: requestId,
        question,
        mode,
        tool_policy: getToolPolicy(mode),
        agent: {
          profile: agentProfile,
          count: Math.max(1, Math.min(agentCount, mode === "ask" ? 1 : 5))
        },
        project: {
          id: this.createProjectId(workspace.uri),
          name: workspace.name,
          indexVersion: 0,
          targetPath: this.getConfiguredImplementationRoot()
        },
        context: initialContext,
        plan: []
      };

      this.taskState.setStatus("investigating");
      this.taskState.setFiles(selectedContext.map(part => part.path));
      this.lastRequest = backendRequest;
      await this.persistActiveTask(backendRequest.request_id);

      const backendResponse = await this.runAdaptiveInvestigation(
        backendRequest,
        accessToken,
        workspace.uri,
        initialContext,
        signal,
        onEvent,
        onLimitReached
      );

      this.taskState.setAICalls(backendResponse.usage.ai_api_calls);
      this.taskState.complete();
      await this.clearPersistedTask();
      return backendResponse;

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

  async resumeLastTask(
    accessToken: string,
    signal?: AbortSignal,
    onEvent?: (event: AgentEvent) => void,
    onLimitReached?: AdaptiveLimitHandler,
    preferredProfile?: AgentProfile
  ): Promise<AIResponse | undefined> {
    const persistedRequestID =
      this.taskStorage?.get<string>(ACTIVE_TASK_STORAGE_KEY);
    const requestID = this.lastRequest?.request_id ?? persistedRequestID;
    if (!requestID) {
      return undefined;
    }

    return this.resumeTask(requestID, accessToken, signal, onEvent, onLimitReached, preferredProfile);
  }

  async resumeTask(
    requestID: string,
    accessToken: string,
    signal?: AbortSignal,
    onEvent?: (event: AgentEvent) => void,
    onLimitReached?: AdaptiveLimitHandler,
    expectedProfile?: AgentProfile
  ): Promise<AIResponse | undefined> {
    const reusableRequest =
      this.lastRequest?.request_id === requestID
        ? this.lastRequest
        : undefined;

    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      throw new Error("Please open a workspace first.");
    }

    let taskState: AgentTaskStateResponse;
    try {
      taskState = await this.backend.getAgentTaskState(requestID, accessToken);
    } catch (error) {
      this.logger.warn("Unable to restore persisted agent task", error);
      await this.clearPersistedTask(requestID);
      return undefined;
    }
    if (expectedProfile && taskState.task.agent?.profile !== expectedProfile) {
      this.logger.info("Skipping stale agent task after profile change", {
        requestId: requestID,
        previousProfile: taskState.task.agent?.profile,
        selectedProfile: expectedProfile
      });
      await this.clearPersistedTask(requestID);
      return undefined;
    }
    const pendingDecision = taskState.task.pending_decision;
    if (taskState.task.status !== "waiting_for_tool" || !pendingDecision) {
      await this.clearPersistedTask(requestID);
      return undefined;
    }

    const context = await this.loadTaskContext(taskState, accessToken);
    const initialRequest: AdaptiveAIRequest = {
      ...(reusableRequest ?? {
        action: taskState.task.action,
        request_id: taskState.task.request_id,
        question: taskState.task.question,
        mode: taskState.task.mode,
        project: taskState.task.project,
        agent: taskState.task.agent,
        tool_policy: taskState.task.tool_policy,
        plan: taskState.task.plan ?? [],
      }),
      project: taskState.task.project,
      context,
      tool_results: undefined
    };
    this.lastRequest = initialRequest;

    this.logger.info("Resuming backend agent task", {
      requestId: initialRequest.request_id,
      step: taskState.task.current_step
    });

    const response = await this.runAdaptiveInvestigation(
      initialRequest,
      accessToken,
      workspace.uri,
      context,
      signal,
      onEvent,
      onLimitReached,
      taskState.task,
      pendingDecision as AdaptiveDecision
    );
    await this.clearPersistedTask();
    return response;
  }

  private async persistActiveTask(requestID: string): Promise<void> {
    try {
      await this.taskStorage?.update(ACTIVE_TASK_STORAGE_KEY, requestID);
    } catch (error) {
      this.logger.warn("Unable to persist active agent task", error);
    }
  }

  private async clearPersistedTask(requestID?: string): Promise<void> {
    try {
      const persistedRequestID =
        this.taskStorage?.get<string>(ACTIVE_TASK_STORAGE_KEY);
      if (requestID && persistedRequestID && persistedRequestID !== requestID) {
        return;
      }
      await this.taskStorage?.update(ACTIVE_TASK_STORAGE_KEY, undefined);
    } catch (error) {
      this.logger.warn("Unable to clear persisted agent task", error);
    }
  }

  private async loadTaskContext(
    taskState: AgentTaskStateResponse,
    accessToken: string
  ): Promise<AIContext> {
    const budget = taskState.task.budget;
    const maxFiles = Math.min(
      budget?.max_files ?? taskState.evidence.length,
      adaptiveLimits.maxFiles
    );
    const maxChars = Math.min(
      budget?.max_context_chars ?? adaptiveLimits.maxChars,
      adaptiveLimits.maxChars
    );
    const files: ContextFile[] = [];
    const parts: ContextPart[] = [];
    let chars = 0;

    for (const summary of taskState.evidence) {
      if (files.length + parts.length >= maxFiles || chars >= maxChars) {
        break;
      }

      const evidence = await this.backend.getAgentTaskEvidence(
        taskState.task.request_id,
        summary.path,
        accessToken,
        summary.kind as "file" | "selection" | "attachment",
        summary.byteStart,
        summary.byteEnd
      );
      const recoveredPart: ContextPart = {
        kind: summary.kind as ContextPart["kind"],
        path: evidence.path,
        content: evidence.content,
        language: evidence.language ?? "",
        startLine: evidence.start_line,
        endLine: evidence.end_line,
        chunkIndex: evidence.chunkIndex,
        chunkCount: evidence.chunkCount,
        byteStart: evidence.byteStart,
        byteEnd: evidence.byteEnd,
        totalBytes: evidence.totalBytes,
        hasMore: evidence.hasMore
      };
      const recoveredBytes = Buffer.byteLength(recoveredPart.content, "utf8");
      const chunks = recoveredBytes <= adaptiveLimits.maxFileChars && recoveredBytes <= maxChars - chars
        ? [recoveredPart]
        : chunkContextParts([recoveredPart], adaptiveLimits.maxFileChars, maxChars - chars);

      for (const chunk of chunks) {
        if (files.length + parts.length >= maxFiles) {
          break;
        }
        chars += Buffer.byteLength(chunk.content, "utf8");
        if (summary.kind === "file") {
          files.push({
            ...chunk,
            path: chunk.path,
            content: chunk.content
          });
        } else {
          parts.push(chunk);
        }
      }
    }

    return {
      files,
      indexSummary: "",
      evidence: [],
      parts
    };
  }

  private recordAdaptiveResponse(response: AdaptiveAIResponse): void {
    const decision = response.decision;
    if (!decision) {
      if (response.answer?.trim()) {
        this.conversation.addAssistantMessage(response.answer.trim());
      }
      return;
    }

    if (decision.action === "FINAL_ANSWER") {
      const answer = response.answer?.trim() || decision.answer?.trim();
      if (answer) {
        this.conversation.addAssistantMessage(answer);
      }
      return;
    }

    const requestedTools = [
      ...(decision.tools ?? []).map((tool) => tool.tool),
      ...(decision.tool ? [decision.tool.tool] : [])
    ].join(", ");
    const summary = [
      "Adaptive assistant decision: CONTINUE_INVESTIGATION.",
      decision.reason ? `Reason: ${decision.reason}` : "",
      requestedTools ? `Requested tools: ${requestedTools}` : ""
    ].filter(Boolean).join("\n");
    this.conversation.addAssistantMessage(summary);
  }

  private emitProgress(
    onEvent: ((event: AgentEvent) => void) | undefined,
    profile: AgentProfile,
    message: string
  ): void {
    onEvent?.({
      profile,
      type: "progress",
      message,
      timestamp: Date.now()
    });
  }

  private compactInvestigationText(value: string, maxLength = 280): string {
    const compact = value.replace(/\s+/g, " ").trim();
    if (compact.length <= maxLength) {
      return compact;
    }
    return compact.slice(0, maxLength - 3) + "...";
  }

  private emitInvestigationUpdate(
    onEvent: ((event: AgentEvent) => void) | undefined,
    profile: AgentProfile,
    message: string
  ): void {
    const compact = this.compactInvestigationText(message);
    if (!compact) {
      return;
    }
    onEvent?.({
      profile,
      type: "progress",
      message: compact,
      timestamp: Date.now()
    });
  }

  private buildInvestigationSummary(
    entries: string[],
    state: InvestigationState
  ): string {
    const uniqueEntries = [...new Set(entries.filter(Boolean))].slice(-12);
    const lines = uniqueEntries.length > 0
      ? uniqueEntries.map((entry) => `- ${entry}`)
      : ["- Reviewed the available project context and completed the requested reasoning."];
    lines.push(`- Investigation completed after ${state.steps} step(s), ${state.aiCalls} AI call(s), and ${state.toolCalls} tool call(s).`);
    return [
      "## Investigation Summary",
      ...lines,
      "",
      "## Final Result"
    ].join("\n");
  }

  private summarizeAdaptiveToolResult(result: AdaptiveToolResult): string {
    if (!result.success) {
      return `${result.tool}: the requested workspace operation could not be completed; continuing investigation.`;
    }
    const target = result.path ? ` (${result.path})` : "";
    const detail = this.compactInvestigationText(result.error || result.output, 180);
    return `${result.tool}${target}: ${result.success ? "completed" : "failed"}${detail ? ` - ${detail}` : ""}`;
  }

  private getAdaptiveToolRequestFailure(error: unknown): string | undefined {
    const message = error instanceof Error ? error.message : String(error);
    if (!/(?:requires|must|unsupported|not allowed)/i.test(message)) {
      return undefined;
    }
    const match = message.match(
      /\b(read_file|search|list_files|get_diagnostics|git_status|git_diff|edit_file|write_file|create_file|delete_file|move_file|rename_file|apply_change_set|apply_patch|run_command|run_task|run_tests)\b/i
    );
    return match?.[1];
  }

  private addInvestigationSummaryToAnswer(
    answer: string,
    entries: string[],
    state: InvestigationState
  ): string {
    const normalizedAnswer = answer.trim();
    if (/^(?:#{1,6}\s*)?investigation summary\b/i.test(normalizedAnswer)) {
      return normalizedAnswer;
    }
    return `${this.buildInvestigationSummary(entries, state)}\n${normalizedAnswer}`;
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

    initialContext:
      any,

    signal?: AbortSignal,

    onEvent?: (event: AgentEvent) => void,

    onLimitReached?: AdaptiveLimitHandler,

    existingTask?: AgentTaskRecord,
    pendingDecision?: AdaptiveDecision
  ): Promise<AIResponse> {
    flow("Agent.runAdaptiveInvestigation", 1, "enter");

    const task = existingTask ?? await this.backend.createAgentTask(
      {
        request_id: initialRequest.request_id,
        action: initialRequest.action,
        question: initialRequest.question,
        mode: initialRequest.mode,
        project: initialRequest.project,
        agent: initialRequest.agent,
        tool_policy: initialRequest.tool_policy,
        plan: initialRequest.plan
      },
      accessToken,
      signal
    );

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
    // - stop reason
    // --------------------------------------------------------

    const state =
      new InvestigationState({
        maxSteps: task.budget?.max_steps,
        maxFiles: task.budget?.max_files,
        maxChars: Math.min(
          task.budget?.max_context_chars ?? adaptiveLimits.maxChars,
          adaptiveLimits.maxChars
        ),
        maxAICalls: task.budget?.max_ai_calls,
        maxToolCalls: task.budget?.max_tool_calls
      });


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

    let reasoningContext =
      initialContext;

    const readOffsets = new Map<string, number>();

    const investigationSummary: string[] = [];

    if (existingTask && pendingDecision) {
      for (let step = 0; step < (existingTask.current_step ?? 0); step++) {
        if (!state.startStep()) {
          throw new Error(`Adaptive investigation stopped: ${state.stopReason}`);
        }
      }

      const pendingTools = [
        ...(pendingDecision.tools ?? []),
        ...(pendingDecision.tool ? [pendingDecision.tool] : [])
      ];
      for (const tool of pendingTools) {
        this.validateAdaptiveTool(tool);
      }
      const resumed = await this.executeAdaptiveToolBatch(
        pendingTools,
        request.request_id,
        existingTask.current_step ?? 0,
        workspaceUri,
        state,
        onEvent,
        accessToken,
        signal,
        onLimitReached,
        initialRequest.agent?.profile || "agent",
        initialRequest.mode,
        readOffsets
      );
      context = this.mergeAdaptiveEvidence(context, resumed.evidence);
      reasoningContext = {
        ...context,
        files: context.files
      };
      request = {
        ...request,
        context: reasoningContext,
        tool_results: resumed.toolResults,
        step: existingTask.current_step
      };
      for (const result of resumed.toolResults) {
        const toolSummary = this.summarizeAdaptiveToolResult(result);
        this.emitInvestigationUpdate(
          onEvent,
          initialRequest.agent?.profile || "agent",
          `Evidence update: ${toolSummary}`
        );
        investigationSummary.push(toolSummary);
      }
    }

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

      // maxChars limits the evidence sent in one reasoning request. It is
      // reset here so repeated API cycles can continue reading large files.
      state.resetCharsForNextRequest();

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

        if (state.stopReason === "max_ai_calls" && onLimitReached) {
          const extension = await onLimitReached({
            reason: "max_ai_calls",
            currentLimit: state.maxAICalls,
            currentToolLimit: state.maxToolCalls,
            currentAICallLimit: state.maxAICalls
          });
          if (extension && extension.aiCalls > 0 && extension.toolCalls > 0) {
            await this.backend.increaseAgentTaskBudget(
              request.request_id,
              {
                toolCalls: extension.toolCalls,
                aiCalls: extension.aiCalls
              },
              accessToken,
              signal
            );
            if (
              state.extendLimits(extension.toolCalls, extension.aiCalls) &&
              state.incrementAICalls()
            ) {
              this.emitProgress(
                onEvent,
                initialRequest.agent?.profile || "agent",
                `Continuing investigation with ${state.maxAICalls} AI calls and ${state.maxToolCalls} tool calls.`
              );
            } else {
              throw new Error(`Adaptive investigation stopped: ${state.stopReason}`);
            }
          } else {
            throw new Error(`Adaptive investigation stopped: ${state.stopReason}`);
          }
        } else {

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
      }


      // ======================================================
      // PREPARE REQUEST
      // ======================================================

      request = {

        ...request,

        context: reasoningContext,

        step:
          currentStep
      };


      this.taskState.setStatus(
        "sending"
      );

      this.emitProgress(
        onEvent,
        initialRequest.agent?.profile || "agent",
        `Thinking with AI (step ${currentStep}).`
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

      let rawResponse: AIResponse;
      try {
        rawResponse = await this.backend.decideAgentTask(
          request.request_id,
          {
            context: request.context,
            tool_results: request.tool_results,
            step: request.step
          },
          accessToken,
          signal
        );
      } catch (error) {
        const invalidTool = this.getAdaptiveToolRequestFailure(error);
        if (!invalidTool) {
          throw error;
        }

        const correction = "The previous workspace operation was incomplete or invalid. Re-check every required argument and request the corrected operation.";
        this.logger.warn("Adaptive decision contained an invalid tool request", {
          tool: invalidTool,
          error
        });
        this.emitInvestigationUpdate(
          onEvent,
          initialRequest.agent?.profile || "agent",
          "The requested workspace operation was incomplete. Retrying with corrected details."
        );
        const failedToolResult: AdaptiveToolResult = {
          tool: invalidTool as AdaptiveToolName,
          success: false,
          output: "",
          error: correction
        };
        request = {
          ...request,
          tool_results: [
            ...(request.tool_results ?? []),
            failedToolResult
          ]
        };
        continue;
      }

      const response =
        rawResponse as AdaptiveAIResponse;

      this.emitProgress(
        onEvent,
        initialRequest.agent?.profile || "agent",
        "AI response received. Evaluating the next step."
      );

      const decisionReason = response.decision?.reason?.trim();
      if (decisionReason) {
        const reasonUpdate = `AI reasoning: ${this.compactInvestigationText(decisionReason)}`;
        this.emitInvestigationUpdate(
          onEvent,
          initialRequest.agent?.profile || "agent",
          reasonUpdate
        );
        investigationSummary.push(reasonUpdate);
      }

      this.recordAdaptiveResponse(response);


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


        const answer = this.addInvestigationSummaryToAnswer(
          response.answer?.trim() || "",
          investigationSummary,
          state
        );
        return {
          ...response,
          answer,
          usage:
            totalUsage
        };
      }

      if (
        response.decision.action === "FINAL_ANSWER" &&
        !hasSufficientAdaptiveConfidence(response.decision.confidence)
      ) {
        const modelTools = [
          ...(response.decision.tools ?? []),
          ...(response.decision.tool ? [response.decision.tool] : [])
        ];
        const followUpTools = modelTools.length > 0
          ? modelTools
          : [{
              tool: "list_files" as AdaptiveToolName,
              reason: `Confidence must be greater than ${MIN_ADAPTIVE_CONFIDENCE}; inspect the workspace before answering.`
            }];

        this.emitInvestigationUpdate(
          onEvent,
          initialRequest.agent?.profile || "agent",
          `Confidence ${response.decision.confidence} is not greater than ${MIN_ADAPTIVE_CONFIDENCE}; continuing investigation.`
        );
        investigationSummary.push(
          `Investigation continued because confidence was not greater than ${MIN_ADAPTIVE_CONFIDENCE}.`
        );
        response.decision = {
          ...response.decision,
          action: "CONTINUE_INVESTIGATION",
          tool: undefined,
          tools: followUpTools
        };
      }


      // ======================================================
      // FINAL ANSWER
      // ======================================================

      if (
        response.decision.action ===
        "FINAL_ANSWER"
      ) {

        this.emitProgress(onEvent, initialRequest.agent?.profile || "agent", "Preparing the final answer.");

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

        investigationSummary.push("Final answer prepared from the collected evidence.");
        const summarizedAnswer = this.addInvestigationSummaryToAnswer(
          answer,
          investigationSummary,
          state
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

          answer: summarizedAnswer,

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

      const tools = [
        ...(response.decision.tools ?? []),
        ...(response.decision.tool ? [response.decision.tool] : [])
      ];


      if (tools.length === 0) {

        state.stop(
          "insufficient_evidence"
        );


        throw new Error(
          "Gemini requested CONTINUE_INVESTIGATION without a tool."
        );
      }

      const requestedTools = tools.map((tool) => tool.tool).join(", ");
      const requestedToolsUpdate = `Requested tools: ${requestedTools}`;
      this.emitInvestigationUpdate(
        onEvent,
        initialRequest.agent?.profile || "agent",
        requestedToolsUpdate
      );
      investigationSummary.push(requestedToolsUpdate);


      this.taskState.setStatus(
        "investigating"
      );

      this.emitProgress(onEvent, initialRequest.agent?.profile || "agent", "Continuing local investigation.");

      for (const tool of tools) {
        this.validateAdaptiveTool(tool);
      }

      const { evidence, toolResults } =
        await this.executeAdaptiveToolBatch(
          tools,
          request.request_id,
          currentStep,
          workspaceUri,
          state,
          onEvent,
          accessToken,
          signal,
          onLimitReached,
          initialRequest.agent?.profile || "agent",
          initialRequest.mode,
          readOffsets
        );

      for (const result of toolResults) {
        const toolSummary = this.summarizeAdaptiveToolResult(result);
        this.emitInvestigationUpdate(
          onEvent,
          initialRequest.agent?.profile || "agent",
          `Evidence update: ${toolSummary}`
        );
        investigationSummary.push(toolSummary);
        if (!result.success && (result.tool === "run_command" || result.tool === "run_tests" || result.tool === "get_diagnostics")) {
          this.emitInvestigationUpdate(
            onEvent,
            initialRequest.agent?.profile || "agent",
            "Validation reported an error; sending the failure back for continued investigation."
          );
          investigationSummary.push("Validation reported an error; the failure was returned to the investigation loop.");
        }
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

            tools:
              tools.map(
                item => item.tool
              )
          }
        );

        request = {
          ...request,
          context: {
            files: [],
            indexSummary: context.indexSummary,
            evidence: []
          },
          tool_results: toolResults,
          step: currentStep
        };

        reasoningContext = {
          ...context,
          files: []
        };


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

          const evidenceKey = this.contextFileKey({
            ...item,
            path: normalizedPath,
            content
          });
          const existingIndex = context.files.findIndex(
            (file: ContextFile) => this.contextFileKey(file) === evidenceKey
          );


        // ----------------------------------------------------
        // Existing file:
        //
        // Replace its content with the newest evidence.
        //
        // The new content still counts against the adaptive
        // evidence budget because Gemini receives it again.
        // ----------------------------------------------------

        if (existingIndex >= 0) {

          context.files[
            existingIndex
          ] = {

            ...context.files[
              existingIndex
            ],

            ...item,
            path: normalizedPath,
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

        const pathAlreadyInvestigated = context.files.some(
          (file: ContextFile) => file.path === normalizedPath
        );
        if (!pathAlreadyInvestigated && state.investigatedCount >= state.maxFiles) {

          state.stop(
            "max_files"
          );

          break;
        }


        // ----------------------------------------------------
        // Add new context file.
        // ----------------------------------------------------

        context.files.push({
          ...item,
          path: normalizedPath,
          content
        });

        if (!pathAlreadyInvestigated) {
          state.markInvestigated(normalizedPath);
        }


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

      reasoningContext = {
        ...context,
        files: context.files
      };


      // ======================================================
      // TOKEN ESTIMATION
      // ======================================================

      this.logger.info(
        "Adaptive evidence added",
        {
          requestId:
            request.request_id,

          step:
            currentStep,

          tools:
            tools.map(
              item => item.tool
            ),

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

        context: {
          files: context.files,
          indexSummary: context.indexSummary,
          evidence: []
        },

        tool_results: toolResults,

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

  private mergeAdaptiveEvidence(
    context: AIContext,
    evidence: ContextFile[]
  ): AIContext {
    const files = [...context.files];
    const existing = new Set(files.map((file) => this.contextFileKey(file)));
    for (const item of evidence) {
      const key = this.contextFileKey(item);
      if (!item.path || existing.has(key)) {
        continue;
      }
      files.push(item);
      existing.add(key);
    }
    return {
      ...context,
      files
    };
  }

  private contextFileKey(file: ContextFile): string {
    const range = file.byteStart !== undefined || file.byteEnd !== undefined
      ? `${file.byteStart ?? 0}:${file.byteEnd ?? file.content.length}`
      : "full";
    return `${file.path}:${range}`;
  }

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

    if (tool.tool === "edit_file" && tool.original === undefined) {
      throw new Error(
        "edit_file requires the exact original file or selected code content."
      );
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

  private async executeAdaptiveToolBatch(
    tools: AdaptiveToolRequest[],
    requestId: string,
    step: number,
    workspaceUri: vscode.Uri,
    state: InvestigationState,
    onEvent?: (event: AgentEvent) => void,
    accessToken?: string,
    signal?: AbortSignal,
    onLimitReached?: AdaptiveLimitHandler,
    profile: string = "agent",
    mode: InteractionMode = "agent",
    readOffsets: Map<string, number> = new Map()
  ): Promise<{
    evidence: Array<{ path: string; content: string }>;
    toolResults: AdaptiveToolResult[];
  }> {
    const readOnlyTools = new Set<AdaptiveToolName>([
      "read_file",
      "search",
      "list_files",
      "get_diagnostics",
      "git_status",
      "git_diff"
    ]);
    const evidence: Array<{ path: string; content: string }> = [];
    const toolResults: AdaptiveToolResult[] = [];
    let pendingLimitExtension: Promise<boolean> | undefined;

    const reserveToolCall = async (): Promise<boolean> => {
      if (state.incrementToolCalls()) {
        return true;
      }
      if (state.stopReason !== "max_tool_calls" || !onLimitReached || !accessToken) {
        return false;
      }

      pendingLimitExtension ??= (async () => {
        const extension = await onLimitReached({
          reason: "max_tool_calls",
          currentLimit: state.maxToolCalls,
          currentToolLimit: state.maxToolCalls,
          currentAICallLimit: state.maxAICalls
        });
        if (!extension || extension.toolCalls <= 0 || extension.aiCalls <= 0) {
          return false;
        }
        await this.backend.increaseAgentTaskBudget(
          requestId,
          {
            toolCalls: extension.toolCalls,
            aiCalls: extension.aiCalls
          },
          accessToken,
          signal
        );
        const extended = state.extendLimits(extension.toolCalls, extension.aiCalls);
        if (extended) {
          this.emitProgress(
            onEvent,
            profile as AgentProfile,
            `Continuing investigation with ${state.maxAICalls} AI calls and ${state.maxToolCalls} tool calls.`
          );
        }
        return extended;
      })().finally(() => {
        pendingLimitExtension = undefined;
      });

      if (!await pendingLimitExtension) {
        return false;
      }
      return state.incrementToolCalls();
    };

    const executeOne = async (tool: AdaptiveToolRequest): Promise<void> => {
      const toolKey = this.createToolRequestKey(tool);
      if (!state.recordAIRequest(toolKey) || !await reserveToolCall()) {
        throw new Error(`Adaptive investigation stopped: ${state.stopReason}`);
      }
      try {
        this.emitProgress(
          onEvent,
          profile as AgentProfile,
          this.describeToolAction(tool)
        );
        const result = await this.executeAdaptiveTool(tool, workspaceUri, mode, readOffsets);
        evidence.push(...result.evidence);
        toolResults.push({
          tool: tool.tool,
          path: tool.path,
          success: result.success,
          approval: result.approval,
          reason: tool.reason,
          output: result.output,
          error: result.error
        });

        const resets = new Set([
          "edit_file", "write_file", "create_file", "delete_file",
          "rename_file", "move_file", "apply_change_set", "apply_patch",
          "get_diagnostics"
        ]);
        if (result.success && resets.has(tool.tool) && tool.path?.trim()) {
          state.clearPathInspectionKeys(tool.path.trim());
          readOffsets.delete(tool.path.trim());
        }
        if (
          result.success &&
          ["edit_file", "write_file", "create_file", "delete_file", "rename_file", "move_file", "apply_change_set", "apply_patch"].includes(tool.tool)
        ) {
          this.manifestCache = undefined;
          readOffsets.delete("m3-tools/workspace-files.txt");
        }
        const target = tool.targetPath ?? tool.target_path;
        if (result.success && (tool.tool === "rename_file" || tool.tool === "move_file") && target?.trim()) {
          state.clearPathInspectionKeys(target.trim());
          readOffsets.delete(target.trim());
        }
        if (onEvent && result.success && resets.has(tool.tool) && tool.tool !== "get_diagnostics") {
          onEvent({
            profile: profile as AgentEvent["profile"],
            type: "change",
            message: [
              "Changed `" + (tool.path || "file") + "`",
              result.output
            ].filter(Boolean).join("\n\n"),
            timestamp: Date.now()
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("not approved")) {
          throw error;
        }
        toolResults.push({
          tool: tool.tool,
          path: tool.path,
          success: false,
          reason: tool.reason,
          output: "",
          error: message
        });
        evidence.push({
          path: `m3-tools/${tool.tool}.txt`,
          content: `tool=${tool.tool}\nsuccess=false\n${message}`
        });
        this.logger.warn("Adaptive tool failed", error);
      }
    };

    const parallel = tools.filter(tool => readOnlyTools.has(tool.tool));
    const ordered = tools.filter(tool => !readOnlyTools.has(tool.tool));
    const workerCount = Math.min(ADAPTIVE_TOOL_CONCURRENCY, parallel.length);
    let nextParallelIndex = 0;
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextParallelIndex < parallel.length) {
          const tool = parallel[nextParallelIndex++];
          await executeOne(tool);
        }
      })
    );
    for (const tool of ordered) {
      await executeOne(tool);
    }
    return { evidence, toolResults };
  }

  private describeToolAction(tool: AdaptiveToolRequest): string {
    const target = tool.path || tool.targetPath || tool.target_path || "the workspace";
    switch (tool.tool) {
      case "read_file":
        return `Reading ${target}.`;
      case "search":
        return `Searching for ${tool.query || "relevant code"}.`;
      case "list_files":
        return "Listing workspace files.";
      case "edit_file":
      case "write_file":
      case "apply_patch":
      case "apply_change_set":
        return `Writing changes to ${target}.`;
      case "create_file":
        return `Creating ${target}.`;
      case "delete_file":
        return `Deleting ${target}.`;
      case "move_file":
      case "rename_file":
        return `Moving ${target}.`;
      case "run_command":
      case "run_task":
      case "run_tests":
        return `Running ${tool.command || tool.taskName || tool.task_name || "the requested command"}.`;
      case "get_diagnostics":
        return `Checking diagnostics for ${target}.`;
      case "git_diff":
        return "Checking the current diff.";
      case "git_status":
        return "Checking workspace status.";
      default:
        return `Performing ${tool.tool}.`;
    }
  }


  private async executeAdaptiveTool(
    tool:
      AdaptiveToolRequest,

    workspaceUri:
      vscode.Uri,

    mode:
      InteractionMode,

    readOffsets:
      Map<string, number>
  ): Promise<AdaptiveToolExecution> {
    flow("Agent.executeAdaptiveTool", 1, "enter", { tool: tool.tool });

    if (
      tool.tool ===
      "read_file"
    ) {

      const normalizedPath = this.normalizeRelativePath(tool.path!);
      const offset = Number.isInteger(tool.offset) && tool.offset! >= 0
        ? tool.offset!
        : readOffsets.get(normalizedPath) ?? 0;
      const read = normalizedPath === "m3-tools/workspace-files.txt"
        ? await this.executeAdaptiveManifestPage(workspaceUri, offset)
        : await this.executeAdaptiveReadFile(tool.path!, workspaceUri, offset);
      if (read.hasMore) {
        readOffsets.set(normalizedPath, read.nextOffset);
      } else {
        readOffsets.delete(normalizedPath);
      }
      const chunkStatus = read.hasMore
        ? `\n[read_file chunk offset=${offset} chars=${read.chars}; more content is available. Request read_file for this path again to continue.]`
        : `\n[read_file complete offset=${offset} chars=${read.chars}]`;
      const chunkOutput = read.evidence.map(item => item.content).filter(Boolean).join("\n\n");
      const availableOutputChars = Math.max(
        0,
        ADAPTIVE_MAX_TOOL_OUTPUT_CHARS - chunkStatus.length
      );
      return {
        evidence: read.evidence,
        success: true,
        output: chunkOutput.slice(0, availableOutputChars) + chunkStatus
      };
    }

    if (
      tool.tool ===
      "search"
    ) {

      const evidence = await this.executeAdaptiveSearch(
        tool.query!,
        workspaceUri
      );
      return {
        evidence,
        success: true,
        output: this.capAdaptiveOutput(evidence.map(item => item.content).filter(Boolean).join("\n\n"))
      };
    }

    if (
      tool.tool ===
      "list_files"
    ) {

      const manifestPath = "m3-tools/workspace-files.txt";
      const offset = readOffsets.get(manifestPath) ?? 0;
      const read = await this.executeAdaptiveManifestPage(workspaceUri, offset);
      if (read.hasMore) {
        readOffsets.set(manifestPath, read.nextOffset);
      } else {
        readOffsets.delete(manifestPath);
      }
      const chunkStatus = read.hasMore
        ? `\n[list_files page offset=${offset} chars=${read.chars}; more paths are available. Request list_files again to continue.]`
        : `\n[list_files complete offset=${offset} chars=${read.chars}]`;
      const availableOutputChars = Math.max(
        0,
        ADAPTIVE_MAX_TOOL_OUTPUT_CHARS - chunkStatus.length
      );
      const output = read.evidence.map(item => item.content).join("\n\n");
      return {
        evidence: read.evidence,
        success: true,
        output: output.slice(0, availableOutputChars) + chunkStatus
      };
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
      mode
    );

    const output = this.capAdaptiveOutput(result.output);
    return {
      evidence: [{
        path: `m3-tools/${tool.tool}.txt`,
        content: [
          `tool=${result.tool}`,
          `success=${result.success}`,
          result.approval ? `approval=${result.approval}` : "",
          output
        ].filter(Boolean).join("\n")
      }],
      success: result.success,
      output,
      approval: result.approval,
      error: result.success ? undefined : output
    };
  }

  private capAdaptiveOutput(output: string): string {
    if (output.length <= ADAPTIVE_MAX_TOOL_OUTPUT_CHARS) {
      return output;
    }
    const marker = "\n...[tool output truncated]...\n";
    return output.slice(0, ADAPTIVE_MAX_TOOL_OUTPUT_CHARS - marker.length) + marker;
  }


  // ==========================================================
  // LOCAL READ FILE
  // ==========================================================

  private async executeAdaptiveReadFile(
    relativePath:
      string,

    workspaceUri:
      vscode.Uri,

    offset:
      number
  ): Promise<{
    evidence: ContextFile[];
    nextOffset: number;
    chars: number;
    hasMore: boolean;
  }> {
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


      const safeOffset = Math.min(Math.max(0, offset), content.length);
      const chunk = content.slice(safeOffset, safeOffset + ADAPTIVE_MAX_FILE_CHARS);
      const nextOffset = safeOffset + chunk.length;


      this.logger.info(
        "Adaptive read_file completed",
        {
          path:
            normalizedPath,

          offset:
            safeOffset,

          hasMore:
            nextOffset < content.length,

          chars:
            chunk.length
        }
      );

      return {
        evidence: [{
          path: normalizedPath,
          content: chunk,
          chunkIndex: Math.floor(safeOffset / ADAPTIVE_MAX_FILE_CHARS) + 1,
          chunkCount: Math.ceil(content.length / ADAPTIVE_MAX_FILE_CHARS),
          byteStart: Buffer.byteLength(content.slice(0, safeOffset), "utf8"),
          byteEnd: Buffer.byteLength(content.slice(0, nextOffset), "utf8"),
          totalBytes: Buffer.byteLength(content, "utf8"),
          hasMore: nextOffset < content.length,
          startLine: content.slice(0, safeOffset).split("\n").length,
          endLine: content.slice(0, safeOffset).split("\n").length +
            chunk.split("\n").length -
            (chunk.endsWith("\n") ? 2 : 1)
        }],
        nextOffset,
        chars: chunk.length,
        hasMore: nextOffset < content.length
      };


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
    workspaceUri:
      vscode.Uri
  ): Promise<Array<{
    path: string;
    content: string;
  }>> {
    flow("Agent.executeAdaptiveSearch", 1, "enter", { query });

    const evidence: Array<{ path: string; content: string }> = [];
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceUri, "**/*"),
      "**/{node_modules,.git,dist,build,out,coverage}/**",
      ADAPTIVE_MAX_MANIFEST_FILES
    );
    const needle = query.toLowerCase();
    for (const uri of uris) {
      if (evidence.length >= ADAPTIVE_MAX_SEARCH_RESULTS) {
        break;
      }
      const path = this.normalizeRelativePath(
        vscode.workspace.asRelativePath(uri, false)
      );
      if (!path || this.isSensitivePath(path)) {
        continue;
      }
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > ADAPTIVE_MAX_SEARCH_FILE_BYTES) {
          continue;
        }
        const content = Buffer.from(
          await vscode.workspace.fs.readFile(uri)
        ).toString("utf8");
        const matchIndex = content.toLowerCase().indexOf(needle);
        if (matchIndex >= 0) {
          evidence.push({
            path,
            content: this.createSearchSnippet(content, matchIndex)
          });
        }
      } catch {
        // Ignore unreadable files and continue the requested search.
      }
    }


    this.logger.info(
      "Adaptive search completed",
      {
        query,

        results: evidence.length
      }
    );
    return evidence;
  }

  private createSearchSnippet(content: string, matchIndex: number): string {
    const snippetLimit = Math.min(8_000, ADAPTIVE_MAX_TOOL_OUTPUT_CHARS);
    const contextChars = Math.floor((snippetLimit - 80) / 2);
    const start = Math.max(0, matchIndex - contextChars);
    const end = Math.min(content.length, matchIndex + contextChars);
    const prefix = start > 0 ? "...[context before match omitted]...\n" : "";
    const suffix = end < content.length ? "\n...[context after match omitted]..." : "";
    return prefix + content.slice(start, end) + suffix;
  }


  // ==========================================================
  // LOCAL LIST FILES
  // ==========================================================

  private async executeAdaptiveManifestPage(
    workspaceUri:
      vscode.Uri
    ,
    offset:
      number
  ): Promise<{
    evidence: ContextFile[];
    nextOffset: number;
    chars: number;
    hasMore: boolean;
  }> {
    flow("Agent.executeAdaptiveManifestPage", 1, "enter", { offset });

    const workspaceKey = workspaceUri.toString();
    const now = Date.now();
    const cachedManifest = this.manifestCache?.workspaceKey === workspaceKey &&
      this.manifestCache.expiresAt > now
      ? this.manifestCache.content
      : undefined;
    let manifest = cachedManifest;
    let fileCount = 0;
    if (manifest === undefined) {
      const uris = await vscode.workspace.findFiles(
        "**/*",
        "**/{node_modules,.git,dist,build,out,coverage}/**",
        ADAPTIVE_MAX_MANIFEST_FILES
      );
      const paths = uris
        .map(uri => this.normalizeRelativePath(vscode.workspace.asRelativePath(uri, false)))
        .filter(path => Boolean(path) && !this.isSensitivePath(path));
      manifest = paths.join("\n");
      fileCount = paths.length;
      this.manifestCache = {
        workspaceKey,
        content: manifest,
        expiresAt: now + ADAPTIVE_MANIFEST_CACHE_TTL_MS
      };
    }
    const safeOffset = Math.min(Math.max(0, offset), manifest.length);
    const content = manifest.slice(
      safeOffset,
      safeOffset + ADAPTIVE_MANIFEST_PAGE_CHARS
    );
    const nextOffset = safeOffset + content.length;
    const hasMore = nextOffset < manifest.length;

    this.logger.info(
      "Adaptive manifest page completed",
      {
        files: fileCount,
        offset: safeOffset,
        chars: content.length,
        manifestChars: manifest.length,
        hasMore
      }
    );

    return {
      evidence: content
        ? [{
            path: "m3-tools/workspace-files.txt",
            content,
            chunkIndex: Math.floor(safeOffset / ADAPTIVE_MANIFEST_PAGE_CHARS) + 1,
            chunkCount: Math.ceil(manifest.length / ADAPTIVE_MANIFEST_PAGE_CHARS),
            byteStart: Buffer.byteLength(manifest.slice(0, safeOffset), "utf8"),
            byteEnd: Buffer.byteLength(manifest.slice(0, nextOffset), "utf8"),
            totalBytes: Buffer.byteLength(manifest, "utf8"),
            hasMore
          }]
        : [],
      nextOffset,
      chars: content.length,
      hasMore
    };
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

  private createLocalResponse(
    requestId: string,
    intent: Intent,
    answer: string,
    reason: string
  ): AIResponse {
    return {
      request_id: requestId,
      action: intent,
      answer,
      model: "local-intent-gate",
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        ai_api_calls: 0,
        estimated_cost: 0
      },
      decision: {
        action: "FINAL_ANSWER",
        answer,
        confidence: 1,
        reason
      }
    };
  }

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

  private getConfiguredImplementationRoot(): string | undefined {
    const configured = vscode.workspace
      .getConfiguration("mm3")
      .get<string>("implementationRoot", "");
    const normalized = this.normalizeRelativePath(configured);
    return normalized || undefined;
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

