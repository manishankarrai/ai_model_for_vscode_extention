import * as vscode from "vscode";

import { flow } from "../utils/flowLog";

import {
  AIRequest,
  AIResponse,
  AgentEvent,
  AgentTaskStatus,
  BillingAgent,
  CreditPlan,
  WalletSummary
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

export class BackendClient {

  private readonly backendUrl: string;

  constructor() {
    flow("BackendClient.constructor", 1, "enter");
    this.backendUrl =
      vscode.workspace
        .getConfiguration("m3")
        .get<string>(
          "backendUrl",
          "http://localhost:8080"
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

  async sendAIRequest(
    request: AIRequest,
    accessToken: string,
    signal?: AbortSignal
  ): Promise<AIResponse> {
    flow("BackendClient.sendAIRequest", 1, "enter", { requestId: request.request_id, action: request.action });

    return this.post<AIResponse>(
      "/api/v1/ai",
      request,
      accessToken,
      signal
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

  async health(): Promise<unknown> {
    flow("BackendClient.health", 1, "enter");

    return this.get<unknown>(
      "/api/v1/health"
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
      throw new Error(`Unable to open agent event stream: ${response.status}`);
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

      throw new Error(
        `Unable to connect to M3 AI: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }

    const data =
      await this.parseResponse<T>(response);

    if (!response.ok) {

      const errorData =
        data as BackendErrorResponse;

      throw new Error(
        errorData.error ??
        errorData.message ??
        `Backend error: ${response.status}`
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

      throw new Error(
        `Unable to connect to M3 AI: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }

    const data =
      await this.parseResponse<T>(response);

    if (!response.ok) {

      const errorData =
        data as BackendErrorResponse;

      throw new Error(
        errorData.error ??
        errorData.message ??
        `Backend error: ${response.status}`
      );
    }

    return data;
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