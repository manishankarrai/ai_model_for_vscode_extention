import * as vscode from "vscode";

import { CodeChange } from "../models/types";
import { flow } from "../utils/flowLog";

import {
  applyHunkApprovals,
  ChangeSetStore,
  contentHash,
  createNamedChangeSet,
  NamedChangeSet
} from "./changeSets";
import {
  assertFileHashMatches,
  assertFileNotStale,
  assertNotSensitivePath,
  assertWorkspaceTrusted,
  hashContent,
  validateChangeSize,
  validateWorkspaceRelativePath
} from "./changeValidation";

const MAX_CHANGES = 10;

export class CodeChangeApplier {
  private readonly store = new ChangeSetStore();
  private lastAppliedChanges: Array<{
    uri: vscode.Uri;
    path: string;
    original: string;
    updated: string;
    originalHash: string;
    updatedHash: string;
  }> = [];

  getChangeSets(): NamedChangeSet[] {
    flow("CodeChangeApplier.getChangeSets", 1, "enter");
    return this.store.list();
  }

  async offer(
    changes: CodeChange[],
    changeSetName?: string
  ): Promise<void> {
    if (changes.length === 0) {
      return;
    }

    if (changes.length > MAX_CHANGES) {
      throw new Error("M3 proposed too many file changes.");
    }

    assertWorkspaceTrusted(vscode.workspace.isTrusted);

    const workspace = vscode.workspace.workspaceFolders?.[0];

    if (!workspace) {
      throw new Error("M3 cannot apply changes without an open workspace.");
    }

    const changeSet = createNamedChangeSet(changes, changeSetName);
    this.store.record(changeSet);

    const prepared: Array<{
      change: CodeChange;
      document: vscode.TextDocument;
      review: (typeof changeSet.files)[number];
    }> = [];

    for (const change of changes) {
      validateChangeSize(change.path, change.original, change.updated);
      const relativePath = validateWorkspaceRelativePath(change.path);
      assertNotSensitivePath(relativePath);

      const uri = vscode.Uri.joinPath(
        workspace.uri,
        ...relativePath.split("/")
      );
      const document = await vscode.workspace.openTextDocument(uri);
      const review = changeSet.files.find((file) => file.path === change.path)!;

      assertFileNotStale(
        change.path,
        document.getText(),
        change.original,
        "apply"
      );
      assertFileHashMatches(
        change.path,
        document.getText(),
        review.originalHash,
        "apply"
      );

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

      prepared.push({ change, document, review });
    }

    const approved: typeof prepared = [];

    for (const item of prepared) {
      const hunkCount = item.review.hunks.length;
      const labels = hunkCount > 1
        ? [`Approve ${item.change.path}`, `Approve all ${hunkCount} hunks`, "Skip file"]
        : [`Approve ${item.change.path}`, "Skip file"];

      const choice = await vscode.window.showWarningMessage(
        `Review ${item.change.path} (${hunkCount || 1} hunk${hunkCount === 1 ? "" : "s"}).`,
        { modal: true },
        ...labels
      );

      if (!choice || choice === "Skip file") {
        changeSet.audit.push({
          at: Date.now(),
          action: "file_skipped",
          detail: item.change.path
        });
        continue;
      }

      if (hunkCount > 1 && choice === `Approve ${item.change.path}`) {
        const selectedHunks: string[] = [];
        for (const hunk of item.review.hunks) {
          const hunkChoice = await vscode.window.showWarningMessage(
            `Approve hunk ${hunk.id} starting near line ${hunk.startLine}?`,
            { modal: true },
            "Approve hunk",
            "Skip hunk"
          );
          if (hunkChoice === "Approve hunk") {
            selectedHunks.push(hunk.id);
          }
        }

        if (selectedHunks.length === 0) {
          changeSet.audit.push({
            at: Date.now(),
            action: "file_skipped",
            detail: `${item.change.path} (no hunks approved)`
          });
          continue;
        }

        changeSet.approvedHunkIds.push(...selectedHunks);
        const nextText = applyHunkApprovals(
          item.change.original,
          item.change.updated,
          selectedHunks,
          item.review.hunks
        );

        if (nextText === item.change.original) {
          changeSet.audit.push({
            at: Date.now(),
            action: "partial_hunks_blocked",
            detail: `${item.change.path}: approve all hunks or none for this release`
          });
          continue;
        }

        approved.push({
          ...item,
          change: { ...item.change, updated: nextText }
        });
        changeSet.approvedPaths.push(item.change.path);
        continue;
      }

      changeSet.approvedPaths.push(item.change.path);
      changeSet.approvedHunkIds.push(...item.review.hunks.map((hunk) => hunk.id));
      approved.push(item);
    }

    if (approved.length === 0) {
      changeSet.status = "rejected";
      changeSet.audit.push({
        at: Date.now(),
        action: "rejected",
        detail: "No files approved"
      });
      this.store.update(changeSet);
      return;
    }

    const finalConfirm = await vscode.window.showWarningMessage(
      `Apply ${approved.length} approved file${approved.length === 1 ? "" : "s"} in "${changeSet.name}"?`,
      { modal: true },
      "Apply Approved Changes"
    );

    if (finalConfirm !== "Apply Approved Changes") {
      changeSet.status = "rejected";
      changeSet.audit.push({
        at: Date.now(),
        action: "cancelled",
        detail: "Final apply cancelled"
      });
      this.store.update(changeSet);
      return;
    }

    const edit = new vscode.WorkspaceEdit();

    for (const item of approved) {
      const current = item.document.getText();
      assertFileHashMatches(
        item.change.path,
        current,
        item.review.originalHash,
        "apply"
      );
      assertFileNotStale(
        item.change.path,
        current,
        item.change.original,
        "apply"
      );

      const fullRange = new vscode.Range(
        item.document.positionAt(0),
        item.document.positionAt(current.length)
      );
      edit.replace(item.document.uri, fullRange, item.change.updated);
    }

    if (!await vscode.workspace.applyEdit(edit)) {
      throw new Error("M3 could not apply the approved changes.");
    }

    this.lastAppliedChanges = approved.map((item) => ({
      uri: item.document.uri,
      path: item.change.path,
      original: item.change.original,
      updated: item.change.updated,
      originalHash: item.review.originalHash,
      updatedHash: contentHash(item.change.updated)
    }));

    changeSet.appliedSnapshot = this.lastAppliedChanges.map((item) => ({
      path: item.path,
      original: item.original,
      updated: item.updated
    }));
    changeSet.status = approved.length === prepared.length
      ? "applied"
      : "partially_approved";
    changeSet.audit.push({
      at: Date.now(),
      action: "applied",
      detail: `${approved.length}/${prepared.length} files`
    });
    this.store.update(changeSet);

    for (const item of approved) {
      const document = await vscode.workspace.openTextDocument(item.document.uri);
      await document.save();
    }

    vscode.window.showInformationMessage(
      `M3 applied ${approved.length} approved file change${approved.length === 1 ? "" : "s"} (${changeSet.name}).`
    );
  }

  async rollbackLast(): Promise<void> {
    flow("CodeChangeApplier.rollbackLast", 1, "enter");
    const changeSet = this.store.latestApplied();
    const targets = this.lastAppliedChanges.length > 0
      ? this.lastAppliedChanges
      : (changeSet?.appliedSnapshot ?? []).map((item) => {
          const workspace = vscode.workspace.workspaceFolders?.[0];
          if (!workspace) {
            throw new Error("M3 cannot roll back without an open workspace.");
          }
          return {
            uri: vscode.Uri.joinPath(workspace.uri, ...item.path.split("/")),
            path: item.path,
            original: item.original,
            updated: item.updated,
            originalHash: hashContent(item.original),
            updatedHash: hashContent(item.updated)
          };
        });

    if (targets.length === 0) {
      vscode.window.showInformationMessage("M3 has no approved changes to roll back.");
      return;
    }

    assertWorkspaceTrusted(vscode.workspace.isTrusted);

    const edit = new vscode.WorkspaceEdit();

    for (const change of targets) {
      const document = await vscode.workspace.openTextDocument(change.uri);

      assertFileNotStale(
        change.path,
        document.getText(),
        change.updated,
        "rollback"
      );
      assertFileHashMatches(
        change.path,
        document.getText(),
        change.updatedHash,
        "rollback"
      );

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

    for (const change of targets) {
      const document = await vscode.workspace.openTextDocument(change.uri);
      await document.save();
    }

    if (changeSet) {
      changeSet.status = "rolled_back";
      changeSet.audit.push({
        at: Date.now(),
        action: "rolled_back",
        detail: `${targets.length} file(s)`
      });
      this.store.update(changeSet);
    }

    this.lastAppliedChanges = [];
    vscode.window.showInformationMessage(
      changeSet
        ? `M3 rolled back "${changeSet.name}".`
        : "M3 rolled back the last approved changes."
    );
  }
}
