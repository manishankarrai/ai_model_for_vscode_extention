import * as vscode from "vscode";

import { CodeChange } from "../models/types";

const MAX_CHANGES = 10;
const MAX_CHANGE_CHARS = 200_000;

export class CodeChangeApplier {
  private lastAppliedChanges: Array<{
    uri: vscode.Uri;
    original: string;
    updated: string;
  }> = [];

  async offer(
    changes: CodeChange[]
  ): Promise<void> {
    if (changes.length === 0) {
      return;
    }

    if (changes.length > MAX_CHANGES) {
      throw new Error("M3 proposed too many file changes.");
    }

    const workspace = vscode.workspace.workspaceFolders?.[0];

    if (!workspace) {
      throw new Error("M3 cannot apply changes without an open workspace.");
    }

    const documents: Array<{
      change: CodeChange;
      document: vscode.TextDocument;
    }> = [];

    for (const change of changes) {
      this.validateChange(change);

      const relativePath = this.validatePath(change.path);
      const uri = vscode.Uri.joinPath(
        workspace.uri,
        ...relativePath.split("/")
      );
      const document = await vscode.workspace.openTextDocument(uri);

      if (document.getText() !== change.original) {
        throw new Error(
          `M3 rejected ${change.path}: the file changed since investigation.`
        );
      }

      const proposedDocument = await vscode.workspace.openTextDocument({
        content: change.updated,
        language: document.languageId
      });

      await vscode.commands.executeCommand(
        "vscode.diff",
        document.uri,
        proposedDocument.uri,
        `M3 proposed change: ${change.path}`
      );

      documents.push({ change, document });
    }

    const confirmation = await vscode.window.showWarningMessage(
      `M3 proposes changes to ${documents.length} file${documents.length === 1 ? "" : "s"}. Apply them?`,
      { modal: true },
      "Apply Changes"
    );

    if (confirmation !== "Apply Changes") {
      return;
    }

    const edit = new vscode.WorkspaceEdit();

    for (const item of documents) {
      const fullRange = new vscode.Range(
        item.document.positionAt(0),
        item.document.positionAt(item.document.getText().length)
      );
      edit.replace(item.document.uri, fullRange, item.change.updated);
    }

    if (!await vscode.workspace.applyEdit(edit)) {
      throw new Error("M3 could not apply the approved changes.");
    }

    this.lastAppliedChanges = documents.map((item) => ({
      uri: item.document.uri,
      original: item.change.original,
      updated: item.change.updated
    }));

    for (const item of documents) {
      const document = await vscode.workspace.openTextDocument(item.document.uri);
      await document.save();
    }

    vscode.window.showInformationMessage(
      `M3 applied ${documents.length} approved file change${documents.length === 1 ? "" : "s"}.`
    );
  }

  async rollbackLast(): Promise<void> {
    if (this.lastAppliedChanges.length === 0) {
      vscode.window.showInformationMessage("M3 has no approved changes to roll back.");
      return;
    }

    const edit = new vscode.WorkspaceEdit();

    for (const change of this.lastAppliedChanges) {
      const document = await vscode.workspace.openTextDocument(change.uri);

      if (document.getText() !== change.updated) {
        throw new Error(
          `M3 rejected rollback: ${change.uri.fsPath} changed after the approved edit.`
        );
      }

      edit.replace(
        change.uri,
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length)
        ),
        change.original
      );
    }

    if (!await vscode.workspace.applyEdit(edit)) {
      throw new Error("M3 could not roll back the approved changes.");
    }

    for (const change of this.lastAppliedChanges) {
      const document = await vscode.workspace.openTextDocument(change.uri);
      await document.save();
    }

    this.lastAppliedChanges = [];
    vscode.window.showInformationMessage("M3 rolled back the last approved changes.");
  }

  private validateChange(change: CodeChange): void {
    if (
      change.original.length > MAX_CHANGE_CHARS ||
      change.updated.length > MAX_CHANGE_CHARS
    ) {
      throw new Error(`M3 rejected ${change.path}: proposed change is too large.`);
    }
  }

  private validatePath(filePath: string): string {
    const relativePath = filePath.replace(/\\/g, "/");

    if (
      !relativePath ||
      relativePath.startsWith("/") ||
      relativePath.split("/").some((part) => part === "..")
    ) {
      throw new Error(`M3 rejected unsafe change path: ${filePath}`);
    }

    return relativePath;
  }
}
