import * as vscode from "vscode";

import { CodeChange } from "../models/types";
import { flow } from "../utils/flowLog";

import {
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

const MAX_CHANGES = 1000;

export interface AppliedChangeSummary {
  path: string;
  original: string;
  updated: string;
  diff: string;
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

  getChangeSets(): NamedChangeSet[] {
    flow("CodeChangeApplier.getChangeSets", 1, "enter");
    return this.store.list();
  }

  async offer(
    changes: CodeChange[],
    changeSetName?: string
  ): Promise<AppliedChangeSummary[]> {
    return this.applyAutomatically(changes, changeSetName);
  }

  /**
   * Apply file edits during continuous agent work without user approval.
   * Returns per-file diffs for chat display.
   */
  async applyAutomatically(
    changes: CodeChange[],
    changeSetName?: string
  ): Promise<AppliedChangeSummary[]> {
    if (changes.length === 0) {
      return [];
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

        if (createNew) {
          const parent = vscode.Uri.joinPath(uri, "..");
          await vscode.workspace.fs.createDirectory(parent);
          await vscode.workspace.fs.writeFile(
            uri,
            new TextEncoder().encode(change.updated)
          );
        } else {
          const document = await vscode.workspace.openTextDocument(uri);
          const current = document.getText();
          if ((change.original ?? "") !== "") {
            assertFileNotStale(
              change.path,
              current,
              change.original,
              "apply"
            );
            assertFileHashMatches(
              change.path,
              current,
              review.originalHash,
              "apply"
            );
          }

          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(current.length)
          );
          edit.replace(document.uri, fullRange, change.updated);
          if (!await vscode.workspace.applyEdit(edit)) {
            throw new Error(`Could not update ${relativePath}.`);
          }
        }

        const saved = await vscode.workspace.openTextDocument(uri);
        await saved.save();

        changeSet.approvedPaths.push(change.path);
        changeSet.approvedHunkIds.push(
          ...review.hunks.map((hunk) => hunk.id)
        );

        appliedItems.push({
          uri,
          path: change.path,
          original: createNew ? "" : change.original,
          updated: change.updated,
          originalHash: review.originalHash,
          updatedHash: contentHash(change.updated),
          created: createNew
        });
        summaries.push({
          path: change.path,
          original: createNew ? "" : change.original,
          updated: change.updated,
          diff: buildUnifiedDiff(
            change.path,
            createNew ? "" : change.original,
            change.updated
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
    changeSet.status = summaries.length > 0 ? "applied" : "rejected";
    changeSet.audit.push({
      at: Date.now(),
      action: summaries.length > 0 ? "applied" : "rejected",
      detail: `${summaries.length}/${changes.length} files (auto-applied)`
    });
    this.store.update(changeSet);

    if (summaries.length === 0 && errors.length > 0) {
      throw new Error(errors.join("\n"));
    }

    return summaries;
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
      throw new Error("M3 could not roll back the approved changes.");
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
    vscode.window.showInformationMessage(
      changeSet
        ? `M3 rolled back "${changeSet.name}".`
        : "M3 rolled back the last approved changes."
    );
  }
}
