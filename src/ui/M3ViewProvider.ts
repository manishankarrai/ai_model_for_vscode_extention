
import * as vscode from "vscode";

import { Agent } from "../agent/Agent";
import { Logger } from "../utils/Logger";
import {
  ContextPart,
  AIResponse,
  AIUsage,
  AgentProfile,
  AgentEvent,
  AgentRun,
  InteractionMode,
} from "../models/types";

import { CodeChangeApplier } from "../safety/CodeChangeApplier";
import { isSafeContextPath } from "../intelligence/contextSelection";
import { BackendClient } from "../backend/BackendClient";
import type { BillingAgent, CreditPlan, WalletSummary } from "../models/types";

export class M3ViewProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "m3.chat";

  private view?: vscode.WebviewView;

  private isProcessing = false;

  private selectedContext: ContextPart[] = [];

  private readonly codeChangeApplier =
    new CodeChangeApplier();

  private readonly billingClient =
    new BackendClient();

  private requestController?: AbortController;

  private lastQuestion?: {
    question: string;
    mode: InteractionMode;
    agentProfile: AgentProfile;
    agentCount: number;
  };

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

    void this.refreshBilling();

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
            error:
              "Something went wrong while processing your request.",
          });
        }
      },
      undefined
    );
  }

  show(): void {
    this.view?.show?.(true);
  }

  async rollbackLastChanges(): Promise<void> {
    await this.codeChangeApplier.rollbackLast();
  }

  private async refreshBilling(): Promise<void> {
    try {
      const accessToken = await this.getAccessToken();
      if (!accessToken) {
        return;
      }
      const [wallet, agents] = await Promise.all([
        this.billingClient.getWallet(accessToken),
        this.billingClient.getAgents(accessToken)
      ]);
      this.post({
        type: "billing",
        wallet,
        agents: agents.agents ?? [],
        plans: []
      });
    } catch (error) {
      this.logger.warn(
        `Unable to load billing: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleMessage(
    message: WebviewMessage
  ): Promise<void> {
    switch (message.type) {
      case "send_message":
        await this.handleQuestion(
          message.value,
          message.mode,
          message.agentProfile,
          1
        );
        break;

      case "cancel_request":
        this.requestController?.abort();
        break;

      case "retry_agent":
        await this.retryAgent(message.profile);
        break;

      case "retry_last":
        if (this.lastQuestion) {
          await this.handleQuestion(
            this.lastQuestion.question,
            this.lastQuestion.mode,
            this.lastQuestion.agentProfile,
            1
          );
        }
        break;

      case "attach_files":
        await this.attachFiles();
        break;

      case "remove_context":
        this.selectedContext = this.selectedContext.filter(
          (part) => part.path !== message.path
        );
        this.postContextParts();
        break;

      case "clear":
        this.agent.clearConversation();
        this.selectedContext = [];

        this.post({
          type: "cleared",
        });

        this.postContextParts();

        break;

      case "open_output":
        this.logger.show();
        break;

      case "open_citation":
        await this.openCitation(
          message.path,
          message.startLine,
          message.endLine
        );
        break;

      case "load_billing":
        await this.refreshBilling();
        break;

      default:
        break;
    }
  }

  private async handleQuestion(
    question: string,
    mode: InteractionMode,
    agentProfile: AgentProfile,
    agentCount: number
  ): Promise<void> {
    const trimmedQuestion =
      question.trim();

    if (!trimmedQuestion) {
      return;
    }

    if (this.isProcessing) {
      this.post({
        type: "error",
        error:
          "M3 is already processing another request.",
      });

      return;
    }

    this.isProcessing = true;
    this.requestController = new AbortController();
    this.lastQuestion = {
      question: trimmedQuestion,
      mode,
      agentProfile,
      agentCount
    };

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
          accessToken,
          await this.getRequestContext(),
          mode,
          agentProfile,
          agentCount,
          this.requestController.signal,
          (event: AgentEvent) => {
            this.post({
              type: "agent_event",
              event
            });
          }
        );

      this.post({
        type: "answer",
        answer: this.formatAnswer(response),
        usage: response.usage,
        requestId: response.request_id,
        model: response.model,
        agents: response.agents ?? [],
        citations: response.citations ?? [],
        quality: response.quality,
        confidence: typeof response.decision === "object"
          ? response.decision?.confidence
          : undefined,
        implementationPlan: response.implementation_plan
      });

      await this.refreshBilling();

      if (response.implementation_plan?.changes) {
        await this.codeChangeApplier.offer(
          response.implementation_plan.changes
        );
      }

    } catch (error) {

      if (error instanceof DOMException && error.name === "AbortError") {
        this.post({
          type: "cancelled"
        });
        return;
      }

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
      this.requestController = undefined;

      this.post({
        type: "ready",
      });
    }
  }

  private async retryAgent(
    profile: AgentProfile
  ): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      throw new AuthenticationError("M3 authentication required.");
    }

    this.isProcessing = true;
    this.post({ type: "thinking" });
    try {
      const answer = await this.agent.retrySpecialist(
        profile,
        accessToken
      );
      this.post({
        type: "answer",
        answer: "[Retry: " + profile + "]\n\n" + answer,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          ai_api_calls: 1,
          estimated_cost: 0
        },
        requestId: "retry",
        model: "",
        agents: []
      });
    } finally {
      this.isProcessing = false;
      this.post({ type: "ready" });
    }
  }

  private async getRequestContext(): Promise<ContextPart[]> {
    const parts = [...this.selectedContext];
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      return parts;
    }

    const relativePath = vscode.workspace.asRelativePath(
      editor.document.uri,
      false
    );

    if (!isSafeContextPath(relativePath)) {
      return parts;
    }

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    const content = selectedText || editor.document.getText();
    const duplicate = parts.some((part) => part.path === relativePath);

    if (!duplicate) {
      parts.unshift({
        kind: selectedText ? "selection" : "file",
        path: relativePath,
        content,
        language: editor.document.languageId,
        startLine: selection.start.line + 1,
        endLine: selection.end.line + 1
      });
    }

    this.postContextParts(parts);

    return parts;
  }

  private async attachFiles(): Promise<void> {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: false,
      openLabel: "Attach Files"
    });

    if (!files) {
      return;
    }

    for (const uri of files) {
      const relativePath = vscode.workspace.asRelativePath(uri, false);

      if (!isSafeContextPath(relativePath)) {
        continue;
      }

      const document = await vscode.workspace.openTextDocument(uri);

      if (document.getText().length > 200_000) {
        continue;
      }

      this.selectedContext = this.selectedContext.filter(
        (part) => part.path !== relativePath
      );
      this.selectedContext.push({
        kind: "attachment",
        path: relativePath,
        content: document.getText(),
        language: document.languageId
      });
    }

    this.postContextParts();
  }

  private postContextParts(
    parts: ContextPart[] = this.selectedContext
  ): void {
    this.post({
      type: "context",
      parts: parts.map((part) => ({
        path: part.path,
        kind: part.kind,
        language: part.language,
        size: part.content.length,
        tokens: Math.ceil(part.content.length / 4)
      }))
    });
  }

  private async openCitation(
    filePath: string,
    startLine?: number,
    endLine?: number
  ): Promise<void> {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace || !isSafeContextPath(filePath)) {
      return;
    }

    const uri = vscode.Uri.joinPath(
      workspace.uri,
      ...filePath.replace(/\\/g, "/").split("/")
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const start = Math.max(0, (startLine ?? 1) - 1);
    const end = Math.max(start, (endLine ?? startLine ?? 1) - 1);
    await vscode.window.showTextDocument(document, {
      selection: new vscode.Range(
        start,
        0,
        end,
        document.lineAt(Math.min(end, document.lineCount - 1)).text.length
      )
    });
  }

  private getErrorMessage(
    error: unknown
  ): string {

    if (
      error instanceof AuthenticationError
    ) {
      return error.message;
    }

    if (
      error instanceof Error
    ) {
      return error.message;
    }

    return "An unexpected error occurred.";
  }

  private formatAnswer(
    response: AIResponse
  ): string {
    return response.answer;
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

    const nonce =
      this.getNonce();

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

/* -------------------------------------------------------------------------- */
/* Header                                                                     */
/* -------------------------------------------------------------------------- */

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px 6px;
  font-weight: 600;
  user-select: none;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.credits {
  margin-left: auto;
  font-size: 11px;
  font-weight: 500;
  opacity: 0.75;
}

.model {
  display: none;
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                   */
/* -------------------------------------------------------------------------- */

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px 4px;
  scroll-behavior: smooth;
}

.message {
  margin-bottom: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  word-break: break-word;
  line-height: 1.45;
  font-size: 12.5px;
}

.user {
  background:
    var(--vscode-textBlockQuote-background);

  border:
    1px solid
    var(--vscode-textBlockQuote-border);

  white-space: pre-wrap;
}

.assistant {
  background:
    var(--vscode-editor-background);

  border:
    1px solid
    var(--vscode-panel-border);

  white-space: normal;
}

.error {
  background:
    var(--vscode-inputValidation-errorBackground);

  color:
    var(--vscode-inputValidation-errorForeground);

  border:
    1px solid
    var(--vscode-inputValidation-errorBorder);

  white-space: pre-wrap;
}

/* -------------------------------------------------------------------------- */
/* Markdown                                                                   */
/* -------------------------------------------------------------------------- */

.markdown {
  width: 100%;
}

.markdown p {
  margin:
    0 0 10px 0;
}

.markdown p:last-child {
  margin-bottom: 0;
}

.markdown h1,
.markdown h2,
.markdown h3,
.markdown h4 {
  margin-top: 16px;

  margin-bottom: 8px;

  line-height: 1.3;
}

.markdown h1 {
  font-size: 1.35em;
}

.markdown h2 {
  font-size: 1.2em;
}

.markdown h3 {
  font-size: 1.08em;
}

.markdown h4 {
  font-size: 1em;
}

.markdown strong {
  font-weight: 700;
}

.markdown em {
  font-style: italic;
}

.markdown code.inline-code {
  padding:
    2px 5px;

  border-radius: 4px;

  background:
    var(--vscode-textCodeBlock-background);

  color:
    var(--vscode-textPreformat-foreground);

  font-family:
    var(--vscode-editor-font-family);

  font-size: 0.9em;
}

.markdown ul,
.markdown ol {
  margin-top: 6px;

  margin-bottom: 10px;

  padding-left: 24px;
}

.markdown li {
  margin-bottom: 4px;
}

.markdown hr {
  border: none;

  border-top:
    1px solid
    var(--vscode-panel-border);

  margin:
    14px 0;
}

/* -------------------------------------------------------------------------- */
/* Code blocks                                                                */
/* -------------------------------------------------------------------------- */

.code-block {
  margin:
    12px 0;

  border:
    1px solid
    var(--vscode-panel-border);

  border-radius: 6px;

  overflow: hidden;

  background:
    var(--vscode-textCodeBlock-background);
}

.code-header {
  display: flex;

  align-items: center;

  justify-content: space-between;

  min-height: 30px;

  padding:
    4px 8px;

  border-bottom:
    1px solid
    var(--vscode-panel-border);

  background:
    var(--vscode-editorGroupHeader-tabsBackground);

  font-size: 11px;

  opacity: 0.9;
}

.code-language {
  font-family:
    var(--vscode-editor-font-family);

  text-transform: lowercase;

  opacity: 0.8;
}

.copy-button {
  min-height: 24px;

  padding:
    3px 8px;

  border:
    1px solid
    var(--vscode-button-border);

  border-radius: 4px;

  color:
    var(--vscode-button-secondaryForeground);

  background:
    var(--vscode-button-secondaryBackground);

  cursor: pointer;

  font-size: 11px;
}

.copy-button:hover {
  background:
    var(--vscode-button-secondaryHoverBackground);
}

.code-content {
  display: block;

  margin: 0;

  padding: 10px 12px;

  overflow-x: auto;

  white-space: pre;

  font-family:
    var(--vscode-editor-font-family);

  font-size:
    var(--vscode-editor-font-size);

  line-height: 1.45;

  color:
    var(--vscode-editor-foreground);
}

.code-content code {
  font-family:
    inherit;
}

/* -------------------------------------------------------------------------- */
/* Usage                                                                      */
/* -------------------------------------------------------------------------- */

.usage {
  margin-top: -6px;

  margin-bottom: 12px;

  padding-left: 4px;

  font-size: 10px;

  opacity: 0.6;
}

.billing-bar {
  display: none;
}

.status {
  display: none;
}

.quality-summary {
  margin: 0 0 12px;
  padding: 8px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  background: var(--vscode-editor-background);
  font-size: 11px;
  line-height: 1.6;
}

.quality-summary strong {
  font-weight: 600;
}

.citation-list {
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}

.citation-item {
  margin-bottom: 8px;
  padding: 8px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  background: var(--vscode-textBlockQuote-background);
  font-size: 11px;
  line-height: 1.5;
}

.citation-path {
  display: block;
  font-weight: 600;
  margin-bottom: 4px;
  cursor: pointer;
  color: var(--vscode-textLink-foreground);
  text-decoration: underline;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  text-align: left;
}

.citation-reason,
.citation-lines {
  display: block;
  opacity: 0.8;
}

.citation-quote {
  margin-top: 6px;
  padding: 8px;
  border-left: 2px solid var(--vscode-textLink-foreground);
  font-family: var(--vscode-editor-font-family);
  white-space: pre-wrap;
}

.review-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 0 12px;
}

.confidence-meter {
  margin: 0 0 12px;
  font-size: 11px;
}

.confidence-bar {
  height: 6px;
  margin-top: 4px;
  border-radius: 99px;
  background: var(--vscode-editorWidget-border);
  overflow: hidden;
}

.confidence-bar span {
  display: block;
  height: 100%;
  background: var(--vscode-progressBar-background);
}

.validation-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.validation-check {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}

.validation-check::before {
  content: "✓";
  opacity: 0.8;
}

.diff-preview {
  margin: 0 0 10px;
  padding: 8px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  white-space: pre-wrap;
  overflow: auto;
}

.diff-removed {
  color: var(--vscode-errorForeground);
}

.diff-added {
  color: var(--vscode-gitDecoration-addedResourceForeground);
}

.detail-panel {
  margin: 0 0 12px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  background: var(--vscode-editor-background);
  overflow: hidden;
}

.detail-panel summary {
  padding: 8px 10px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  list-style: none;
}

.detail-panel summary::-webkit-details-marker {
  display: none;
}

.detail-body {
  padding: 0 10px 10px;
  font-size: 11px;
  line-height: 1.6;
}

.detail-body ul,
.detail-body ol {
  margin: 0;
  padding-left: 18px;
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

.status {
  display: none;
}

/* -------------------------------------------------------------------------- */
/* Composer                                                                   */
/* -------------------------------------------------------------------------- */

.composer {
  padding: 8px 10px 10px;
}

.composer-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--vscode-input-border);
  border-radius: 12px;
  background: var(--vscode-input-background);
}

.composer-box:focus-within {
  border-color: var(--vscode-focusBorder);
}

textarea {
  flex: 1;
  resize: none;
  min-height: 36px;
  max-height: 120px;
  padding: 4px 6px;
  color: var(--vscode-input-foreground);
  background: transparent;
  border: none;
  border-radius: 0;
  outline: none;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  line-height: 1.4;
}

textarea:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.composer-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
}

.composer-toolbar select {
  max-width: 110px;
  height: 26px;
  padding: 0 6px;
  border: none;
  border-radius: 6px;
  color: var(--vscode-foreground);
  background: transparent;
  font-size: 11px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  border: none;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  color: var(--vscode-foreground);
  background: transparent;
  cursor: pointer;
}

.icon-btn.primary {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
}

.icon-btn:hover:not(:disabled) {
  background: var(--vscode-toolbar-hoverBackground);
}

.icon-btn.primary:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

.icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.composer-toolbar .spacer {
  flex: 1;
}

.context-parts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 12px 6px;
  font-size: 11px;
}

.context-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}

.context-chip button {
  width: 16px;
  height: 16px;
  min-height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

.empty {
  display: flex;

  align-items: center;

  justify-content: center;

  height: 100%;

  text-align: center;

  opacity: 0.5;

  padding: 20px;
}

</style>

</head>

<body>

<div class="container">

  <div class="header">

    <div class="header-title">

      <span>M3</span>
      <span id="wallet-balance" class="credits">0 credits</span>
      <span id="model" class="model"></span>

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
      Ask about your project
    </div>

  </div>

  <div
    id="status"
    class="status"
  >
    Ready
  </div>

  <div class="composer">
    <div class="composer-box">
      <textarea
        id="input"
        rows="1"
        placeholder="Ask M3"
        aria-label="Ask M3"
      ></textarea>
      <div class="composer-toolbar">
        <button id="attach" class="icon-btn" type="button" title="Attach files">📎</button>
        <select id="mode" aria-label="Mode">
          <option value="ask">Ask</option>
          <option value="agent">Agent</option>
        </select>
        <select id="agent-profile" aria-label="Agent">
          <option value="">Agents</option>
        </select>
        <span class="spacer"></span>
        <button id="action" class="icon-btn primary" type="button" title="Send">↑</button>
      </div>
    </div>
  </div>

</div>

<script nonce="${nonce}">

const vscode =
  acquireVsCodeApi();

const input =
  document.getElementById("input");

const action =
  document.getElementById("action");

const mode =
  document.getElementById("mode");

const agentProfile =
  document.getElementById("agent-profile");

const attach =
  document.getElementById("attach");

const messages =
  document.getElementById("messages");

const status =
  document.getElementById("status");

const model =
  document.getElementById("model");

const empty =
  document.getElementById("empty");

const walletBalance =
  document.getElementById("wallet-balance");

let processing = false;
let composerState = "idle";

const contextParts = [];

function renderContextParts() {
  let container = document.getElementById("context-parts");

  if (!container) {
    container = document.createElement("div");
    container.id = "context-parts";
    container.className = "context-parts";
    document.querySelector(".composer").before(container);
  }

  container.textContent = "";

  if (contextParts.length === 0) {
    return;
  }

  const label = document.createElement("span");
  label.textContent = "Context";
  container.appendChild(label);

  contextParts.forEach((part) => {
    const chip = document.createElement("span");
    chip.className = "context-chip";
    chip.textContent = part.kind + " " + part.path +
      " (" + part.tokens + " tokens)";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "x";
    remove.title = "Remove " + part.path;
    remove.addEventListener("click", () => {
      vscode.postMessage({
        type: "remove_context",
        path: part.path
      });
    });

    chip.appendChild(remove);
    container.appendChild(chip);
  });
}

attach.addEventListener("click", () => {
  vscode.postMessage({ type: "attach_files" });
});

/* -------------------------------------------------------------------------- */
/* HTML escaping                                                              */
/* -------------------------------------------------------------------------- */

function escapeHtml(value) {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* -------------------------------------------------------------------------- */
/* Inline Markdown                                                            */
/* -------------------------------------------------------------------------- */

function renderInlineMarkdown(text) {

  let value =
    escapeHtml(text);

  const inlineCodes = [];

  value =
    value.replace(
      /\`([^\`]+)\`/g,
      (_, code) => {

        const index =
          inlineCodes.length;

        inlineCodes.push(
          '<code class="inline-code">' +
          code +
          '</code>'
        );

        return (
          "___M3_INLINE_CODE_" +
          index +
          "___"
        );
      }
    );

  value =
    value.replace(
      /\\*\\*([^*]+)\\*\\*/g,
      "<strong>$1</strong>"
    );

  value =
    value.replace(
      /\\*([^*]+)\\*/g,
      "<em>$1</em>"
    );

  value =
    value.replace(
      /___M3_INLINE_CODE_(\\d+)___/g,
      (_, index) =>
        inlineCodes[
          Number(index)
        ]
    );

  return value;
}

/* -------------------------------------------------------------------------- */
/* Markdown renderer                                                          */
/* -------------------------------------------------------------------------- */

function renderMarkdown(markdown) {

  const text =
    String(markdown ?? "")
      .replace(/\\r\\n/g, "\\n")
      .replace(/\\r/g, "\\n");

  const codeBlocks = [];

  const withoutCode =
    text.replace(
      /\`\`\`([a-zA-Z0-9_+#.-]*)\\n([\\s\\S]*?)\`\`\`/g,
      (_, language, code) => {

        const index =
          codeBlocks.length;

        codeBlocks.push({
          language:
            language || "code",

          code:
            code.replace(/\\n$/, "")
        });

        return (
          "\\n___M3_CODE_BLOCK_" +
          index +
          "___\\n"
        );
      }
    );

  const lines =
    withoutCode.split("\\n");

  const output = [];

  let paragraph = [];

  let listType = null;

  function flushParagraph() {

    if (
      paragraph.length === 0
    ) {
      return;
    }

    const content =
      paragraph
        .join("\\n")
        .trim();

    if (content) {

      output.push(
        "<p>" +
        renderInlineMarkdown(
          content
        ).replace(/\\n/g, "<br>") +
        "</p>"
      );
    }

    paragraph = [];
  }

  function closeList() {

    if (!listType) {
      return;
    }

    output.push(
      "</" +
      listType +
      ">"
    );

    listType = null;
  }

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {

    const line =
      lines[i];

    const trimmed =
      line.trim();

    if (!trimmed) {

      flushParagraph();

      closeList();

      continue;
    }

    const codeMatch =
      trimmed.match(
        /^___M3_CODE_BLOCK_(\\d+)___$/
      );

    if (codeMatch) {

      flushParagraph();

      closeList();

      const codeBlock =
        codeBlocks[
          Number(codeMatch[1])
        ];

      if (codeBlock) {

        output.push(
          createCodeBlock(
            codeBlock.language,
            codeBlock.code
          )
        );
      }

      continue;
    }

    const headingMatch =
      line.match(
        /^\\s*(#{1,4})\\s+(.+?)\\s*$/
      );

    if (headingMatch) {

      flushParagraph();

      closeList();

      const level =
        headingMatch[1].length;

      output.push(
        "<h" +
        level +
        ">" +
        renderInlineMarkdown(
          headingMatch[2]
        ) +
        "</h" +
        level +
        ">"
      );

      continue;
    }

    if (
      /^\\s*(---+|\\*\\*\\*+)\\s*$/.test(line)
    ) {

      flushParagraph();

      closeList();

      output.push(
        "<hr>"
      );

      continue;
    }

    const unorderedMatch =
      line.match(
        /^\\s*[-*]\\s+(.+)$/
      );

    if (unorderedMatch) {

      flushParagraph();

      if (listType !== "ul") {

        closeList();

        output.push("<ul>");

        listType = "ul";
      }

      output.push(
        "<li>" +
        renderInlineMarkdown(
          unorderedMatch[1]
        ) +
        "</li>"
      );

      continue;
    }

    const orderedMatch =
      line.match(
        /^\\s*\\d+[.)]\\s+(.+)$/
      );

    if (orderedMatch) {

      flushParagraph();

      if (listType !== "ol") {

        closeList();

        output.push("<ol>");

        listType = "ol";
      }

      output.push(
        "<li>" +
        renderInlineMarkdown(
          orderedMatch[1]
        ) +
        "</li>"
      );

      continue;
    }

    closeList();

    paragraph.push(line);
  }

  flushParagraph();

  closeList();

  return output.join("");
}

/* -------------------------------------------------------------------------- */
/* Code block                                                                 */
/* -------------------------------------------------------------------------- */

function createCodeBlock(
  language,
  code
) {

  const wrapper =
    document.createElement("div");

  wrapper.className =
    "code-block";

  const header =
    document.createElement("div");

  header.className =
    "code-header";

  const languageElement =
    document.createElement("span");

  languageElement.className =
    "code-language";

  languageElement.textContent =
    language || "code";

  const copyButton =
    document.createElement("button");

  copyButton.className =
    "copy-button";

  copyButton.type =
    "button";

  copyButton.textContent =
    "Copy";

  copyButton.addEventListener(
    "click",
    async () => {

      try {

        await copyText(code);

        copyButton.textContent =
          "Copied";

        setTimeout(
          () => {
            copyButton.textContent =
              "Copy";
          },
          1500
        );

      } catch {

        copyButton.textContent =
          "Copy failed";

        setTimeout(
          () => {
            copyButton.textContent =
              "Copy";
          },
          1500
        );
      }
    }
  );

  header.appendChild(
    languageElement
  );

  header.appendChild(
    copyButton
  );

  const pre =
    document.createElement("pre");

  pre.className =
    "code-content";

  const codeElement =
    document.createElement("code");

  codeElement.textContent =
    code;

  pre.appendChild(
    codeElement
  );

  wrapper.appendChild(
    header
  );

  wrapper.appendChild(
    pre
  );

  return wrapper.outerHTML;
}

/* -------------------------------------------------------------------------- */
/* Copy code                                                                  */
/* -------------------------------------------------------------------------- */

async function copyText(text) {

  if (
    navigator.clipboard &&
    navigator.clipboard.writeText
  ) {

    await navigator.clipboard.writeText(
      text
    );

    return;
  }

  const textarea =
    document.createElement("textarea");

  textarea.value =
    text;

  textarea.style.position =
    "fixed";

  textarea.style.opacity =
    "0";

  document.body.appendChild(
    textarea
  );

  textarea.focus();

  textarea.select();

  const successful =
    document.execCommand(
      "copy"
    );

  textarea.remove();

  if (!successful) {

    throw new Error(
      "Copy failed"
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Add message                                                                */
/* -------------------------------------------------------------------------- */

function addMessage(
  text,
  type
) {

  if (empty) {
    empty.remove();
  }

  const element =
    document.createElement("div");

  element.className =
    "message " + type;

  if (
    type === "assistant"
  ) {

    const markdown =
      document.createElement("div");

    markdown.className =
      "markdown";

    markdown.innerHTML =
      renderMarkdown(
        String(text ?? "")
      );

    element.appendChild(
      markdown
    );

  } else {

    element.textContent =
      String(text ?? "");
  }

  messages.appendChild(
    element
  );

  messages.scrollTop =
    messages.scrollHeight;
}

function addAgentRetryControls(agents) {
  const failed = (agents || []).filter((agent) => agent.status === "failed");

  if (failed.length === 0) {
    return;
  }

  const element = document.createElement("div");
  element.className = "agent-retries";
  element.textContent = "Retry specialist:";

  failed.forEach((agent) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = agent.profile;
    button.addEventListener("click", () => {
      vscode.postMessage({
        type: "retry_agent",
        profile: agent.profile
      });
    });
    element.appendChild(button);
  });

  messages.appendChild(element);
  messages.scrollTop = messages.scrollHeight;
}

/* -------------------------------------------------------------------------- */
/* Usage                                                                      */
/* -------------------------------------------------------------------------- */

function addUsage(
  usage
) {

  if (!usage) {
    return;
  }

  const element =
    document.createElement("div");

  element.className =
    "usage";

  const aiApiCalls =
    Number(
      usage.ai_api_calls ?? 0
    );

  const totalTokens =
    Number(
      usage.total_tokens ?? 0
    );

  element.textContent =
    "AI calls: " +
    aiApiCalls +
    " • Tokens: " +
    totalTokens +
    " • Credits: " +
    Number(usage.charged_credits ?? 0).toFixed(4) +
    " • Wallet: " +
    Number(usage.wallet_balance ?? 0).toFixed(2);

  messages.appendChild(
    element
  );

  messages.scrollTop =
    messages.scrollHeight;
}

function addQualitySummary(quality) {
  if (!quality) {
    return;
  }

  const element = document.createElement("div");
  element.className = "quality-summary";
  element.innerHTML = [
    "<strong>Quality</strong>",
    " • groundedness=" + Number(quality.groundedness ?? 0).toFixed(3),
    " • file_selection=" + Number(quality.file_selection ?? 0).toFixed(3),
    " • tool_efficiency=" + Number(quality.tool_efficiency ?? 0).toFixed(3),
    " • answer_quality=" + Number(quality.answer_quality ?? 0).toFixed(3),
    " • recovery=" + Number(quality.recovery_score ?? 1).toFixed(3),
    " • latency=" + Number(quality.latency_ms ?? 0) + "ms"
  ].join("");

  messages.appendChild(element);
  messages.scrollTop = messages.scrollHeight;
}

function addConfidence(confidence) {
  if (confidence === undefined || confidence === null) {
    return;
  }

  const value = Math.max(0, Math.min(1, Number(confidence)));
  const element = document.createElement("div");
  element.className = "confidence-meter";
  element.innerHTML =
    "<strong>Confidence</strong> " + value.toFixed(2) +
    '<div class="confidence-bar"><span style="width:' + (value * 100) + '%"></span></div>';
  messages.appendChild(element);
}

function addCitationList(citations) {
  if (!citations || citations.length === 0) {
    return;
  }

  const stack = document.createElement("div");
  stack.className = "review-stack";
  const heading = document.createElement("strong");
  heading.textContent = "Evidence";
  stack.appendChild(heading);

  citations.forEach((citation) => {
    const item = document.createElement("details");
    item.className = "citation-item";
    item.open = true;

    const summary = document.createElement("summary");
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "citation-path";
    openButton.textContent = citation.path || "unknown";
    openButton.addEventListener("click", (event) => {
      event.preventDefault();
      vscode.postMessage({
        type: "open_citation",
        path: citation.path,
        startLine: citation.start_line,
        endLine: citation.end_line
      });
    });
    summary.appendChild(openButton);
    item.appendChild(summary);

    if (citation.start_line || citation.end_line) {
      const lines = document.createElement("span");
      lines.className = "citation-lines";
      lines.textContent = "lines " + (citation.start_line || "?") + "-" + (citation.end_line || citation.start_line || "?");
      item.appendChild(lines);
    }

    if (citation.reason) {
      const reason = document.createElement("span");
      reason.className = "citation-reason";
      reason.textContent = citation.reason;
      item.appendChild(reason);
    }

    if (citation.quote) {
      const quote = document.createElement("pre");
      quote.className = "citation-quote";
      quote.textContent = citation.quote;
      item.appendChild(quote);
    }

    stack.appendChild(item);
  });

  messages.appendChild(stack);
  messages.scrollTop = messages.scrollHeight;
}

function addValidationChecks(items) {
  if (!items || items.length === 0) {
    return;
  }

  const panel = document.createElement("div");
  panel.className = "detail-panel";
  const details = document.createElement("details");
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = "Validation";
  const body = document.createElement("div");
  body.className = "detail-body";
  const list = document.createElement("ul");
  list.className = "validation-list";
  items.forEach((item) => {
    const entry = document.createElement("li");
    entry.className = "validation-check";
    entry.textContent = item;
    list.appendChild(entry);
  });
  body.appendChild(list);
  details.appendChild(summary);
  details.appendChild(body);
  panel.appendChild(details);
  messages.appendChild(panel);
}

function previewDiff(original, updated) {
  const left = String(original ?? "").split("\\n");
  const right = String(updated ?? "").split("\\n");
  const max = Math.max(left.length, right.length);
  const lines = [];
  for (let index = 0; index < max; index++) {
    const a = left[index];
    const b = right[index];
    if (a === b) {
      if (a !== undefined) {
        lines.push({ type: "context", text: a });
      }
    } else {
      if (a !== undefined) {
        lines.push({ type: "removed", text: a });
      }
      if (b !== undefined) {
        lines.push({ type: "added", text: b });
      }
    }
  }
  return lines;
}

function addDiffPreviews(changes) {
  if (!changes || changes.length === 0) {
    return;
  }

  const panel = document.createElement("div");
  panel.className = "detail-panel";
  const details = document.createElement("details");
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = "Proposed diffs";
  const body = document.createElement("div");
  body.className = "detail-body";

  changes.forEach((change) => {
    const heading = document.createElement("div");
    heading.textContent = change.path || "file";
    body.appendChild(heading);
    const preview = document.createElement("pre");
    preview.className = "diff-preview";
    previewDiff(change.original, change.updated).forEach((line) => {
      const row = document.createElement("div");
      row.className = line.type === "removed"
        ? "diff-removed"
        : line.type === "added"
          ? "diff-added"
          : "";
      row.textContent = (line.type === "removed" ? "- " : line.type === "added" ? "+ " : "  ") + line.text;
      preview.appendChild(row);
    });
    body.appendChild(preview);
  });

  details.appendChild(summary);
  details.appendChild(body);
  panel.appendChild(details);
  messages.appendChild(panel);
}

function addExpandableList(title, items) {
  if (!items || items.length === 0) {
    return;
  }

  const panel = document.createElement("div");
  panel.className = "detail-panel";

  const summary = document.createElement("details");
  summary.open = true;
  const summaryHeader = document.createElement("summary");
  summaryHeader.textContent = title;

  const body = document.createElement("div");
  body.className = "detail-body";

  const list = document.createElement("ul");
  items.forEach((item) => {
    const entry = document.createElement("li");
    entry.textContent = item;
    list.appendChild(entry);
  });
  body.appendChild(list);
  summary.appendChild(summaryHeader);
  summary.appendChild(body);
  panel.appendChild(summary);
  messages.appendChild(panel);
  messages.scrollTop = messages.scrollHeight;
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

function setStatus(
  text
) {

  status.textContent =
    String(text ?? "");
}

/* -------------------------------------------------------------------------- */
/* Processing                                                                 */
/* -------------------------------------------------------------------------- */

function setComposerState(next) {
  composerState = next;
  processing = next === "running";
  input.disabled = next === "running";
  if (next === "running") {
    action.textContent = "■";
    action.title = "Stop";
    return;
  }
  if (next === "failed") {
    action.textContent = "↻";
    action.title = "Retry";
    return;
  }
  action.textContent = "↑";
  action.title = "Send";
}

function setProcessing(value) {
  setComposerState(value ? "running" : "idle");
}

/* -------------------------------------------------------------------------- */
/* Send message                                                               */
/* -------------------------------------------------------------------------- */

function sendMessage() {
  if (processing) {
    return;
  }
  if (!agentProfile.value) {
    addMessage("Choose an agent from the list.", "error");
    return;
  }
  const value = input.value.trim();
  if (!value) {
    return;
  }
  addMessage(value, "user");
  input.value = "";
  setComposerState("running");
  vscode.postMessage({
    type: "send_message",
    value: value,
    mode: mode.value,
    agentProfile: agentProfile.value,
    agentCount: 1
  });
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

action.addEventListener("click", () => {
  if (composerState === "running") {
    vscode.postMessage({ type: "cancel_request" });
    return;
  }
  if (composerState === "failed") {
    vscode.postMessage({ type: "retry_last" });
    return;
  }
  sendMessage();
});

vscode.postMessage({ type: "load_billing" });

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

    switch (
      message.type
    ) {

      case "thinking":

        setProcessing(
          true
        );

        setStatus(
          "Analyzing project..."
        );

        break;

      case "answer":

        setProcessing(
          false
        );

        addMessage(
          message.answer,
          "assistant"
        );

        addConfidence(
          message.confidence
        );

        addQualitySummary(
          message.quality
        );

        addCitationList(
          message.citations
        );

        if (message.implementationPlan) {
          addExpandableList(
            "Files",
            message.implementationPlan.files || []
          );

          addExpandableList(
            "Implementation Steps",
            message.implementationPlan.steps || []
          );

          addValidationChecks(
            message.implementationPlan.validation || []
          );

          addExpandableList(
            "Risks and Assumptions",
            message.implementationPlan.risks || []
          );

          addDiffPreviews(
            message.implementationPlan.changes || []
          );
        }

        addAgentRetryControls(message.agents);

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

      case "context":
        contextParts.length = 0;
        contextParts.push(...message.parts);
        renderContextParts();
        break;

      case "agent_event":
        if (message.event.type === "token" && message.event.delta) {
          let assistantMessage = messages.querySelector(".message.assistant:last-child");
          if (!assistantMessage || assistantMessage.dataset.stream !== "true") {
            assistantMessage = document.createElement("div");
            assistantMessage.className = "message assistant";
            assistantMessage.dataset.stream = "true";
            const markdown = document.createElement("div");
            markdown.className = "markdown";
            assistantMessage.appendChild(markdown);
            messages.appendChild(assistantMessage);
          }

          const markdown = assistantMessage.querySelector(".markdown");
          if (markdown) {
            markdown.innerHTML = renderMarkdown((markdown.textContent || "") + message.event.delta);
          }
          messages.scrollTop = messages.scrollHeight;
          break;
        }

        if (message.event.type === "citation" && message.event.path) {
          addCitationList([{
            path: message.event.path,
            quote: message.event.quote,
            reason: message.event.message,
            start_line: message.event.start_line,
            end_line: message.event.end_line
          }]);
          break;
        }

        if (message.event.type === "quality") {
          addMessage(
            "[quality] groundedness=" + Number(message.event.confidence ?? 0).toFixed(3),
            "assistant"
          );
          break;
        }

        addMessage(
          "[" + message.event.profile + "] " + message.event.message,
          "assistant"
        );
        break;

      case "error":
        setComposerState("failed");
        addMessage(message.error, "error");
        input.focus();
        break;

      case "billing":
        if (walletBalance) {
          walletBalance.textContent =
            Number(message.wallet?.balance ?? 0).toFixed(2) + " credits";
        }
        if (agentProfile && Array.isArray(message.agents)) {
          const selected = agentProfile.value;
          agentProfile.innerHTML = "";
          if (message.agents.length === 0) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "No agents";
            agentProfile.appendChild(option);
          } else {
            message.agents.forEach((agent) => {
              const option = document.createElement("option");
              option.value = agent.id;
              option.textContent = agent.name;
              agentProfile.appendChild(option);
            });
            if ([...agentProfile.options].some((item) => item.value === selected)) {
              agentProfile.value = selected;
            }
          }
        }
        break;

      case "cancelled":
        setComposerState("idle");
        break;

      case "ready":
        if (composerState === "running") {
          setComposerState("idle");
        }
        break;

      case "cleared":

        messages.innerHTML =
          "";

        const newEmpty =
          document.createElement(
            "div"
          );

        newEmpty.id =
          "empty";

        newEmpty.className =
          "empty";

        newEmpty.textContent =
          "Ask M3 about your project.";

        messages.appendChild(
          newEmpty
        );

        setProcessing(
          false
        );

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

    let result =
      "";

    for (
      let i = 0;
      i < 32;
      i++
    ) {

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
      mode: "ask" | "agent";
      agentProfile: AgentProfile;
      agentCount: number;
    }
  | {
      type: "cancel_request";
    }
  | {
      type: "retry_last";
    }
  | {
      type: "retry_agent";
      profile: AgentProfile;
    }
  | {
      type: "attach_files";
    }
  | {
      type: "remove_context";
      path: string;
    }
  | {
      type: "clear";
    }
  | {
      type: "open_output";
    }
  | {
      type: "open_citation";
      path: string;
      startLine?: number;
      endLine?: number;
    }
  | {
      type: "load_billing";
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
      agents: AgentRun[];
      citations?: Array<{
        path: string;
        quote?: string;
        reason?: string;
        start_line?: number;
        end_line?: number;
      }>;
      quality?: {
        groundedness: number;
        file_selection: number;
        tool_efficiency: number;
        answer_quality: number;
        latency_ms: number;
        fallback_used: boolean;
        fallback_model?: string;
        cited_files: number;
        context_files: number;
        recovery_score?: number;
      };
      confidence?: number;
      implementationPlan?: {
        files?: string[];
        steps?: string[];
        validation?: string[];
        risks?: string[];
        changes?: Array<{
          path: string;
          original: string;
          updated: string;
        }>;
      };
    }
  | {
      type: "context";
      parts: Array<{
        path: string;
        kind: string;
        language: string;
        size: number;
        tokens: number;
      }>;
    }
  | {
      type: "cancelled";
    }
  | {
      type: "agent_event";
      event: AgentEvent;
    }
  | {
      type: "error";
      error: string;
    }
  | {
      type: "ready";
    }
  | {
      type: "billing";
      wallet: WalletSummary;
      agents: BillingAgent[];
      plans: CreditPlan[];
    }
  | {
      type: "cleared";
    };

class AuthenticationError extends Error {

  constructor(
    message: string
  ) {

    super(message);
    this.name =
      "AuthenticationError";
  }
}

