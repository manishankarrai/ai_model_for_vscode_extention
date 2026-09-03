import * as vscode from "vscode";

import {
  AIRequest,
  AIResponse
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
    accessToken: string
  ): Promise<AIResponse> {

    return this.post<AIResponse>(
      "/api/v1/ai",
      request,
      accessToken
    );
  }

  async getUsage(
    accessToken: string
  ): Promise<UsageResponse> {

    return this.get<UsageResponse>(
      "/api/v1/usage",
      accessToken
    );
  }

  async health(): Promise<unknown> {

    return this.get<unknown>(
      "/api/v1/health"
    );
  }

  private async post<T>(
    endpoint: string,
    body: unknown,
    accessToken?: string
  ): Promise<T> {

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
          body: JSON.stringify(body)
        }
      );

    } catch (error) {

      throw new Error(
        `Unable to connect to M3 backend: ${
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
        `Unable to connect to M3 backend: ${
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