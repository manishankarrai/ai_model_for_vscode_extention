
import * as vscode from "vscode";

import { flow } from "../utils/flowLog";

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
import {
  classifyErrorMessage,
  formatUserFacingError,
  MM3_CRM_URL,
  MM3_SUPPORT_EMAIL,
  userFacingErrorHelp,
  type UserFacingErrorHelp
} from "../backend/userFacingError";
import type { BillingAgent, CreditPlan, WalletSummary } from "../models/types";

export class MM3ViewProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "mm3.chat";

  private view?: vscode.WebviewView;

  private isProcessing = false;

  private selectedContext: ContextPart[] = [];
  private readonly dismissedContextKeys = new Set<string>();
  private readonly contextStorageKey = "mm3.context.parts.v1";

  private readonly billingClient =
    new BackendClient();

  private requestController?: AbortController;

  private lastQuestion?: {
    question: string;
    mode: InteractionMode;
    agentProfile: AgentProfile;
  };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly agent: Agent,
    private readonly logger: Logger,
    private readonly getAccessToken: () => Promise<string>,
    private readonly resetAccessToken: () => Promise<string>,
    private readonly codeChangeApplier = new CodeChangeApplier(),
    private readonly storage?: vscode.Memento
  ) {
    flow("MM3ViewProvider.constructor", 1, "enter");
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView
  ): void {
    flow("MM3ViewProvider.resolveWebviewView", 1, "enter");
    this.view = webviewView;
    this.selectedContext = this.loadPersistedContext();

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
            error: formatUserFacingError(
              "unexpected",
              "Something went wrong while processing your request."
            ),
            help: userFacingErrorHelp("unexpected")
          });
        }
      },
      undefined
    );
  }

  show(): void {
    flow("MM3ViewProvider.show", 1, "enter");
    this.view?.show?.(true);
  }

  async rollbackLastChanges(): Promise<void> {
    flow("MM3ViewProvider.rollbackLastChanges", 1, "enter");
    await this.codeChangeApplier.rollbackLast();
    this.clearFileReviews();
  }

  private async refreshBilling(silent = false): Promise<void> {
    flow("MM3ViewProvider.refreshBilling", 1, "enter", { silent });
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
      if (!silent) {
        this.postError(error);
      }
    }
  }
 // handle message
  private async handleMessage(
    message: WebviewMessage
  ): Promise<void> {
    flow("MM3ViewProvider.handleMessage", 1, "enter", { type: message.type });
    switch (message.type) {
      case "send_message":
        await this.handleQuestion(
          message.value,
          message.mode,
          message.agentProfile
        );
        break;

      case "cancel_request":
        this.agent.cancelCurrentTask();
        this.requestController?.abort();
        break;

      case "retry_agent":
        await this.retryAgent(message.profile);
        break;

      case "retry_last":
        {
          const task = this.agent.getPersistedTaskState();
          if (task.question && (task.status === "failed" || task.status === "cancelled")) {
            await this.restoreTaskContext(task.contract, task.checkpointContext);
            await this.handleQuestion(
              task.question,
              task.mode,
              task.agentProfile,
              {
                step: task.lastStep,
                validation: task.validation
              }
            );
          } else if (this.lastQuestion) {
          await this.handleQuestion(
            this.lastQuestion.question,
            this.lastQuestion.mode,
            this.lastQuestion.agentProfile
          );
          }
        }
        break;

      case "attach_files":
        await this.attachFiles();
        break;

      case "attach_dropped_files":
        await this.attachDroppedFiles(message.paths);
        break;

      case "add_selection":
        await this.attachCurrentSelection();
        break;

      case "remove_context":
        this.dismissedContextKeys.add(contextPartKey({
          path: message.path,
          kind: message.kind,
          startLine: message.startLine,
          endLine: message.endLine
        }));
        this.selectedContext = this.selectedContext.filter((part) => {
          if (message.kind || message.startLine) {
            return contextPartKey(part) !== contextPartKey({
              path: message.path,
              kind: message.kind,
              startLine: message.startLine,
              endLine: message.endLine
            });
          }
          return part.path !== message.path;
        });
        await this.persistContext();
        this.postContextParts();
        break;

      case "reset_token":
        await this.resetAccessToken();
        await this.refreshBilling();
        vscode.window.showInformationMessage("MM3 access token updated.");
        break;

      case "clear":
        this.agent.clearConversation();
        this.selectedContext = [];
        await this.persistContext();
        this.dismissedContextKeys.clear();
        this.clearFileReviews();

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
      case "task_feedback":
        await this.submitTaskFeedback(
          message.requestId,
          message.rating
        );
        break;

      case "open_external":
        await vscode.env.openExternal(vscode.Uri.parse(message.url));
        break;

      case "review_accept":
        await this.codeChangeApplier.acceptFile(message.path);
        this.postFileReviewRemoved(message.path);
        break;

      case "review_accept_all":
        await this.codeChangeApplier.acceptAll();
        this.post({ type: "file_reviews_cleared" });
        break;

      case "review_reject":
        try {
          await this.codeChangeApplier.rejectFile(message.path);
          this.postFileReviewRemoved(message.path);
        } catch (error) {
          this.postError(error);
        }
        break;

      case "review_open_diff":
        await this.codeChangeApplier.showFileDiff(message.path);
        break;

      case "review_apply_hunks":
        await this.codeChangeApplier.applyApprovedHunks(
          message.path,
          message.hunkIds
        );
        this.postPendingFileReviews();
        break;

      default:
        break;
    }
  }
  private async submitTaskFeedback(
    requestId: string,
    rating: number
  ): Promise<void> {
    try {
      const accessToken = await this.getAccessToken();
      if (!accessToken || !requestId.trim()) {
        return;
      }
      await this.billingClient.submitTaskFeedback(
        requestId,
        { rating },
        accessToken
      );
    } catch (error) {
      this.logger.warn(
        `Unable to record task feedback: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // handle questions
  private async handleQuestion(
    question: string,
    mode: InteractionMode,
    agentProfile: AgentProfile,
    resumeCheckpoint?: { step?: number; validation?: string[] }
  ): Promise<void> {
    flow("MM3ViewProvider.handleQuestion", 1, "enter", { mode, agentProfile });
    const trimmedQuestion =
      question.trim();

    if (!trimmedQuestion) {
      return;
    }

    if (this.isProcessing) {
      this.postError("MM3 is already processing another request.");
      return;
    }

    this.clearFileReviews();
    this.isProcessing = true;
    this.requestController = new AbortController();
    this.lastQuestion = {
      question: trimmedQuestion,
      mode,
      agentProfile
    };

    this.post({
      type: "thinking",
    });

    try {
      const accessToken =
        await this.getAccessToken();

      if (!accessToken) {
        throw new AuthenticationError(
          formatUserFacingError(
            "auth",
            "MM3 authentication is required."
          )
        );
      }

      const response: AIResponse =
        await this.agent.process(
          trimmedQuestion,
          accessToken,
          await this.getRequestContext(),
          mode,
          agentProfile,
          this.requestController.signal,
          (event: AgentEvent) => {
            this.post({
              type: "agent_event",
              event: {
                ...event,
                message:
                  event.type === "failed"
                    ? this.sanitizeUserError(event.message)
                    : event.message
              }
            });
          },
          resumeCheckpoint
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
        checkpoints: this.agent.getPersistedTaskState().checkpoints ?? [],
        confidence: typeof response.decision === "object"
          ? response.decision?.confidence
          : undefined,
        implementationPlan: response.implementation_plan
      });

      await this.refreshBilling(true);

      if (response.implementation_plan?.changes?.length) {
        try {
          await this.codeChangeApplier.offer(
            response.implementation_plan.changes,
            undefined,
            this.agent.getLastTaskContract()
          );
        } catch (applyError) {
          this.logger.error("MM3 failed to apply planned file changes", applyError);
          this.postError(applyError);
        }
      }

      this.postPendingFileReviews();

    } catch (error) {

      if (error instanceof DOMException && error.name === "AbortError") {
        this.post({
          type: "cancelled"
        });
        return;
      }

      this.postError(error);
      this.logger.error(
        "MM3 request failed",
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
    flow("MM3ViewProvider.retryAgent", 1, "enter", { profile });
    if (this.isProcessing) {
      return;
    }

    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      throw new AuthenticationError(
        formatUserFacingError("auth", "MM3 authentication is required.")
      );
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
    flow("MM3ViewProvider.getRequestContext", 1, "enter");
    return this.selectedContext.filter(
      (part) => !this.dismissedContextKeys.has(contextPartKey(part))
    );
  }

  private loadPersistedContext(): ContextPart[] {
    return (this.storage?.get<ContextPart[]>(this.contextStorageKey) ?? [])
      .filter((part) => isSafeContextPath(part.path))
      .slice(-20);
  }

  private async persistContext(): Promise<void> {
    if (!this.storage) {
      return;
    }
    await this.storage.update(
      this.contextStorageKey,
      this.selectedContext.slice(-20).map((part) => ({
        ...part,
        content: part.content.slice(0, 200_000)
      }))
    );
  }

  private async restoreTaskContext(
    contract: ReturnType<Agent["getPersistedTaskState"]>["contract"],
    checkpointContext: ReturnType<Agent["getPersistedTaskState"]>["checkpointContext"] = []
  ): Promise<void> {
    if (!contract && checkpointContext.length === 0) {
      return;
    }

    const restored: ContextPart[] = [];
    for (const path of contract?.selectedPaths ?? []) {
      if (!isSafeContextPath(path)) {
        continue;
      }
      try {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
          return;
        }
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.joinPath(workspace.uri, ...path.split("/"))
        );
        const range = contract?.selectedRanges.find((candidate) => candidate.path === path);
        if (range?.startLine && range.endLine) {
          const start = Math.max(0, range.startLine - 1);
          const end = Math.min(document.lineCount - 1, range.endLine - 1);
          const selection = new vscode.Range(
            start,
            0,
            end,
            document.lineAt(end).text.length
          );
          restored.push({
            kind: "selection",
            path,
            content: document.getText(selection),
            language: document.languageId,
            startLine: range.startLine,
            endLine: range.endLine
          });
        } else {
          restored.push({
            kind: "attachment",
            path,
            content: document.getText(),
            language: document.languageId
          });
        }
      } catch (error) {
        this.logger.warn(`Unable to restore task context for ${path}: ${String(error)}`);
      }
    }
    this.selectedContext = restored;
    const restoredPaths = new Set(restored.map((part) => part.path));
    for (const file of checkpointContext) {
      if (!isSafeContextPath(file.path) || restoredPaths.has(file.path)) {
        continue;
      }
      restored.push({
        kind: "attachment",
        path: file.path,
        content: file.content,
        language: ""
      });
      restoredPaths.add(file.path);
    }
    this.selectedContext = restored;
    this.postContextParts();
  }

  private async attachFiles(): Promise<void> {
    flow("MM3ViewProvider.attachFiles", 1, "enter");
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
      this.dismissedContextKeys.delete(contextPartKey({
        kind: "attachment",
        path: relativePath
      }));
      this.selectedContext.push({
        kind: "attachment",
        path: relativePath,
        content: document.getText(),
        language: document.languageId
      });
    }

    await this.persistContext();
    this.postContextParts();
  }

  private async attachDroppedFiles(paths: string[]): Promise<void> {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      return;
    }

    for (const path of paths.slice(0, 20)) {
      const relativePath = path.replace(/\\/g, "/").replace(/^\.?\//, "");
      if (!isSafeContextPath(relativePath)) {
        continue;
      }
      try {
        const uri = vscode.Uri.joinPath(workspace.uri, ...relativePath.split("/"));
        const document = await vscode.workspace.openTextDocument(uri);
        if (document.getText().length > 200_000) {
          continue;
        }
        this.selectedContext = this.selectedContext.filter((part) => part.path !== relativePath);
        this.selectedContext.push({
          kind: "attachment",
          path: relativePath,
          content: document.getText(),
          language: document.languageId
        });
      } catch (error) {
        this.logger.warn(`Unable to attach dropped file ${relativePath}: ${String(error)}`);
      }
    }

    await this.persistContext();
    this.postContextParts();
  }

  async attachCurrentSelection(): Promise<void> {
    flow("MM3ViewProvider.attachCurrentSelection", 1, "enter");
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      vscode.window.showInformationMessage("Select code first, then add it to MM3 chat.");
      return;
    }

    const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false);
    if (!isSafeContextPath(relativePath)) {
      vscode.window.showWarningMessage("That file cannot be attached to MM3 chat.");
      return;
    }

    const startLine = editor.selection.start.line + 1;
    const endLine = editor.selection.end.line + 1;
    const selectedText = editor.document.getText(editor.selection);
    if (!selectedText.trim()) {
      return;
    }

    this.selectedContext = this.selectedContext.filter(
      (part) => !(part.path === relativePath && part.kind === "selection" && part.startLine === startLine && part.endLine === endLine)
    );
    const nextPart: ContextPart = {
      kind: "selection",
      path: relativePath,
      content: selectedText,
      language: editor.document.languageId,
      startLine,
      endLine
    };
    this.dismissedContextKeys.delete(contextPartKey(nextPart));
    this.selectedContext.unshift(nextPart);
    await this.persistContext();
    this.postContextParts();
    await this.focusChat();
    vscode.window.showInformationMessage(
      `Added ${relativePath}:${startLine}-${endLine} to MM3 chat`
    );
  }

  async focusChat(): Promise<void> {
    flow("MM3ViewProvider.focusChat", 1, "enter");
    try {
      await vscode.commands.executeCommand("workbench.view.extension.m3");
    } catch {
      // Sidebar may already be visible.
    }
    this.show();
    try {
      await vscode.commands.executeCommand(`${MM3ViewProvider.viewType}.focus`);
    } catch {
      // View focus command is unavailable until the webview has resolved.
    }
  }

  private postContextParts(
    parts: ContextPart[] = this.selectedContext
  ): void {
    flow("MM3ViewProvider.postContextParts", 1, "enter", { count: parts.length });
    const hasSelection = parts.some((part) => part.kind === "selection");
    const scope = hasSelection
      ? "selection"
      : parts.length > 0
        ? "full-file"
        : "workspace";
    this.post({
      type: "context",
      scope,
      parts: parts.map((part) => ({
        path: part.path,
        kind: part.kind,
        language: part.language,
        size: part.content.length,
        tokens: Math.ceil(part.content.length / 4),
        startLine: part.startLine,
        endLine: part.endLine
      }))
    });
  }

  private async openCitation(
    filePath: string,
    startLine?: number,
    endLine?: number
  ): Promise<void> {
    flow("MM3ViewProvider.openCitation", 1, "enter", { filePath, startLine, endLine });
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
    flow("MM3ViewProvider.getErrorMessage", 1, "enter");

    if (typeof error === "string" && error.trim()) {
      return this.sanitizeUserError(error);
    }

    if (
      error instanceof AuthenticationError
    ) {
      return this.sanitizeUserError(error.message);
    }

    if (
      error instanceof Error
    ) {
      return this.sanitizeUserError(error.message);
    }

    return formatUserFacingError("unexpected");
  }

  private sanitizeUserError(message: string | undefined): string {
    const text = (message || "").trim();
    if (!text) {
      return formatUserFacingError("unexpected");
    }
    if (text.includes(MM3_CRM_URL) || text.includes(MM3_SUPPORT_EMAIL)) {
      return text;
    }
    if (text === "MM3 is already processing another request.") {
      return text;
    }
    if (
      /i\/o timeout|dial tcp|lookup |no such host|connection refused|connection reset|tls handshake timeout|client\.timeout exceeded|planning failed|adaptive reasoning failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|unable to reach|unable to connect/i.test(
        text
      )
    ) {
      return formatUserFacingError(
        "api",
        "The MM3 service did not respond in time. Please try again."
      );
    }
    return formatUserFacingError(classifyErrorMessage(text), text);
  }

  private postError(error: unknown): void {
    const message = this.getErrorMessage(error);
    this.post({
      type: "error",
      error: message,
      help: userFacingErrorHelp(classifyErrorMessage(message))
    });
  }

  private clearFileReviews(): void {
    this.codeChangeApplier.dismissPending();
    this.post({ type: "file_reviews_cleared" });
  }

  private postPendingFileReviews(): void {
    const files = this.codeChangeApplier.getPendingReviews().map((item) => ({
      path: item.path,
      created: item.created,
      deleted: item.deleted,
      hunks: (item.hunks ?? []).map((hunk) => ({
        id: hunk.id,
        startLine: hunk.startLine,
        lineCount: hunk.lines.length
      }))
    }));
    if (files.length === 0) {
      return;
    }
    this.post({
      type: "file_reviews",
      files
    });
  }

  private postFileReviewRemoved(filePath: string): void {
    if (this.codeChangeApplier.getPendingReviews().length === 0) {
      this.post({ type: "file_reviews_cleared" });
      return;
    }
    this.post({
      type: "file_review_removed",
      path: filePath
    });
  }

  private formatAnswer(
    response: AIResponse
  ): string {
    flow("MM3ViewProvider.formatAnswer", 1, "enter");
    return response.answer;
  }

  private post(
    message: WebviewResponse
  ): void {
    flow("MM3ViewProvider.post", 1, "enter", { type: message.type });

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
    flow("MM3ViewProvider.getHtml", 1, "enter");

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

<title>MM3 AI Agent</title>

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

/* Center content and cap line length when MM3 is docked in a wide area,
   such as the Secondary Side Bar, while still filling narrow widths. */
.header,
.messages,
.composer {
  width: 100%;
  max-width: 980px;
  margin-left: auto;
  margin-right: auto;
}

/* -------------------------------------------------------------------------- */
/* Header                                                                     */
/* -------------------------------------------------------------------------- */

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  font-weight: 600;
  user-select: none;
  border-bottom: 1px solid var(--vscode-panel-border);
  flex-shrink: 0;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  min-width: 0;
  flex: 1;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
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
  padding: 14px 14px 4px;
  scroll-behavior: smooth;
}

.message {
  margin-bottom: 12px;
  padding: 10px 13px;
  border-radius: 14px;
  word-break: break-word;
  line-height: 1.5;
  font-size: 13px;
  max-width: 92%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  animation: m3-message-in 0.16s ease-out;
}

@keyframes m3-message-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.user {
  margin-left: auto;
  border-bottom-right-radius: 4px;

  background:
    var(--vscode-button-background);

  color:
    var(--vscode-button-foreground);

  border:
    1px solid transparent;

  white-space: pre-wrap;
}

.assistant {
  margin-right: auto;
  border-bottom-left-radius: 4px;

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

.error-body p {
  margin: 0 0 8px;
}

.error-body p:last-child {
  margin-bottom: 0;
}

.error-help {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--vscode-inputValidation-errorBorder);
  font-size: 12px;
}

.error-help a,
.error-body a {
  color: var(--vscode-textLink-foreground);
}

.file-reviews {
  margin: 0 0 12px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: var(--vscode-editor-background);
  overflow: hidden;
}

.file-reviews-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--vscode-panel-border);
  font-size: 12px;
}

.file-reviews-title {
  opacity: 0.85;
}

.file-review-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.file-review-row:last-child {
  border-bottom: none;
}

.file-review-name {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  padding: 0;
  color: var(--vscode-textLink-foreground);
  cursor: pointer;
  text-align: left;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-review-name:hover {
  text-decoration: underline;
}

.file-review-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.file-review-actions button,
.file-reviews-header button {
  border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}

.file-review-actions .accept {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-color: transparent;
}

.hunk-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  padding: 6px 10px;
  border-top: 1px solid var(--vscode-panel-border);
}

.hunk-controls button.selected {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.thinking-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
  font-size: 12px;
  opacity: 0.9;
}

.thinking-indicator[hidden] {
  display: none;
}

.thinking-dots {
  display: inline-flex;
  gap: 4px;
}

.thinking-dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vscode-progressBar-background, var(--vscode-textLink-foreground));
  animation: m3-think-bounce 1s infinite ease-in-out;
}

.thinking-dots span:nth-child(2) {
  animation-delay: 0.15s;
}

.thinking-dots span:nth-child(3) {
  animation-delay: 0.3s;
}

.thinking-label {
  opacity: 0.8;
}

@keyframes m3-think-bounce {
  0%, 80%, 100% {
    transform: translateY(0);
    opacity: 0.35;
  }
  40% {
    transform: translateY(-3px);
    opacity: 1;
  }
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

.feedback-actions {
  display: flex;
  gap: 4px;
  margin: -4px 0 10px;
}

.feedback-actions button {
  width: 28px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  color: var(--vscode-foreground);
  background: transparent;
  cursor: pointer;
}

.feedback-actions button:hover {
  background: var(--vscode-toolbar-hoverBackground);
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
  padding: 8px 14px 14px;
  flex-shrink: 0;
}

.composer-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--vscode-input-border);
  border-radius: 14px;
  background: var(--vscode-input-background);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}

.composer-box:focus-within {
  border-color: var(--vscode-focusBorder);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
}

.composer.drop-target .composer-box {
  border-color: var(--vscode-focusBorder);
  border-style: dashed;
  background: var(--vscode-list-dropBackground, var(--vscode-input-background));
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
  transition: background-color 0.1s ease, transform 0.1s ease;
}

.icon-btn.primary {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
}

.icon-btn:hover:not(:disabled) {
  background: var(--vscode-toolbar-hoverBackground);
  transform: scale(1.05);
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
  gap: 5px;
  padding: 0 14px 6px;
  max-width: 980px;
  margin: 0 auto;
  width: 100%;
  font-size: 11px;
}

.context-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  transition: background-color 0.1s ease;
}

.context-chip:hover {
  background: var(--vscode-badge-background);
  filter: brightness(1.1);
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

  flex-direction: column;

  align-items: center;

  justify-content: center;

  gap: 10px;

  height: 100%;

  text-align: center;

  opacity: 0.7;

  padding: 20px;
}

.empty-icon {
  font-size: 28px;
  opacity: 0.8;
}

.empty-title {
  font-size: 13px;
  font-weight: 600;
}

.empty-subtitle {
  font-size: 12px;
  max-width: 320px;
  line-height: 1.5;
  opacity: 0.85;
}

</style>

</head>

<body>

<div class="container">

  <div class="header">

    <div class="header-title">

      <span class="brand-mark">M3</span>
      <span>MM3 AI Agent</span>
      <span id="wallet-balance" class="credits">0 credits</span>
      <span id="model" class="model"></span>

    </div>

    <div class="header-actions">
      <button id="reset-token" class="icon-btn" type="button" title="Reset access token">🔑</button>
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
      <div class="empty-icon">💬</div>
      <div class="empty-title">Ask MM3 anything about this project</div>
      <div class="empty-subtitle">Describe a task, bug, or question. Attach files or a selection for focused context.</div>
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
        placeholder="Ask MM3"
        aria-label="Ask MM3"
      ></textarea>
      <div class="composer-toolbar">
        <button id="attach" class="icon-btn" type="button" title="Attach files">📎</button>
        <button id="add-selection" class="icon-btn" type="button" title="Add selection to chat">↧</button>
        <select id="mode" aria-label="Mode">
          <option value="agent" selected>Agent</option>
          <option value="ask">Ask</option>
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

const addSelection =
  document.getElementById("add-selection");

const resetToken =
  document.getElementById("reset-token");

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
let streamPauseTimer = 0;
const STREAM_PAUSE_MS = 180;

const contextParts = [];
let contextScope = "workspace";

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
  label.textContent = contextScope === "selection"
    ? "Selected code only"
    : contextScope === "full-file"
      ? "Attached files only"
      : "Workspace context";
  label.title = contextScope === "selection"
    ? "Only the selected code will be sent to the AI. Dependencies are not added automatically."
    : contextScope === "full-file"
      ? "Only the attached file contents will be sent to the AI. Dependencies are not added automatically."
      : "The AI may investigate relevant workspace files.";
  container.appendChild(label);

  contextParts.forEach((part) => {
    const chip = document.createElement("span");
    chip.className = "context-chip";
    const rangeLabel = (part.startLine && part.endLine)
      ? (":" + part.startLine + "-" + part.endLine)
      : "";
    const baseName = String(part.path || "").split("/").pop() || part.path;
    chip.textContent = baseName + rangeLabel;
    chip.title = part.kind + " " + part.path + rangeLabel +
      " (" + part.tokens + " tokens)";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "x";
    remove.title = "Remove " + part.path;
    remove.addEventListener("click", () => {
      vscode.postMessage({
        type: "remove_context",
        path: part.path,
        kind: part.kind,
        startLine: part.startLine,
        endLine: part.endLine
      });
    });

    chip.appendChild(remove);
    container.appendChild(chip);
  });
}

attach.addEventListener("click", () => {
  vscode.postMessage({ type: "attach_files" });
});

const composer = document.querySelector(".composer");
composer.addEventListener("dragover", (event) => {
  event.preventDefault();
  composer.classList.add("drop-target");
});
composer.addEventListener("dragleave", () => {
  composer.classList.remove("drop-target");
});
composer.addEventListener("drop", (event) => {
  event.preventDefault();
  composer.classList.remove("drop-target");
  const paths = [...(event.dataTransfer?.files || [])]
    .map((file) => file.path || file.name)
    .filter(Boolean);
  if (paths.length > 0) {
    vscode.postMessage({ type: "attach_dropped_files", paths });
  }
});

addSelection.addEventListener("click", () => {
  vscode.postMessage({ type: "add_selection" });
});

resetToken.addEventListener("click", () => {
  vscode.postMessage({ type: "reset_token" });
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
          "___MM3_INLINE_CODE_" +
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
      /___MM3_INLINE_CODE_(\\d+)___/g,
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
          "\\n___MM3_CODE_BLOCK_" +
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
        /^___MM3_CODE_BLOCK_(\\d+)___$/
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

  } else if (type === "error") {
    addErrorContent(element, String(text ?? ""), null);
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

function addErrorMessage(text, help) {
  if (empty) {
    empty.remove();
  }
  const element = document.createElement("div");
  element.className = "message error";
  addErrorContent(element, String(text ?? ""), help);
  messages.appendChild(element);
  messages.scrollTop = messages.scrollHeight;
}

function addErrorContent(element, text, help) {
  const body = document.createElement("div");
  body.className = "error-body";
  String(text ?? "").split(/\\n\\n/).forEach((para) => {
    if (!para.trim()) {
      return;
    }
    const p = document.createElement("p");
    appendLinkedText(p, para.replace(/\\n/g, " "));
    body.appendChild(p);
  });
  element.appendChild(body);

  const helpBox = document.createElement("div");
  helpBox.className = "error-help";
  const crm = document.createElement("a");
  crm.href = (help && help.crmUrl) || "https://crm.mm3ai.com";
  crm.textContent = "Reset token at crm.mm3ai.com";
  const support = document.createElement("a");
  support.href = "mailto:" + ((help && help.supportEmail) || "support@mm3ai.com");
  support.textContent = "Unexpected issue? Email support@mm3ai.com";
  helpBox.appendChild(crm);
  helpBox.appendChild(support);
  element.appendChild(helpBox);
}

function appendLinkedText(target, text) {
  const pattern = /(https?:\\/\\/[^\\s]+|crm\\.mm3ai\\.com|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > last) {
      target.appendChild(document.createTextNode(text.slice(last, match.index)));
    }
    const token = match[0];
    const link = document.createElement("a");
    if (token.indexOf("@") > 0 && token.indexOf("://") === -1) {
      link.href = "mailto:" + token;
    } else {
      link.href = token.indexOf("://") === -1 ? "https://" + token : token;
    }
    link.textContent = token;
    target.appendChild(link);
    last = match.index + token.length;
  }
  if (last < text.length) {
    target.appendChild(document.createTextNode(text.slice(last)));
  }
}

function fileReviewsPanel() {
  let panel = document.getElementById("file-reviews");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "file-reviews";
    panel.className = "file-reviews";
  }
  return panel;
}

function renderFileReviews(files) {
  if (!files || files.length === 0) {
    clearFileReviews();
    return;
  }
  if (empty) {
    empty.remove();
  }
  const panel = fileReviewsPanel();
  panel.textContent = "";

  const header = document.createElement("div");
  header.className = "file-reviews-header";
  const title = document.createElement("span");
  title.className = "file-reviews-title";
  title.textContent = "Changed files";
  const acceptAll = document.createElement("button");
  acceptAll.type = "button";
  acceptAll.textContent = "Accept all";
  acceptAll.addEventListener("click", () => {
    vscode.postMessage({ type: "review_accept_all" });
    clearFileReviews();
  });
  header.appendChild(title);
  header.appendChild(acceptAll);
  panel.appendChild(header);

  files.forEach((file) => {
    panel.appendChild(createFileReviewRow(file));
  });

  messages.appendChild(panel);
  messages.scrollTop = messages.scrollHeight;
}

function createFileReviewRow(file) {
  const row = document.createElement("div");
  row.className = "file-review-row";
  row.dataset.path = file.path;

  const name = document.createElement("button");
  name.type = "button";
  name.className = "file-review-name";
  const base = String(file.path || "").split("/").pop() || file.path;
  name.textContent = file.deleted ? base + " (deleted)" : file.created ? base + " (new)" : base;
  name.title = "Show difference for " + file.path;
  name.addEventListener("click", () => {
    vscode.postMessage({ type: "review_open_diff", path: file.path });
  });

  const actions = document.createElement("div");
  actions.className = "file-review-actions";
  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "accept";
  accept.textContent = "Accept";
  accept.addEventListener("click", () => {
    vscode.postMessage({ type: "review_accept", path: file.path });
    removeFileReviewRow(file.path);
  });
  const reject = document.createElement("button");
  reject.type = "button";
  reject.textContent = "Reject";
  reject.addEventListener("click", () => {
    vscode.postMessage({ type: "review_reject", path: file.path });
  });
  actions.appendChild(accept);
  actions.appendChild(reject);

  if (Array.isArray(file.hunks) && file.hunks.length > 1) {
    const selectedHunks = new Set();
    const hunkControls = document.createElement("div");
    hunkControls.className = "hunk-controls";

    file.hunks.forEach((hunk, index) => {
      const hunkButton = document.createElement("button");
      hunkButton.type = "button";
      hunkButton.textContent = "H" + (index + 1);
      hunkButton.title = "Toggle hunk at line " + hunk.startLine;
      hunkButton.addEventListener("click", () => {
        if (selectedHunks.has(hunk.id)) {
          selectedHunks.delete(hunk.id);
          hunkButton.classList.remove("selected");
        } else {
          selectedHunks.add(hunk.id);
          hunkButton.classList.add("selected");
        }
      });
      hunkControls.appendChild(hunkButton);
    });

    const applyHunks = document.createElement("button");
    applyHunks.type = "button";
    applyHunks.textContent = "Apply selected";
    applyHunks.addEventListener("click", () => {
      if (selectedHunks.size === 0) {
        return;
      }
      vscode.postMessage({
        type: "review_apply_hunks",
        path: file.path,
        hunkIds: [...selectedHunks]
      });
      applyHunks.disabled = true;
    });
    hunkControls.appendChild(applyHunks);
    row.appendChild(hunkControls);
  }

  row.appendChild(name);
  row.appendChild(actions);
  return row;
}

function removeFileReviewRow(filePath) {
  const panel = document.getElementById("file-reviews");
  if (!panel) {
    return;
  }
  panel.querySelectorAll(".file-review-row").forEach((row) => {
    if (row.dataset.path === filePath) {
      row.remove();
    }
  });
  if (!panel.querySelector(".file-review-row")) {
    clearFileReviews();
  }
}

function clearFileReviews() {
  const panel = document.getElementById("file-reviews");
  if (panel) {
    panel.remove();
  }
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

function addFeedbackControls(requestId) {
  if (!requestId) {
    return;
  }

  const actions = document.createElement("div");
  actions.className = "feedback-actions";
  actions.setAttribute("aria-label", "Rate this answer");

  [
    { rating: 5, label: "Helpful" , icon: "👍" },
    { rating: 1, label: "Not helpful", icon: "👎" }
  ].forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.icon;
    button.title = item.label;
    button.addEventListener("click", () => {
      vscode.postMessage({
        type: "task_feedback",
        requestId,
        rating: item.rating
      });
      actions.querySelectorAll("button").forEach((candidate) => {
        candidate.disabled = true;
      });
    });
    actions.appendChild(button);
  });

  messages.appendChild(actions);
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

  const charged =
    Number(usage.charged_credits ?? usage.estimated_cost ?? 0);
  const wallet =
    Number(usage.wallet_balance ?? 0);
  const aiApiCalls =
    Number(usage.ai_api_calls ?? 0);
  const totalTokens =
    Number(usage.total_tokens ?? 0);

  if (aiApiCalls === 0 && totalTokens === 0 && charged === 0 && wallet === 0) {
    return;
  }

  const element =
    document.createElement("div");

  element.className =
    "usage";

  element.textContent =
    " • Tokens: " +
    totalTokens +
    " • Credits: " +
    charged.toFixed(4) +
    " • Wallet: " +
    wallet.toFixed(2);

  if (walletBalance && wallet > 0) {
    walletBalance.textContent = wallet.toFixed(2) + " credits";
  }

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

function addCheckpointList(items) {
  if (!items || items.length === 0) {
    return;
  }

  const panel = document.createElement("div");
  panel.className = "detail-panel";
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Investigation checkpoints";
  const body = document.createElement("div");
  body.className = "detail-body";
  const list = document.createElement("ul");
  list.className = "validation-list";
  items.forEach((item) => {
    const entry = document.createElement("li");
    entry.className = "validation-check";
    const result = item.success === false ? "failed" : item.success === true ? "ok" : "recorded";
    const target = item.path ? " " + item.path : "";
    entry.textContent = "Step " + item.step + ": " + item.kind + " " + (item.tool || item.action || "") + target + " (" + result + ")";
    list.appendChild(entry);
  });
  body.appendChild(list);
  details.appendChild(summary);
  details.appendChild(body);
  panel.appendChild(details);
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

function thinkingLabel(text) {
  if (text) {
    return String(text);
  }
  if (composerState === "running") {
    return "Working";
  }
  return "Thinking";
}

function showThinking(text) {
  if (empty) {
    empty.remove();
  }
  let row = document.getElementById("thinking-indicator");
  if (!row) {
    row = document.createElement("div");
    row.id = "thinking-indicator";
    row.className = "thinking-indicator";
    row.setAttribute("aria-live", "polite");
    row.innerHTML =
      '<span class="thinking-dots"><span></span><span></span><span></span></span>' +
      '<span class="thinking-label">Thinking</span>';
  }
  const label = row.querySelector(".thinking-label");
  if (label) {
    label.textContent = thinkingLabel(text);
  }
  row.hidden = false;
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

function hideThinking() {
  if (streamPauseTimer) {
    clearTimeout(streamPauseTimer);
    streamPauseTimer = 0;
  }
  const row = document.getElementById("thinking-indicator");
  if (row) {
    row.hidden = true;
  }
}

function noteStreamActivity(label) {
  hideThinking();
  streamPauseTimer = setTimeout(() => {
    if (composerState === "running") {
      showThinking(label || "Thinking");
    }
  }, STREAM_PAUSE_MS);
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
  clearFileReviews();
  addMessage(value, "user");
  input.value = "";
  setComposerState("running");
  showThinking("Thinking");
  vscode.postMessage({
    type: "send_message",
    value: value,
    mode: mode.value,
    agentProfile: agentProfile.value
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
    // Prefer a fresh send when the user typed a new question.
    if (input.value.trim()) {
      sendMessage();
      return;
    }
    vscode.postMessage({ type: "retry_last" });
    clearFileReviews();
    return;
  }
  sendMessage();
});

vscode.postMessage({ type: "load_billing" });

input.addEventListener("input", () => {
  if (composerState === "failed" && input.value.trim()) {
    action.textContent = "↑";
    action.title = "Send";
  } else if (composerState === "failed" && !input.value.trim()) {
    action.textContent = "↻";
    action.title = "Retry";
  }
});

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

document.addEventListener("click", (event) => {
  const link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
  if (!link) {
    return;
  }
  event.preventDefault();
  vscode.postMessage({ type: "open_external", url: link.href });
});

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

        showThinking("Thinking");

        break;

      case "answer":

        hideThinking();

        setProcessing(
          false
        );

        addMessage(
          message.answer,
          "assistant"
        );

        addFeedbackControls(message.requestId);

        addConfidence(
          message.confidence
        );

        addQualitySummary(
          message.quality
        );

        addCheckpointList(message.checkpoints || []);

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
        contextScope = message.scope;
        contextParts.push(...message.parts);
        renderContextParts();
        break;

      case "agent_event":
        if (message.event.type === "token" && message.event.delta) {
          noteStreamActivity("Writing");
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
          const thinkingRow = document.getElementById("thinking-indicator");
          if (thinkingRow && !thinkingRow.hidden) {
            messages.appendChild(thinkingRow);
          }
          messages.scrollTop = messages.scrollHeight;
          break;
        }

        showThinking(message.event.message || "Working");

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
        hideThinking();
        setComposerState("failed");
        addErrorMessage(message.error, message.help);
        input.focus();
        break;

      case "file_reviews":
        renderFileReviews(message.files || []);
        break;

      case "file_review_removed":
        removeFileReviewRow(message.path);
        break;

      case "file_reviews_cleared":
        clearFileReviews();
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
        hideThinking();
        setComposerState("idle");
        break;

      case "ready":
        hideThinking();
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
          "Ask MM3 about your project.";

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
    flow("MM3ViewProvider.getNonce", 1, "enter");

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
      type: "attach_dropped_files";
      paths: string[];
    }
  | {
      type: "add_selection";
    }
  | {
      type: "remove_context";
      path: string;
      kind?: string;
      startLine?: number;
      endLine?: number;
    }
  | {
      type: "reset_token";
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
    }
  | {
      type: "task_feedback";
      requestId: string;
      rating: number;
    }
  | {
      type: "open_external";
      url: string;
    }
  | {
      type: "review_accept";
      path: string;
    }
  | {
      type: "review_accept_all";
    }
  | {
      type: "review_reject";
      path: string;
    }
  | {
      type: "review_open_diff";
      path: string;
    }
  | {
      type: "review_apply_hunks";
      path: string;
      hunkIds: string[];
    };

type WebviewResponse =
  | {
      type: "thinking";
    }
  | {
      type: "answer";
      answer: string;
      usage?: AIUsage;
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
      checkpoints?: Array<{
        step: number;
        kind: string;
        action?: string;
        tool?: string;
        path?: string;
        success?: boolean;
      }>;
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
      scope: "workspace" | "selection" | "full-file";
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
      help?: UserFacingErrorHelp;
    }
  | {
      type: "file_reviews";
      files: Array<{
        path: string;
        created: boolean;
        deleted: boolean;
        hunks: Array<{
          id: string;
          startLine: number;
          lineCount: number;
        }>;
      }>;
    }
  | {
      type: "file_review_removed";
      path: string;
    }
  | {
      type: "file_reviews_cleared";
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

function contextPartKey(part: {
  path: string;
  kind?: string;
  startLine?: number;
  endLine?: number;
}): string {
  return [
    part.path,
    part.kind ?? "",
    String(part.startLine ?? ""),
    String(part.endLine ?? "")
  ].join("|");
}

