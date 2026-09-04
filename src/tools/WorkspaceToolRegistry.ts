import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  AgentToolName,
  InteractionMode,
  ToolRequest,
  ToolResult
} from "../models/types";
import { CodeChangeApplier } from "../safety/CodeChangeApplier";
import {
  assertNotSensitivePath,
  assertWorkspaceTrusted,
  validateWorkspaceRelativePath
} from "../safety/changeValidation";
import { availableTools, isToolAllowed } from "./toolPolicy";

const execFileAsync = promisify(execFile);

export class WorkspaceToolRegistry {
  constructor(
    private readonly changeApplier = new CodeChangeApplier()
  ) {}

  getAvailableTools(
    mode: InteractionMode
  ): AgentToolName[] {
    return availableTools(mode);
  }

  async execute(
    request: ToolRequest,
    mode: InteractionMode
  ): Promise<ToolResult> {
    if (mode !== "agent") {
      throw new Error("Ask mode does not permit tool execution.");
    }

    if (!isToolAllowed(mode, request.tool)) {
      throw new Error(`Tool '${request.tool}' is not available.`);
    }

    switch (request.tool) {
      case "apply_change_set":
        await this.changeApplier.offer(request.changes ?? []);
        return this.result(request.tool, true, "Change set reviewed.");
      case "create_file":
        return this.createFile(request.path, request.changes?.[0]?.updated ?? "");
      case "delete_file":
        return this.deleteFile(request.path);
      case "rename_file":
      case "move_file":
        return this.moveFile(request.path, request.targetPath);
      case "get_diagnostics":
        return this.getDiagnostics(request.path);
      case "run_task":
        return this.runTask(request.taskName);
      case "git_diff":
        return this.runGit("git_diff", ["diff", "--", "."]);
      case "git_status":
        return this.runGit("git_status", ["status", "--short"]);
      default:
        throw new Error(`Tool '${request.tool}' must use the existing read-only registry.`);
    }
  }

  private async createFile(
    filePath: string | undefined,
    content: string
  ): Promise<ToolResult> {
    assertWorkspaceTrusted(vscode.workspace.isTrusted);
    const uri = this.resolvePath(filePath);
    await this.confirm(`Create ${filePath}?`);
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(uri, { ignoreIfExists: false });
    edit.insert(uri, new vscode.Position(0, 0), content);
    if (!await vscode.workspace.applyEdit(edit)) {
      throw new Error(`Could not create ${filePath}.`);
    }
    return this.result("create_file", true, `Created ${filePath}.`);
  }

  private async deleteFile(
    filePath: string | undefined
  ): Promise<ToolResult> {
    assertWorkspaceTrusted(vscode.workspace.isTrusted);
    const uri = this.resolvePath(filePath);
    await vscode.workspace.openTextDocument(uri);
    await this.confirm(`Delete ${filePath}?`);
    const edit = new vscode.WorkspaceEdit();
    edit.deleteFile(uri, { ignoreIfNotExists: false });
    if (!await vscode.workspace.applyEdit(edit)) {
      throw new Error(`Could not delete ${filePath}.`);
    }
    return this.result("delete_file", true, `Deleted ${filePath}.`);
  }

  private async moveFile(
    filePath: string | undefined,
    targetPath: string | undefined
  ): Promise<ToolResult> {
    assertWorkspaceTrusted(vscode.workspace.isTrusted);
    const source = this.resolvePath(filePath);
    const target = this.resolvePath(targetPath);
    await vscode.workspace.openTextDocument(source);
    await this.confirm(`Move ${filePath} to ${targetPath}?`);
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(source, target, { overwrite: false });
    if (!await vscode.workspace.applyEdit(edit)) {
      throw new Error(`Could not move ${filePath}.`);
    }
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
      : diagnostics.map((item) => item.message).join("\n");
    return this.result("get_diagnostics", true, output);
  }

  private async runTask(
    taskName?: string
  ): Promise<ToolResult> {
    if (!taskName || !/^[a-zA-Z0-9._:-]+$/.test(taskName)) {
      throw new Error("run_task requires an allowlisted task name.");
    }
    await this.confirm(`Run task ${taskName}?`);
    const tasks = await vscode.tasks.fetchTasks();
    const task = tasks.find((item) => item.name === taskName);
    if (!task) {
      throw new Error(`Task '${taskName}' was not found.`);
    }
    await vscode.tasks.executeTask(task);
    return this.result("run_task", true, `Started task ${taskName}.`);
  }

  private async runGit(
    tool: "git_diff" | "git_status",
    args: string[]
  ): Promise<ToolResult> {
    const workspace = vscode.workspace.workspaceFolders?.[0];

    if (!workspace) {
      throw new Error("Git inspection requires an open workspace.");
    }

    try {
      const result = await execFileAsync("git", args, {
        cwd: workspace.uri.fsPath,
        timeout: 10_000,
        maxBuffer: 1_000_000
      });
      return this.result(tool, true, result.stdout || "No changes.");
    } catch (error) {
      throw new Error(
        `Git inspection failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private resolvePath(filePath: string | undefined): vscode.Uri {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      throw new Error(`Unsafe workspace path: ${filePath ?? ""}`);
    }
    const normalized = validateWorkspaceRelativePath(filePath ?? "");
    assertNotSensitivePath(normalized);
    return vscode.Uri.joinPath(workspace.uri, ...normalized.split("/"));
  }

  private async confirm(message: string): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      "Approve"
    );
    if (choice !== "Approve") {
      throw new Error("Operation was not approved.");
    }
  }

  private result(
    tool: AgentToolName,
    success: boolean,
    output: string
  ): ToolResult {
    return { tool, success, output };
  }
}