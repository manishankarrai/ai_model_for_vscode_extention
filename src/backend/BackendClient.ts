import * as vscode from "vscode";

import {
  AIRequest,
  AIResponse
} from "../models/types";

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
  ): Promise<unknown> {

    return this.post(
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
  ): Promise<unknown> {

    return this.post(
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

    return this.post(
      "/api/v1/ai",
      request,
      accessToken
    ) as Promise<AIResponse>;
  }

  async getUsage(
    accessToken: string
  ): Promise<unknown> {

    return this.get(
      "/api/v1/usage",
      accessToken
    );
  }

  async health(): Promise<unknown> {

    return this.get(
      "/api/v1/health"
    );
  }

  private async post(
    endpoint: string,
    body: unknown,
    accessToken?: string
  ): Promise<unknown> {

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (accessToken) {
      headers.Authorization =
        `Bearer ${accessToken}`;
    }

    const response =
      await fetch(
        `${this.backendUrl}${endpoint}`,
        {
          method: "POST",

          headers,

          body: JSON.stringify(body)
        }
      );

    const data =
      await response.json();

    if (!response.ok) {

      throw new Error(
        data?.error ??
        `Backend error: ${response.status}`
      );
    }

    return data;
  }

  private async get(
    endpoint: string,
    accessToken?: string
  ): Promise<unknown> {

    const headers: Record<string, string> = {};

    if (accessToken) {

      headers.Authorization =
        `Bearer ${accessToken}`;
    }

    const response =
      await fetch(
        `${this.backendUrl}${endpoint}`,
        {
          method: "GET",
          headers
        }
      );

    const data =
      await response.json();

    if (!response.ok) {

      throw new Error(
        data?.error ??
        `Backend error: ${response.status}`
      );
    }

    return data;
  }
}