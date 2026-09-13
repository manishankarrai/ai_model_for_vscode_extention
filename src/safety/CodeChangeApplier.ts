import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { CodeChange, TaskContract } from "../models/types";
import { flow } from "../utils/flowLog";

import {
  ChangeSetStore,
  contentHash,
  createNamedChangeSet,
  NamedChangeSet,
  applyHunkApprovals,
  splitHunks,
  DiffHunk
} from "./changeSets";
import {
  assertFileHashMatches,
  assertFileNotStale,
  assertNotSensitivePath,
  assertWorkspaceTrusted,
  assertChangesWithinTaskScope,
  hashContent,
  resolveApplyContent,
  validateChangeSize,
  validateWorkspaceRelativePath
} from "./changeValidation";

const MAX_CHANGES = 1000;

export interface AppliedChangeSummary {
  path: string;
  original: string;
  updated: string;
  diff: string;
}

export interface PendingFileReview {
  path: string;
  original: string;
  updated: string;
  created: boolean;
  deleted: boolean;
  uri: vscode.Uri;
  previousPath?: string;
  previousUri?: vscode.Uri;
  hunks?: DiffHunk[];
}

function buildUnifiedDiff(path: string, original: string, updated: string): string {
  const before = original.split("\n");
  const after = updated.split("\n");
  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`];
  const max = Math.max(before.length, after.length);
  let hunkStart = 1;
  const hunk: string[] = [];
  for (let i = 0; i < max; i += 1) {
    const left = before[i];
    const right = after[i];
    if (left === right) {
      continue;
    }
    if (left !== undefined) {
      hunk.push(`-${left}`);
    }
    if (right !== undefined) {
      hunk.push(`+${right}`);
    }
  }
  if (hunk.length === 0) {
    return `--- a/${path}\n+++ b/${path}\n@@ No changes @@`;
  }
  lines.push(`@@ updated ${path} @@`);
  // Keep diffs readable in chat.
  lines.push(...hunk.slice(0, 200));
  if (hunk.length > 200) {
    lines.push(`... (${hunk.length - 200} more changed lines)`);
  }
  return lines.join("\n");
}


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
  private readonly pendingReviews = new Map<string, PendingFileReview>();

  getChangeSets(): NamedChangeSet[] {
    flow("CodeChangeApplier.getChangeSets", 1, "enter");
    return this.store.list();
  }

  async offer(
    changes: CodeChange[],
    changeSetName?: string,
    contract?: TaskContract
  ): Promise<AppliedChangeSummary[]> {
    return this.applyAutomatically(changes, changeSetName, contract, true);
  }

  /**
   * Apply file edits during continuous agent work without user approval.
   * Returns per-file diffs for chat display.
   */
  async applyAutomatically(
    changes: CodeChange[],
    changeSetName?: string,
    contract?: TaskContract,
    reviewOnly = false
  ): Promise<AppliedChangeSummary[]> {
    if (changes.length === 0) {
      return [];
    }

    if (changes.length > MAX_CHANGES) {
      throw new Error("MM3 proposed too many file changes.");
    }

    assertWorkspaceTrusted(vscode.workspace.isTrusted);

    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      throw new Error("MM3 cannot apply changes without an open workspace.");
    }

    const changeSet = createNamedChangeSet(changes, changeSetName);
    this.store.record(changeSet);

    const summaries: AppliedChangeSummary[] = [];
    const appliedItems: Array<{
      uri: vscode.Uri;
      path: string;
      original: string;
      updated: string;
      originalHash: string;
      updatedHash: string;
      created: boolean;
    }> = [];

    const fileExists = async (uri: vscode.Uri): Promise<boolean> => {
      try {
        await vscode.workspace.fs.stat(uri);
        return true;
      } catch {
        return false;
      }
    };

    if (contract) {
      const scopedChanges: CodeChange[] = [];
      for (const change of changes) {
        const relativePath = validateWorkspaceRelativePath(change.path);
        const uri = vscode.Uri.joinPath(
          workspace.uri,
          ...relativePath.split("/")
        );
        const exists = await fileExists(uri);
        const current = exists
          ? (await vscode.workspace.openTextDocument(uri)).getText()
          : "";
        const updated = exists
          ? resolveApplyContent(current, change.original ?? "", change.updated ?? "")
          : change.updated ?? "";
        scopedChanges.push({
          path: relativePath,
          original: current,
          updated
        });
      }
      assertChangesWithinTaskScope(scopedChanges, contract);
    }

    const errors: string[] = [];

    for (const change of changes) {
      try {
        validateChangeSize(change.path, change.original ?? "", change.updated ?? "");
        const relativePath = validateWorkspaceRelativePath(change.path);
        assertNotSensitivePath(relativePath);

        const uri = vscode.Uri.joinPath(
          workspace.uri,
          ...relativePath.split("/")
        );
        const review = changeSet.files.find((file) => file.path === change.path)!;
        const exists = await fileExists(uri);
        const createNew = !exists;
        let originalText = "";
        let updatedText = change.updated ?? "";

        if (createNew) {
          const parent = vscode.Uri.joinPath(uri, "..");
          if (!reviewOnly) {
            await vscode.workspace.fs.createDirectory(parent);
            await vscode.workspace.fs.writeFile(
              uri,
              new TextEncoder().encode(updatedText)
            );
          }
        } else {
          const document = await vscode.workspace.openTextDocument(uri);
          const current = document.getText();
          const next = resolveApplyContent(
            current,
            change.original ?? "",
            change.updated ?? ""
          );
          originalText = current;
          updatedText = next;

          if (!reviewOnly) {
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
              document.positionAt(0),
              document.positionAt(current.length)
            );
            edit.replace(document.uri, fullRange, next);
            if (!await vscode.workspace.applyEdit(edit)) {
              throw new Error(`Could not update ${relativePath}.`);
            }
          }
        }

        if (!reviewOnly) {
          const saved = await vscode.workspace.openTextDocument(uri);
          await saved.save();
        }

        if (!reviewOnly) {
          changeSet.approvedPaths.push(change.path);
          changeSet.approvedHunkIds.push(
            ...review.hunks.map((hunk) => hunk.id)
          );
        }

        if (!reviewOnly) {
          appliedItems.push({
            uri,
            path: change.path,
            original: originalText,
            updated: updatedText,
            originalHash: hashContent(originalText),
            updatedHash: contentHash(updatedText),
            created: createNew
          });
        }
        this.upsertPending({
          path: change.path,
          original: originalText,
          updated: updatedText,
          created: createNew,
          deleted: false,
          uri,
          hunks: splitHunks(change.path, originalText, updatedText)
        });
        summaries.push({
          path: change.path,
          original: originalText,
          updated: updatedText,
          diff: buildUnifiedDiff(
            change.path,
            originalText,
            updatedText
          )
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${change.path}: ${message}`);
      }
    }

    this.lastAppliedChanges = appliedItems.map((item) => ({
      uri: item.uri,
      path: item.path,
      original: item.original,
      updated: item.updated,
      originalHash: item.originalHash,
      updatedHash: item.updatedHash
    }));

    changeSet.appliedSnapshot = appliedItems.map((item) => ({
      path: item.path,
      original: item.original,
      updated: item.updated
    }));
    changeSet.status = reviewOnly
      ? (summaries.length > 0 ? "proposed" : "rejected")
      : (summaries.length > 0 ? "applied" : "rejected");
    changeSet.audit.push({
      at: Date.now(),
      action: summaries.length > 0 ? "applied" : "rejected",
      detail: `${summaries.length}/${changes.length} files (${reviewOnly ? "queued for review" : "auto-applied"})`
    });
    this.store.update(changeSet);

    if (summaries.length === 0 && errors.length > 0) {
      throw new Error(errors.join("\n"));
    }

    return summaries;
  }

  getSessionDiffs(): AppliedChangeSummary[] {
    const changeSet = this.store.latestApplied();
    const snapshot = this.lastAppliedChanges.length > 0
      ? this.lastAppliedChanges
      : (changeSet?.appliedSnapshot ?? []);
    return snapshot.map((item) => ({
      path: item.path,
      original: item.original,
      updated: item.updated,
      diff: buildUnifiedDiff(item.path, item.original, item.updated)
    }));
  }

  async rollbackLast(): Promise<void> {
    flow("CodeChangeApplier.rollbackLast", 1, "enter");
    const changeSet = this.store.latestApplied();
    const targets = this.lastAppliedChanges.length > 0
      ? this.lastAppliedChanges
      : (changeSet?.appliedSnapshot ?? []).map((item) => {
          const workspace = vscode.workspace.workspaceFolders?.[0];
          if (!workspace) {
            throw new Error("MM3 cannot roll back without an open workspace.");
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
      vscode.window.showInformationMessage("MM3 has no approved changes to roll back.");
      return;
    }

    assertWorkspaceTrusted(vscode.workspace.isTrusted);

    const edit = new vscode.WorkspaceEdit();

    for (const change of targets) {
      if (!change.original) {
        edit.deleteFile(change.uri, { ignoreIfNotExists: true });
        continue;
      }

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
      throw new Error("MM3 could not roll back the approved changes.");
    }

    for (const change of targets) {
      if (!change.original) {
        continue;
      }
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
    this.dismissPending();
    vscode.window.showInformationMessage(
      changeSet
        ? `MM3 rolled back "${changeSet.name}".`
        : "MM3 rolled back the last approved changes."
    );
  }

  getPendingReviews(): PendingFileReview[] {
    flow("CodeChangeApplier.getPendingReviews", 1, "enter");
    return [...this.pendingReviews.values()];
  }

  async applyApprovedHunks(
    filePath: string,
    hunkIds: string[]
  ): Promise<void> {
    flow("CodeChangeApplier.applyApprovedHunks", 1, "enter", { filePath });
    const item = this.pendingReviews.get(filePath);
    if (!item || item.deleted || item.created) {
      throw new Error(`No editable hunks are available for ${filePath}.`);
    }

    assertWorkspaceTrusted(vscode.workspace.isTrusted);
    const document = await vscode.workspace.openTextDocument(item.uri);
    const current = document.getText();
    if (current !== item.original && current !== item.updated) {
      assertFileNotStale(filePath, current, item.updated, "apply");
    }
    const hunks = item.hunks ?? splitHunks(filePath, item.original, item.updated);
    const merged = applyHunkApprovals(item.original, item.updated, hunkIds, hunks);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      item.uri,
      new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      ),
      merged
    );
    if (!await vscode.workspace.applyEdit(edit)) {
      throw new Error(`Could not apply selected hunks for ${filePath}.`);
    }
    const saved = await vscode.workspace.openTextDocument(item.uri);
    await saved.save();
    item.updated = merged;
    item.hunks = splitHunks(filePath, item.original, merged);
  }

  async acceptFile(filePath: string): Promise<void> {
    flow("CodeChangeApplier.acceptFile", 1, "enter", { filePath });
    const item = this.pendingReviews.get(filePath);
    if (!item) {
      return;
    }
    if (item.previousUri && item.previousPath) {
      const edit = new vscode.WorkspaceEdit();
      edit.renameFile(item.previousUri, item.uri, { overwrite: false });
      if (!await vscode.workspace.applyEdit(edit)) {
        throw new Error(`Could not move ${filePath}.`);
      }
    } else if (item.created) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(item.uri, ".."));
      await vscode.workspace.fs.writeFile(item.uri, new TextEncoder().encode(item.updated));
    } else if (item.deleted) {
      await vscode.workspace.fs.delete(item.uri, { useTrash: false });
    } else {
      const document = await vscode.workspace.openTextDocument(item.uri);
      const current = document.getText();
      if (current !== item.original && current !== item.updated) {
        throw new Error(`File changed while reviewing ${filePath}.`);
      }
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        item.uri,
        new vscode.Range(document.positionAt(0), document.positionAt(current.length)),
        item.updated
      );
      if (!await vscode.workspace.applyEdit(edit)) {
        throw new Error(`Could not apply ${filePath}.`);
      }
      const saved = await vscode.workspace.openTextDocument(item.uri);
      await saved.save();
    }
    this.pendingReviews.delete(filePath);
  }

  async acceptAll(): Promise<void> {
    flow("CodeChangeApplier.acceptAll", 1, "enter");
    for (const filePath of [...this.pendingReviews.keys()]) {
      await this.acceptFile(filePath);
    }
  }

  dismissPending(): void {
    flow("CodeChangeApplier.dismissPending", 1, "enter");
    this.pendingReviews.clear();
  }

  async rejectFile(filePath: string): Promise<void> {
    flow("CodeChangeApplier.rejectFile", 1, "enter", { filePath });
    const item = this.pendingReviews.get(filePath);
    if (!item) {
      return;
    }

    assertWorkspaceTrusted(vscode.workspace.isTrusted);

    if (item.previousUri && item.previousPath) {
      const edit = new vscode.WorkspaceEdit();
      try {
        await vscode.workspace.fs.stat(item.uri);
        edit.renameFile(item.uri, item.previousUri, { overwrite: true });
      } catch {
        const parent = vscode.Uri.joinPath(item.previousUri, "..");
        await vscode.workspace.fs.createDirectory(parent);
        await vscode.workspace.fs.writeFile(
          item.previousUri,
          new TextEncoder().encode(item.original)
        );
        try {
          await vscode.workspace.fs.delete(item.uri, { useTrash: false });
        } catch {
          // Target may already be gone.
        }
      }
      if (edit.size > 0 && !await vscode.workspace.applyEdit(edit)) {
        throw new Error(`Could not restore ${item.previousPath}.`);
      }
      if (item.original) {
        const restored = await vscode.workspace.openTextDocument(item.previousUri);
        await restored.save();
      }
      this.pendingReviews.delete(filePath);
      return;
    }

    if (item.deleted) {
      const parent = vscode.Uri.joinPath(item.uri, "..");
      await vscode.workspace.fs.createDirectory(parent);
      await vscode.workspace.fs.writeFile(
        item.uri,
        new TextEncoder().encode(item.original)
      );
      this.pendingReviews.delete(filePath);
      return;
    }

    if (item.created && !item.original) {
      const edit = new vscode.WorkspaceEdit();
      edit.deleteFile(item.uri, { ignoreIfNotExists: true });
      if (!await vscode.workspace.applyEdit(edit)) {
        throw new Error(`Could not remove ${filePath}.`);
      }
      this.pendingReviews.delete(filePath);
      return;
    }

    const document = await vscode.workspace.openTextDocument(item.uri);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      item.uri,
      new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      ),
      item.original
    );
    if (!await vscode.workspace.applyEdit(edit)) {
      throw new Error(`Could not revert ${filePath}.`);
    }
    const saved = await vscode.workspace.openTextDocument(item.uri);
    await saved.save();
    this.pendingReviews.delete(filePath);
  }

  async showFileDiff(filePath: string): Promise<void> {
    flow("CodeChangeApplier.showFileDiff", 1, "enter", { filePath });
    const item = this.pendingReviews.get(filePath);
    if (!item) {
      vscode.window.showInformationMessage("That file is no longer pending review.");
      return;
    }

    const tmpDir = path.join(os.tmpdir(), "mm3-ai-diff");
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(tmpDir));
    const safe = filePath.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const leftUri = vscode.Uri.file(path.join(tmpDir, `${safe}.original`));
    await vscode.workspace.fs.writeFile(
      leftUri,
      new TextEncoder().encode(item.original)
    );
    await vscode.workspace.openTextDocument(leftUri);

    let rightUri = item.uri;
    if (item.deleted) {
      rightUri = vscode.Uri.file(path.join(tmpDir, `${safe}.current`));
      await vscode.workspace.fs.writeFile(
        rightUri,
        new TextEncoder().encode(item.updated)
      );
    }

    await vscode.commands.executeCommand(
      "vscode.diff",
      leftUri,
      rightUri,
      `${filePath} (original ↔ current)`
    );
  }

  async deleteAndRecord(relativePath: string): Promise<AppliedChangeSummary> {
    flow("CodeChangeApplier.deleteAndRecord", 1, "enter", { relativePath });
    assertWorkspaceTrusted(vscode.workspace.isTrusted);
    const uri = this.resolveWorkspaceUri(relativePath);
    const document = await vscode.workspace.openTextDocument(uri);
    const original = document.getText();
    this.upsertPending({
      path: relativePath,
      original,
      updated: "",
      created: false,
      deleted: true,
      uri
    });
    return {
      path: relativePath,
      original,
      updated: "",
      diff: buildUnifiedDiff(relativePath, original, "")
    };
  }

  async moveAndRecord(
    fromPath: string,
    toPath: string
  ): Promise<AppliedChangeSummary> {
    flow("CodeChangeApplier.moveAndRecord", 1, "enter", { fromPath, toPath });
    assertWorkspaceTrusted(vscode.workspace.isTrusted);
    const fromUri = this.resolveWorkspaceUri(fromPath);
    const toUri = this.resolveWorkspaceUri(toPath);
    const document = await vscode.workspace.openTextDocument(fromUri);
    const original = document.getText();
    this.upsertPending({
      path: toPath,
      original,
      updated: original,
      created: true,
      deleted: false,
      uri: toUri,
      previousPath: fromPath,
      previousUri: fromUri
    });
    return {
      path: toPath,
      original,
      updated: original,
      diff: buildUnifiedDiff(toPath, original, original)
    };
  }

  private upsertPending(next: PendingFileReview): void {
    const existing = this.pendingReviews.get(next.path);
    if (!existing) {
      this.pendingReviews.set(next.path, next);
      return;
    }
    this.pendingReviews.set(next.path, {
      ...existing,
      updated: next.updated,
      created: existing.created || next.created,
      deleted: next.deleted,
      uri: next.uri,
      previousPath: next.previousPath ?? existing.previousPath,
      previousUri: next.previousUri ?? existing.previousUri
    });
  }

  private resolveWorkspaceUri(relativePath: string): vscode.Uri {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      throw new Error("MM3 cannot apply changes without an open workspace.");
    }
    const normalized = validateWorkspaceRelativePath(relativePath);
    assertNotSensitivePath(normalized);
    return vscode.Uri.joinPath(workspace.uri, ...normalized.split("/"));
  }
}
