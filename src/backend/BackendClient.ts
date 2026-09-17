import * as vscode from "vscode";

import { flow } from "../utils/flowLog";
import { formatConnectError, formatUserFacingError } from "./userFacingError";

import {
  AIRequest,
  AIResponse,
  AgentEvent,
  AgentRun,
  AgentTaskStatus,
  BillingAgent,
  CreditPlan,
  WalletSummary,
  AgentSelection,
  AIContext,
  Intent,
  InteractionMode,
  ProjectContext,
  ToolPolicy,
  ToolResult,
  AgentToolName
} from "../models/types";

interface BackendErrorResponse {
  error?: string;
  message?: string;
}

export interface AuthResponse {
  access_token?: string;
  refresh_token?: string;
  token?: string;
  user?: {
    id?: string;
    email?: string;
    [key: string]: unknown;
  };
}

export interface UsageResponse {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  estimated_cost?: number;
  ai_api_calls?: number;
  [key: string]: unknown;
}

export interface AgentTaskToolRequest {
  tool: AgentToolName;
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
  reason?: string;
  changes?: Array<{ path: string; original: string; updated: string }>;
}

export interface AgentTaskPendingDecision {
  action: "FINAL_ANSWER" | "CONTINUE_INVESTIGATION";
  answer?: string;
  confidence: number;
  reason?: string;
  tool?: AgentTaskToolRequest;
  tools?: AgentTaskToolRequest[];
}

export interface AgentTaskRecord {
  id?: string;
  request_id: string;
  project_key: string;
  question: string;
  action: Intent;
  mode: InteractionMode;
  project: ProjectContext;
  agent?: AgentSelection;
  tool_policy?: ToolPolicy;
  status: string;
  phase?: string;
  current_step?: number;
  plan?: string[];
  summary?: string;
  agents?: AgentRun[];
  events?: AgentEvent[];
  pending_decision?: AgentTaskPendingDecision;
  budget?: {
    max_steps: number;
    max_ai_calls: number;
    max_tool_calls: number;
    max_files: number;
    max_context_chars: number;
  };
  answer?: string;
  tool_runs?: Array<{
    id?: string;
    request_id: string;
    step: number;
    tool: string;
    path?: string;
    success: boolean;
    output?: string;
    error?: string;
    created_at: string;
  }>;
}

export interface CreateAgentTaskRequest {
  request_id: string;
  action?: Intent;
  question: string;
  mode: InteractionMode;
  project: ProjectContext;
  agent?: AgentSelection;
  tool_policy?: ToolPolicy;
  plan?: string[];
}

export interface AgentTaskStateResponse {
  task: AgentTaskRecord;
  tool_runs: AgentTaskRecord["tool_runs"];
  evidence: Array<{
    kind: string;
    path: string;
    step: number;
    chars: number;
    updated_at: string;
  }>;
}

export interface AgentTaskSummary {
  request_id: string;
  question: string;
  action: Intent;
  mode: InteractionMode;
  status: string;
  phase?: string;
  current_step?: number;
  summary?: string;
  updated_at: string;
}

export interface AgentTaskEvidenceRecord {
  id?: string;
  request_id: string;
  kind: "file" | "selection" | "attachment";
  path: string;
  content: string;
  language?: string;
  start_line?: number;
  end_line?: number;
  step: number;
  chars: number;
  updated_at: string;
}

export interface AgentTaskDecisionRequest {
  context: AIContext;
  tool_results?: ToolResult[];
  step?: number;
}

export class BackendClient {

  private readonly backendUrl: string;

  constructor() {
    flow("BackendClient.constructor", 1, "enter");
    this.backendUrl =
      vscode.workspace
        .getConfiguration("mm3")
        .get<string>(
          "backendUrl",
          "https://api.mm3ai.com"
        )
        .replace(/\/$/, "");
  }

  async login(
    email: string,
    password: string
  ): Promise<AuthResponse> {
    flow("BackendClient.login", 1, "enter");

    return this.post<AuthResponse>(
      "/api/v1/auth/login",
      {
        email,
        password
      }
    );
  }

  async register(
    email: string,
    password: string
  ): Promise<AuthResponse> {
    flow("BackendClient.register", 1, "enter");

    return this.post<AuthResponse>(
      "/api/v1/auth/register",
      {
        email,
        password
      }
    );
  }

  async createAgentTask(
    request: CreateAgentTaskRequest,
    accessToken: string,
    signal?: AbortSignal
  ): Promise<AgentTaskRecord> {
    flow("BackendClient.createAgentTask", 1, "enter", { requestId: request.request_id });
    return this.post<AgentTaskRecord>(
      "/api/v1/agent/tasks",
      request,
      accessToken,
      signal
    );
  }

  async decideAgentTask(
    requestId: string,
    request: AgentTaskDecisionRequest,
    accessToken: string,
    signal?: AbortSignal
  ): Promise<AIResponse> {
    flow("BackendClient.decideAgentTask", 1, "enter", { requestId, step: request.step });
    return this.post<AIResponse>(
      `/api/v1/agent/tasks/${encodeURIComponent(requestId)}/decide`,
      request,
      accessToken,
      signal
    );
  }

  async getAgentTaskState(
    requestId: string,
    accessToken: string
  ): Promise<AgentTaskStateResponse> {
    flow("BackendClient.getAgentTaskState", 1, "enter", { requestId });
    return this.get<AgentTaskStateResponse>(
      `/api/v1/agent/tasks/${encodeURIComponent(requestId)}`,
      accessToken
    );
  }

  async increaseAgentTaskBudget(
    requestId: string,
    budget: { toolCalls?: number; aiCalls?: number },
    accessToken: string,
    signal?: AbortSignal
  ): Promise<AgentTaskRecord> {
    flow("BackendClient.increaseAgentTaskBudget", 1, "enter", { requestId, budget });
    return this.post<AgentTaskRecord>(
      `/api/v1/agent/tasks/${encodeURIComponent(requestId)}/budget`,
      { tool_calls: budget.toolCalls, ai_calls: budget.aiCalls },
      accessToken,
      signal
    );
  }

  async listAgentTasks(
    accessToken: string,
    limit = 20
  ): Promise<{ tasks: AgentTaskSummary[] }> {
    flow("BackendClient.listAgentTasks", 1, "enter", { limit });
    return this.get<{ tasks: AgentTaskSummary[] }>(
      `/api/v1/agent/tasks?limit=${Math.max(1, Math.min(limit, 50))}`,
      accessToken
    );
  }

  async getAgentTaskEvidence(
    requestId: string,
    path: string,
    accessToken: string,
    kind: AgentTaskEvidenceRecord["kind"] = "file"
  ): Promise<AgentTaskEvidenceRecord> {
    flow("BackendClient.getAgentTaskEvidence", 1, "enter", { requestId, path, kind });
    const query = new URLSearchParams({ path, kind });
    return this.get<AgentTaskEvidenceRecord>(
      `/api/v1/agent/tasks/${encodeURIComponent(requestId)}/evidence?${query.toString()}`,
      accessToken
    );
  }

  async getUsage(
    accessToken: string
  ): Promise<UsageResponse> {
    flow("BackendClient.getUsage", 1, "enter");

    return this.get<UsageResponse>(
      "/api/v1/usage",
      accessToken
    );
  }

  async getWallet(
    accessToken: string
  ): Promise<WalletSummary> {
    flow("BackendClient.getWallet", 1, "enter");
    return this.get<WalletSummary>("/api/v1/wallet", accessToken);
  }

  async getAgents(
    accessToken: string
  ): Promise<{ agents: BillingAgent[] }> {
    flow("BackendClient.getAgents", 1, "enter");
    return this.get<{ agents: BillingAgent[] }>("/api/v1/agents", accessToken);
  }

  async getPlans(
    accessToken: string
  ): Promise<{ plans: CreditPlan[] }> {
    flow("BackendClient.getPlans", 1, "enter");
    return this.get<{ plans: CreditPlan[] }>("/api/v1/plans", accessToken);
  }

  async createOrder(
    planId: string,
    accessToken: string
  ): Promise<{ wallet_balance?: number; credits?: number; id?: string }> {
    flow("BackendClient.createOrder", 1, "enter", { planId });
    return this.post(
      "/api/v1/orders",
      { plan_id: planId },
      accessToken
    );
  }

  async getAgentTask(
    requestId: string,
    accessToken: string
  ): Promise<AgentTaskStatus> {
    flow("BackendClient.getAgentTask", 1, "enter", { requestId });
    return this.get<AgentTaskStatus>(
      `/api/v1/ai/tasks/${encodeURIComponent(requestId)}`,
      accessToken
    );
  }

  async retryAgent(
    request: AIRequest,
    requestId: string,
    profile: string,
    accessToken: string,
    signal?: AbortSignal
  ): Promise<unknown> {
    flow("BackendClient.retryAgent", 1, "enter", { requestId, profile });
    return this.post<unknown>(
      `/api/v1/ai/tasks/${encodeURIComponent(requestId)}/retry?profile=${encodeURIComponent(profile)}`,
      request,
      accessToken,
      signal
    );
  }
  // responsible for calling api in agent mode
  async streamAgentEvents(
    requestId: string,
    accessToken: string,
    onEvent: (event: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    flow("BackendClient.streamAgentEvents", 1, "enter", { requestId });
    const response = await fetch(
      `${this.backendUrl}/api/v1/ai/events?request_id=${encodeURIComponent(requestId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal
      }
    );

    if (!response.ok || !response.body) {
      throw this.toBackendError(
        response.status,
        `Unable to open agent event stream (${response.status}).`
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (data) {
            // data is send furthur 
            onEvent(JSON.parse(data.slice(6)) as AgentEvent);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async post<T>(
    endpoint: string,
    body: unknown,
    accessToken?: string,
    signal?: AbortSignal
  ): Promise<T> {
    flow("BackendClient.post", 2, "http post", { endpoint });

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (accessToken) {
      headers.Authorization =
        `Bearer ${accessToken}`;
    }

    let response: Response;

    try {

      response = await fetch(
        `${this.backendUrl}${endpoint}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal
        }
      );

    } catch (error) {
      throw formatConnectError(error);
    }

    const data =
      await this.parseResponse<T>(response);

    if (!response.ok) {
      throw this.toBackendError(
        response.status,
        (data as BackendErrorResponse).error ??
          (data as BackendErrorResponse).message
      );
    }

    return data;
  }

  private async get<T>(
    endpoint: string,
    accessToken?: string
  ): Promise<T> {
    flow("BackendClient.get", 1, "http get", { endpoint });

    const headers: Record<string, string> = {};

    if (accessToken) {
      headers.Authorization =
        `Bearer ${accessToken}`;
    }

    let response: Response;

    try {

      response = await fetch(
        `${this.backendUrl}${endpoint}`,
        {
          method: "GET",
          headers
        }
      );

    } catch (error) {
      throw formatConnectError(error);
    }

    const data =
      await this.parseResponse<T>(response);

    if (!response.ok) {
      throw this.toBackendError(
        response.status,
        (data as BackendErrorResponse).error ??
          (data as BackendErrorResponse).message
      );
    }

    return data;
  }

  private toBackendError(status: number, detail?: string): Error {
    if (status === 401 || status === 403) {
      return new Error(formatUserFacingError("auth"));
    }
    return new Error(
      formatUserFacingError(
        "api",
        detail?.trim() || `The MM3 API returned an error (${status}).`
      )
    );
  }

  private async parseResponse<T>(
    response: Response
  ): Promise<T> {
    flow("BackendClient.parseResponse", 1, "enter", { status: response.status });

    const contentType =
      response.headers.get("content-type") ?? "";

    if (!contentType.includes("application/json")) {

      const text =
        await response.text();

      return {
        message:
          text ||
          response.statusText
      } as T;
    }

    try {

      const data: unknown =
        await response.json();

      return data as T;

    } catch {

      return {
        message:
          response.statusText ||
          "Invalid response from backend"
      } as T;
    }
  }
}