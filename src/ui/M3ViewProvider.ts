import * as vscode from "vscode";

import { Agent } from "../agent/Agent";
import { Logger } from "../utils/Logger";
import {
  AIResponse,
  AIUsage,
} from "../models/types";

export class M3ViewProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "m3.chat";

  private view?: vscode.WebviewView;

  private isProcessing = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly agent: Agent,
    private readonly logger: Logger,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,

      localResourceRoots: [
        this.extensionUri,
      ],
    };

    webviewView.webview.html =
      this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        try {
          await this.handleMessage(message);
        } catch (error) {
          this.logger.error(
            "Webview message handling failed",
            error
          );

          this.post({
            type: "error",
            error: "Something went wrong while processing your request.",
          });
        }
      },
      undefined
    );
  }

  show(): void {
    this.view?.show?.(true);
  }

  private async handleMessage(
    message: WebviewMessage
  ): Promise<void> {
    switch (message.type) {
      case "send_message":
        await this.handleQuestion(message.value);
        break;

      case "clear":
        this.agent.clearConversation();

        this.post({
          type: "cleared",
        });

        break;

      case "open_output":
        this.logger.show();
        break;

      default:
        break;
    }
  }

  private async handleQuestion(
    question: string
  ): Promise<void> {
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      return;
    }

    /*
     * Prevent multiple requests from being sent
     * while another request is running.
     */
    if (this.isProcessing) {
      this.post({
        type: "error",
        error: "M3 is already processing another request.",
      });

      return;
    }

    this.isProcessing = true;

    this.post({
      type: "thinking",
    });

    try {
      const accessToken =
        await this.getAccessToken();

      if (!accessToken) {
        throw new AuthenticationError(
          "M3 authentication required."
        );
      }

      const response: AIResponse =
        await this.agent.process(
          trimmedQuestion,
          accessToken
        );

      this.post({
        type: "answer",
        answer: response.answer,
        usage: response.usage,
        requestId: response.request_id,
        model: response.model,
      });
    } catch (error) {
      const message =
        this.getErrorMessage(error);

      this.post({
        type: "error",
        error: message,
      });

      this.logger.error(
        "M3 request failed",
        error
      );
    } finally {
      this.isProcessing = false;

      this.post({
        type: "ready",
      });
    }
  }

  private getErrorMessage(
    error: unknown
  ): string {
    if (error instanceof AuthenticationError) {
      return error.message;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return "An unexpected error occurred.";
  }

  private post(
    message: WebviewResponse
  ): void {
    if (!this.view) {
      return;
    }

    void this.view.webview.postMessage(
      message
    );
  }

  private getHtml(
    webview: vscode.Webview
  ): string {
    const nonce = this.getNonce();

    const cspSource =
      webview.cspSource;

    return `
<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  http-equiv="Content-Security-Policy"
  content="
    default-src 'none';
    style-src 'unsafe-inline' ${cspSource};
    script-src 'nonce-${nonce}';
  "
>

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>M3 AI Agent</title>

<style>

* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  height: 100%;

  margin: 0;
  padding: 0;
}

body {
  color:
    var(--vscode-foreground);

  background:
    var(--vscode-sideBar-background);

  font-family:
    var(--vscode-font-family);

  font-size:
    var(--vscode-font-size);

  overflow: hidden;
}

.container {
  display: flex;

  flex-direction: column;

  height: 100vh;
}

.header {
  display: flex;

  align-items: center;

  justify-content: space-between;

  padding: 10px 12px;

  border-bottom:
    1px solid
    var(--vscode-panel-border);

  font-weight: 600;

  user-select: none;
}

.header-title {
  display: flex;

  align-items: center;

  gap: 6px;
}

.messages {
  flex: 1;

  overflow-y: auto;

  padding: 12px;

  scroll-behavior: smooth;
}

.message {
  margin-bottom: 12px;

  padding: 10px 12px;

  border-radius: 8px;

  white-space: pre-wrap;

  word-break: break-word;

  line-height: 1.5;
}

.user {
  background:
    var(--vscode-textBlockQuote-background);

  border:
    1px solid
    var(--vscode-textBlockQuote-border);
}

.assistant {
  background:
    var(--vscode-editor-background);

  border:
    1px solid
    var(--vscode-panel-border);
}

.error {
  background:
    var(--vscode-inputValidation-errorBackground);

  color:
    var(--vscode-inputValidation-errorForeground);

  border:
    1px solid
    var(--vscode-inputValidation-errorBorder);
}

.thinking {
  opacity: 0.7;

  font-style: italic;
}

.usage {
  margin-top: -6px;

  margin-bottom: 12px;

  padding-left: 4px;

  font-size: 10px;

  opacity: 0.6;
}

.status {
  padding: 5px 10px;

  font-size: 11px;

  opacity: 0.7;

  min-height: 24px;
}

.composer {
  display: flex;

  align-items: flex-end;

  gap: 8px;

  padding: 10px;

  border-top:
    1px solid
    var(--vscode-panel-border);
}

textarea {
  flex: 1;

  resize: none;

  min-height: 42px;

  max-height: 150px;

  padding: 8px 10px;

  color:
    var(--vscode-input-foreground);

  background:
    var(--vscode-input-background);

  border:
    1px solid
    var(--vscode-input-border);

  border-radius: 5px;

  outline: none;

  font-family:
    var(--vscode-font-family);

  font-size:
    var(--vscode-font-size);

  line-height: 1.4;
}

textarea:focus {
  border-color:
    var(--vscode-focusBorder);
}

textarea:disabled {
  opacity: 0.6;

  cursor: not-allowed;
}

button {
  min-height: 42px;

  border: none;

  border-radius: 5px;

  padding: 8px 14px;

  color:
    var(--vscode-button-foreground);

  background:
    var(--vscode-button-background);

  cursor: pointer;

  font-family:
    var(--vscode-font-family);

  font-size:
    var(--vscode-font-size);
}

button:hover:not(:disabled) {
  background:
    var(--vscode-button-hoverBackground);
}

button:disabled {
  opacity: 0.5;

  cursor: not-allowed;
}

.empty {
  display: flex;

  align-items: center;

  justify-content: center;

  height: 100%;

  text-align: center;

  opacity: 0.5;

  padding: 20px;
}

.model {
  margin-left: auto;

  font-size: 10px;

  opacity: 0.5;

  font-weight: normal;
}

</style>

</head>

<body>

<div class="container">

  <div class="header">

    <div class="header-title">
      <span>M3 AI Agent</span>

      <span
        id="model"
        class="model"
      ></span>
    </div>

  </div>

  <div
    id="messages"
    class="messages"
  >

    <div
      id="empty"
      class="empty"
    >
      Ask M3 about your project.
    </div>

  </div>

  <div
    id="status"
    class="status"
  >
    Ready
  </div>

  <div class="composer">

    <textarea
      id="input"
      rows="1"
      placeholder="Ask M3 about your project..."
      aria-label="Ask M3"
    ></textarea>

    <button
      id="send"
      type="button"
    >
      Send
    </button>

  </div>

</div>

<script nonce="${nonce}">

const vscode =
  acquireVsCodeApi();

const input =
  document.getElementById("input");

const send =
  document.getElementById("send");

const messages =
  document.getElementById("messages");

const status =
  document.getElementById("status");

const model =
  document.getElementById("model");

const empty =
  document.getElementById("empty");

let processing = false;

function addMessage(text, type) {

  if (empty) {
    empty.remove();
  }

  const element =
    document.createElement("div");

  element.className =
    "message " + type;

  element.textContent =
    String(text ?? "");

  messages.appendChild(
    element
  );

  messages.scrollTop =
    messages.scrollHeight;
}

function addUsage(usage) {

  if (!usage) {
    return;
  }

  const element =
    document.createElement("div");

  element.className =
    "usage";

  const aiApiCalls =
    Number(usage.ai_api_calls ?? 0);

  const totalTokens =
    Number(usage.total_tokens ?? 0);

  const estimatedCost =
    Number(usage.estimated_cost ?? 0);

  element.textContent =
    "AI calls: " +
    aiApiCalls +
    " • Tokens: " +
    totalTokens +
    " • Cost: $" +
    estimatedCost.toFixed(6);

  messages.appendChild(
    element
  );

  messages.scrollTop =
    messages.scrollHeight;
}

function setStatus(text) {

  status.textContent =
    String(text ?? "");
}

function setProcessing(value) {

  processing = value;

  input.disabled =
    value;

  send.disabled =
    value;

  if (value) {
    send.textContent =
      "Working...";
  } else {
    send.textContent =
      "Send";
  }
}

function sendMessage() {

  if (processing) {
    return;
  }

  const value =
    input.value.trim();

  if (!value) {
    return;
  }

  addMessage(
    value,
    "user"
  );

  input.value = "";

  setProcessing(true);

  setStatus(
    "M3 is investigating..."
  );

  vscode.postMessage({
    type: "send_message",
    value: value
  });
}

send.addEventListener(
  "click",
  sendMessage
);

input.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {

      event.preventDefault();

      sendMessage();
    }
  }
);

window.addEventListener(
  "message",
  event => {

    const message =
      event.data;

    switch (message.type) {

      case "thinking":

        setProcessing(true);

        setStatus(
          "Analyzing project..."
        );

        break;

      case "answer":

        setProcessing(false);

        addMessage(
          message.answer,
          "assistant"
        );

        addUsage(
          message.usage
        );

        if (message.model) {
          model.textContent =
            message.model;
        }

        setStatus(
          "Ready"
        );

        input.focus();

        break;

      case "error":

        setProcessing(false);

        addMessage(
          message.error,
          "error"
        );

        setStatus(
          "Error"
        );

        input.focus();

        break;

      case "ready":

        setProcessing(false);

        if (
          status.textContent !== "Error"
        ) {
          setStatus("Ready");
        }

        break;

      case "cleared":

        messages.innerHTML = "";

        const newEmpty =
          document.createElement("div");

        newEmpty.id =
          "empty";

        newEmpty.className =
          "empty";

        newEmpty.textContent =
          "Ask M3 about your project.";

        messages.appendChild(
          newEmpty
        );

        setProcessing(false);

        setStatus(
          "Ready"
        );

        input.focus();

        break;
    }
  }
);

input.focus();

</script>

</body>

</html>
`;
  }

  private getNonce(): string {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    let result = "";

    for (let i = 0; i < 32; i++) {
      result +=
        chars.charAt(
          Math.floor(
            Math.random() * chars.length
          )
        );
    }

    return result;
  }
}

/* -------------------------------------------------------------------------- */
/* Webview message types                                                      */
/* -------------------------------------------------------------------------- */

type WebviewMessage =
  | {
      type: "send_message";
      value: string;
    }
  | {
      type: "clear";
    }
  | {
      type: "open_output";
    };

type WebviewResponse =
  | {
      type: "thinking";
    }
  | {
      type: "answer";
      answer: string;
      usage: AIUsage;
      requestId: string;
      model: string;
    }
  | {
      type: "error";
      error: string;
    }
  | {
      type: "ready";
    }
  | {
      type: "cleared";
    };

class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);

    this.name =
      "AuthenticationError";
  }
}