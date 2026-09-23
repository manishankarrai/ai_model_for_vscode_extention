import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";

import {
  AgentToolName,
  InteractionMode,
  ToolRequest,
  ToolResult,
  ToolApprovalDecision,
  ToolApprovalStatus
} from "../models/types";
import { CodeChangeApplier } from "../safety/CodeChangeApplier";
import {
  assertNotSensitivePath,
  assertWorkspaceTrusted,
  normalizeNewlines,
  resolveApplyContent,
  validateWorkspaceRelativePath
} from "../safety/changeValidation";
import { availableTools, isToolAllowed, isReadOnlyTool } from "./toolPolicy";
import { parseSafeCommand } from "./commandPolicy";
import { adaptiveLimits } from "../config/adaptiveLimits";

import { flow } from "../utils/flowLog";

export type ToolApprovalHandler = (
  message: string
) => Promise<ToolApprovalDecision>;

const ALWAYS_APPROVE_TERMINAL_KEY = "mm3.terminal.alwaysApprove";

const execFileAsync = promisify(execFile);

export class WorkspaceToolRegistry {
  private approvalHandler?: ToolApprovalHandler;

  constructor(
    private readonly changeApplier = new CodeChangeApplier(),
    private readonly approvalState?: vscode.Memento
  ) {}

  setApprovalHandler(handler: ToolApprovalHandler | undefined): void {
    this.approvalHandler = handler;
  }

  isAllowAllCommands(): boolean {
    return this.approvalState?.get<boolean>(ALWAYS_APPROVE_TERMINAL_KEY) ?? false;
  }

  async setAllowAllCommands(enabled: boolean): Promise<void> {
    await this.approvalState?.update(ALWAYS_APPROVE_TERMINAL_KEY, enabled);
  }

  getAvailableTools(
    mode: InteractionMode
  ): AgentToolName[] {
    return availableTools(mode);
  }

  isWorkspaceTool(tool: AgentToolName): boolean {
    return !isReadOnlyTool(tool) ||
      tool === "get_diagnostics" ||
      tool === "git_diff" ||
      tool === "git_status";
  }

  async execute(
    request: ToolRequest,
    mode: InteractionMode
  ): Promise<ToolResult> {
    flow("WorkspaceToolRegistry.execute", 1, "enter", { tool: request.tool });
    if (!isToolAllowed(mode, request.tool)) {
      throw new Error(`Tool '${request.tool}' is not available.`);
    }

    if (mode === "ask" && !isReadOnlyTool(request.tool)) {
      throw new Error(`Ask mode only permits read-only tools: '${request.tool}'.`);
    }

    switch (request.tool) {
      case "apply_change_set":
      case "apply_patch":
        return this.applyChanges(request);
      case "create_file":
      case "write_file":
        return this.createFile(
          request.path,
          request.content ?? request.updated ?? request.changes?.[0]?.updated ?? ""
        );
      case "edit_file":
        return this.editFile(request);
      case "delete_file":
        return this.deleteFile(request.path);
      case "rename_file":
      case "move_file":
        return this.moveFile(request.path, request.targetPath);
      case "get_diagnostics":
        return this.getDiagnostics(request.path);
      case "run_task":
        return this.runTask(request.taskName);
      case "run_command":
        return this.runCommand(request.command);
      case "run_tests":
        return this.runTests();
      case "git_diff":
        return this.runGit("git_diff", ["diff", "--", "."]);
      case "git_status":
        return this.runGit("git_status", ["status", "--short"]);
      default:
        throw new Error(`Tool '${request.tool}' must use the existing read-only registry.`);
    }
  }

  private async applyChanges(request: ToolRequest): Promise<ToolResult> {
    const changes = request.changes ?? [];
    if (changes.length === 0 && request.path && request.updated) {
      return this.editFile(request);
    }
    if (changes.length === 0) {
      throw new Error("apply_change_set requires changes.");
    }
    const applied = await this.changeApplier.offer(changes);
    const diffs = applied.map((item) => item.diff).join("\n\n");
    return this.result(
      request.tool,
      true,
      [
        `Applied ${applied.length} file change(s).`,
        diffs
      ].filter(Boolean).join("\n\n")
    );
  }

  private async editFile(request: ToolRequest): Promise<ToolResult> {
    assertWorkspaceTrusted(vscode.workspace.isTrusted);
    const filePath = request.path;
    const uri = this.resolvePath(filePath);
    const document = await vscode.workspace.openTextDocument(uri);
    const original = request.original;
    const updated = request.updated ?? request.content;
    if (original === undefined) {
      throw new Error(
        "edit_file requires the exact original file or selected code content."
      );
    }
    if (updated === undefined) {
      throw new Error("edit_file requires updated content.");
    }
    const expected = resolveApplyContent(
      document.getText(),
      original,
      updated
    );
    const applied = await this.changeApplier.offer([{
      path: validateWorkspaceRelativePath(filePath ?? ""),
      original,
      updated
    }]);
    const after = (await vscode.workspace.openTextDocument(uri)).getText();
    const ok = normalizeNewlines(after) === normalizeNewlines(expected);
    const diff = applied[0]?.diff ?? "";
    return this.result(
      "edit_file",
      ok,
      ok
        ? [`Updated ${filePath}.`, diff].filter(Boolean).join("\n\n")
        : `Edit for ${filePath} was not applied.`
    );
  }

  private async createFile(
    filePath: string | undefined,
    content: string
  ): Promise<ToolResult> {
    const applied = await this.changeApplier.offer([{
      path: validateWorkspaceRelativePath(filePath ?? ""),
      original: "",
      updated: content
    }]);
    const diff = applied[0]?.diff ?? "";
    return this.result(
      "create_file",
      true,
      [`Created ${filePath}.`, diff].filter(Boolean).join("\n\n")
    );
  }

  private async deleteFile(
    filePath: string | undefined
  ): Promise<ToolResult> {
    await this.changeApplier.deleteAndRecord(
      validateWorkspaceRelativePath(filePath ?? "")
    );
    return this.result("delete_file", true, `Deleted ${filePath}.`);
  }

  private async moveFile(
    filePath: string | undefined,
    targetPath: string | undefined
  ): Promise<ToolResult> {
    await this.changeApplier.moveAndRecord(
      validateWorkspaceRelativePath(filePath ?? ""),
      validateWorkspaceRelativePath(targetPath ?? "")
    );
    return this.result("move_file", true, `Moved ${filePath} to ${targetPath}.`);
  }

  private async getDiagnostics(
    filePath?: string
  ): Promise<ToolResult> {
    const diagnostics = filePath
      ? vscode.languages.getDiagnostics(this.resolvePath(filePath))
      : vscode.languages.getDiagnostics().flatMap((entry) => entry[1]);
    const output = diagnostics.length === 0
      ? "No diagnostics."
      : diagnostics.map((item) => {
        const range = `${item.range.start.line + 1}:${item.range.start.character + 1}`;
        return `${item.severity} ${range} ${item.message}`;
      }).join("\n");
    return this.result("get_diagnostics", true, output);
  }

  private async runTask(
    taskName?: string
  ): Promise<ToolResult> {
    if (!taskName || !/^[a-zA-Z0-9._:-]+$/.test(taskName)) {
      throw new Error("run_task requires an allowlisted task name.");
    }
    const approval = await this.confirm(`Run task ${taskName}?`);
    if (approval === "skip") {
      return this.result(
        "run_task",
        false,
        `Skipped task ${taskName} because the user chose Skip.`,
        "skip"
      );
    }
    const tasks = await vscode.tasks.fetchTasks();
    const task = tasks.find((item) => item.name === taskName);
    if (!task) {
      throw new Error(`Task '${taskName}' was not found.`);
    }
    await vscode.tasks.executeTask(task);
    return this.result("run_task", true, `Started task ${taskName}.`, approval);
  }

  private async runTests(): Promise<ToolResult> {
    const command = await this.detectTestCommand();
    return this.runCommand(command, "run_tests");
  }

  private async detectTestCommand(): Promise<string> {
    const workspace = this.requireWorkspace();
    const root = workspace.uri.fsPath;

    try {
      const packageJson = JSON.parse(
        await fs.readFile(`${root}/package.json`, "utf8")
      ) as { scripts?: Record<string, string> };
      if (packageJson.scripts?.test) {
        return "npm test";
      }
    } catch {
      // no package.json
    }

    try {
      await fs.access(`${root}/go.mod`);
      return "go test ./...";
    } catch {
      // not a Go module
    }

    try {
      await fs.access(`${root}/pytest.ini`);
      return "python -m pytest";
    } catch {
      // no pytest.ini
    }

    throw new Error("MM3 could not detect a test command for this workspace.");
  }

  private async runCommand(
    command?: string,
    tool: AgentToolName = "run_command"
  ): Promise<ToolResult> {
    assertWorkspaceTrusted(vscode.workspace.isTrusted);
    const rawCommand = command ?? "";
    const parsed = parseSafeCommand(rawCommand);
    const workspace = this.requireWorkspace();
    const displayCommand = [parsed.binary, ...parsed.args]
      .map((part) => /\s/.test(part) ? JSON.stringify(part) : part)
      .join(" ");
    const approval = await this.confirm(`Run \`${displayCommand}\` in the workspace?`);
    if (approval === "skip") {
      return this.result(
        tool,
        false,
        `Skipped command: ${displayCommand}. The user chose Skip for this request.`,
        "skip"
      );
    }

    const shell = process.platform === "win32"
      ? (process.env.ComSpec || "cmd.exe")
      : (process.env.SHELL || "/bin/sh");
    const shellArgs = process.platform === "win32"
      ? ["/d", "/s", "/c", rawCommand]
      : ["-lc", rawCommand];

    try {
      const result = await execFileAsync(shell, shellArgs, {
        cwd: workspace.uri.fsPath,
        timeout: tool === "run_tests" ? 180_000 : 60_000,
        maxBuffer: adaptiveLimits.maxToolOutputChars * 4,
        env: process.env
      });
      const output = [
        `exit_code=0`,
        `command=${displayCommand}`,
        result.stdout || "",
        result.stderr || ""
      ].join("\n").trim();
      return this.result(
        tool,
        true,
        output || "Command succeeded with no output.",
        approval
      );
    } catch (error) {
      const execError = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      const output = [
        `exit_code=${execError.code ?? 1}`,
        `command=${displayCommand}`,
        execError.stdout ?? "",
        execError.stderr ?? execError.message ?? String(error)
      ].join("\n").trim();
      return this.result(tool, false, output, approval);
    }
  }

  private async runGit(
    tool: "git_diff" | "git_status",
    args: string[]
  ): Promise<ToolResult> {
    const workspace = this.requireWorkspace();
    const fallback = this.gitFallbackDiff(tool);
    try {
      const result = await execFileAsync("git", args, {
        cwd: workspace.uri.fsPath,
        timeout: 10_000,
        maxBuffer: adaptiveLimits.maxToolOutputChars * 4
      });
      return this.result(tool, true, result.stdout || "No changes.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (this.isMissingGit(error)) {
        return this.result(tool, true, fallback);
      }
      throw new Error(`Git inspection failed: ${detail}`);
    }
  }

  private isMissingGit(error: unknown): boolean {
    const text = error instanceof Error ? `${error.message} ${(error as NodeJS.ErrnoException).code ?? ""}` : String(error);
    return /ENOENT|not a git repository|git: not found|spawn git/i.test(text);
  }

  private gitFallbackDiff(tool: "git_diff" | "git_status"): string {
    const diffs = this.changeApplier.getSessionDiffs();
    if (diffs.length === 0) {
      return [
        "Git is not available in this workspace.",
        "MM3 still shows file differences from before/after content when it edits files — no git repo is required for that.",
        "Open the chat diffs after an edit, or ask MM3 to apply changes so an in-memory diff can be shown here."
      ].join("\n");
    }
    const header = tool === "git_status"
      ? "Git is not available. Files MM3 changed this session:"
      : "Git is not available. In-memory before/after diffs of files MM3 changed:";
    const body = diffs.map((item) => {
      if (tool === "git_status") {
        return `${item.original ? "M" : "A"} ${item.path}`;
      }
      return item.diff;
    }).join("\n\n");
    return `${header}\n\n${body}`;
  }

  private requireWorkspace(): vscode.WorkspaceFolder {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      throw new Error("An open workspace is required.");
    }
    return workspace;
  }

  private resolvePath(filePath: string | undefined): vscode.Uri {
    flow("WorkspaceToolRegistry.resolvePath", 1, "enter");
    const workspace = this.requireWorkspace();
    const normalized = validateWorkspaceRelativePath(filePath ?? "");
    assertNotSensitivePath(normalized);
    return vscode.Uri.joinPath(workspace.uri, ...normalized.split("/"));
  }

  private async confirm(message: string): Promise<ToolApprovalStatus> {
    flow("WorkspaceToolRegistry.confirm", 1, "enter");
    if (this.approvalState?.get<boolean>(ALWAYS_APPROVE_TERMINAL_KEY)) {
      return "always_approved";
    }

    let decision: ToolApprovalDecision;
    if (this.approvalHandler) {
      decision = await this.approvalHandler(message);
    } else {
      const choice = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        "Approve",
        "Always Approve",
        "Skip"
      );
      decision = choice === "Approve"
        ? "approve"
        : choice === "Always Approve"
          ? "always_approve"
          : "skip";
    }

    if (decision === "always_approve") {
      await this.approvalState?.update(ALWAYS_APPROVE_TERMINAL_KEY, true);
    }
    return decision;
  }

  private result(
    tool: AgentToolName,
    success: boolean,
    output: string,
    approval?: ToolApprovalStatus
  ): ToolResult {
    const marker = "\n...[tool output truncated]...\n";
    const boundedOutput = output.length <= adaptiveLimits.maxToolOutputChars
      ? output
      : output.slice(0, adaptiveLimits.maxToolOutputChars - marker.length) + marker;
    return { tool, success, output: boundedOutput, approval };
  }
}
