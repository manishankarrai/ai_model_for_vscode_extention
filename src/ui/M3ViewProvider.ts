import * as vscode from "vscode";

import { Agent } from "../agent/Agent";
import { Logger } from "../utils/Logger";

export class M3ViewProvider
  implements vscode.WebviewViewProvider {

  public static readonly viewType =
    "m3.chat";

  private view:
    vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri:
      vscode.Uri,

    private readonly agent:
      Agent,

    private readonly logger:
      Logger,

    private readonly getAccessToken:
      () => Promise<string>
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView
  ): void {

    this.view =
      webviewView;

    webviewView.webview.options = {
      enableScripts: true,

      localResourceRoots: [
        this.extensionUri
      ]
    };

    webviewView.webview.html =
      this.getHtml(
        webviewView.webview
      );

    webviewView.webview.onDidReceiveMessage(
      async message => {

        await this.handleMessage(
          message
        );
      }
    );
  }

  show(): void {

    if (this.view) {
      this.view.show?.(true);
    }
  }

  private async handleMessage(
    message: {
      type: string;
      value?: string;
    }
  ): Promise<void> {

    switch (message.type) {

      case "send_message":

        await this.handleQuestion(
          message.value ?? ""
        );

        break;

      case "clear":

        this.agent.clearConversation();

        this.post({
          type: "cleared"
        });

        break;

      case "open_output":

        this.logger.show();

        break;
    }
  }

  private async handleQuestion(
    question: string
  ): Promise<void> {

    if (!question.trim()) {
      return;
    }

    this.post({
      type: "thinking"
    });

    try {

      const accessToken =
        await this.getAccessToken();

      if (!accessToken) {

        throw new Error(
          "M3 authentication required."
        );
      }

      const response =
        await this.agent.process(
          question,
          accessToken
        );

      this.post({
        type: "answer",

        answer:
          response.answer,

        usage:
          response.usage,

        requestId:
          response.request_id
      });

    } catch (error) {

      this.post({
        type: "error",

        error:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  }

  private post(
    message: unknown
  ): void {

    this.view?.webview.postMessage(
      message
    );
  }

  private getHtml(
    webview: vscode.Webview
  ): string {

    const nonce =
      this.getNonce();

    return `
<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  http-equiv="Content-Security-Policy"
  content="
    default-src 'none';
    style-src 'unsafe-inline';
    script-src 'nonce-${nonce}';
  "
>

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<style>

:root {
  color-scheme: dark;
}

body {
  padding: 0;
  margin: 0;

  color:
    var(--vscode-foreground);

  background:
    var(--vscode-sideBar-background);

  font-family:
    var(--vscode-font-family);

  font-size:
    var(--vscode-font-size);
}

.container {
  display: flex;

  flex-direction: column;

  height: 100vh;
}

.header {
  padding: 12px;

  border-bottom:
    1px solid
    var(--vscode-panel-border);

  font-weight: 600;
}

.messages {
  flex: 1;

  overflow-y: auto;

  padding: 12px;
}

.message {
  margin-bottom: 12px;

  padding: 10px;

  border-radius: 8px;

  white-space: pre-wrap;

  line-height: 1.5;
}

.user {
  background:
    var(--vscode-textBlockQuote-background);
}

.assistant {
  background:
    var(--vscode-editor-background);
}

.error {
  background:
    var(--vscode-inputValidation-errorBackground);
}

.thinking {
  opacity: 0.7;
}

.composer {
  display: flex;

  padding: 10px;

  gap: 8px;

  border-top:
    1px solid
    var(--vscode-panel-border);
}

textarea {
  flex: 1;

  resize: none;

  min-height: 42px;

  max-height: 150px;

  padding: 8px;

  color:
    var(--vscode-input-foreground);

  background:
    var(--vscode-input-background);

  border:
    1px solid
    var(--vscode-input-border);

  border-radius: 5px;

  outline: none;
}

button {
  border: none;

  border-radius: 5px;

  padding: 8px 12px;

  color:
    var(--vscode-button-foreground);

  background:
    var(--vscode-button-background);

  cursor: pointer;
}

button:hover {
  background:
    var(--vscode-button-hoverBackground);
}

.status {
  padding: 5px 10px;

  font-size: 11px;

  opacity: 0.7;
}

.usage {
  margin-top: 8px;

  font-size: 10px;

  opacity: 0.6;
}

</style>

</head>

<body>

<div class="container">

  <div class="header">
    M3 AI Agent
  </div>

  <div
    id="messages"
    class="messages"
  ></div>

  <div
    id="status"
    class="status"
  >
    Ready
  </div>

  <div class="composer">

    <textarea
      id="input"
      placeholder="Ask M3 about your project..."
    ></textarea>

    <button id="send">
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

function addMessage(
  text,
  type
) {

  const element =
    document.createElement("div");

  element.className =
    "message " + type;

  element.textContent =
    text;

  messages.appendChild(
    element
  );

  messages.scrollTop =
    messages.scrollHeight;
}

function setStatus(
  text
) {

  status.textContent =
    text;
}

function sendMessage() {

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

  setStatus(
    "M3 is investigating..."
  );

  vscode.postMessage({
    type:
      "send_message",

    value
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

        setStatus(
          "Analyzing project..."
        );

        break;

      case "answer":

        addMessage(
          message.answer,
          "assistant"
        );

        if (message.usage) {

          const usage =
            document.createElement(
              "div"
            );

          usage.className =
            "usage";

          usage.textContent =
            "AI calls: " +
            message.usage.aiApiCalls +
            " • Tokens: " +
            message.usage.totalTokens +
            " • Cost: $" +
            Number(
              message.usage.estimatedCost
            ).toFixed(6);

          messages.appendChild(
            usage
          );
        }

        setStatus(
          "Ready"
        );

        break;

      case "error":

        addMessage(
          message.error,
          "error"
        );

        setStatus(
          "Error"
        );

        break;

      case "cleared":

        messages.innerHTML = "";

        setStatus(
          "Ready"
        );

        break;
    }
  }
);

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
            Math.random() *
            chars.length
          )
        );
    }

    return result;
  }
}