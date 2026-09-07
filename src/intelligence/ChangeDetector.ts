import * as vscode from "vscode";

import { ProjectIndexer } from "./ProjectIndexer";

import {
  isIgnoredPath
} from "../utils/FileUtils";

import { Logger } from "../utils/Logger";

import { flow } from "../utils/flowLog";

export class ChangeDetector
  implements vscode.Disposable {

  private readonly watcher:
    vscode.FileSystemWatcher;

  constructor(
    private readonly indexer: ProjectIndexer,
    private readonly logger: Logger
  ) {

    this.watcher =
      vscode.workspace.createFileSystemWatcher(
        "**/*"
      );

    this.watcher.onDidCreate(
      uri => this.handleCreate(uri)
    );

    this.watcher.onDidChange(
      uri => this.handleChange(uri)
    );

    this.watcher.onDidDelete(
      uri => this.handleDelete(uri)
    );
  }

  private async handleCreate(
    uri: vscode.Uri
  ): Promise<void> {

    if (
      isIgnoredPath(uri.fsPath)
    ) {
      return;
    }

    this.logger.info(
      "File created",
      uri.fsPath
    );

    await this.indexer.updateFile(
      uri
    );
  }

  private async handleChange(
    uri: vscode.Uri
  ): Promise<void> {

    if (
      isIgnoredPath(uri.fsPath)
    ) {
      return;
    }

    this.logger.info(
      "File changed",
      uri.fsPath
    );

    await this.indexer.updateFile(
      uri
    );
  }

  private handleDelete(
    uri: vscode.Uri
  ): void {

    if (
      isIgnoredPath(uri.fsPath)
    ) {
      return;
    }

    this.logger.info(
      "File deleted",
      uri.fsPath
    );

    this.indexer.removeFile(
      uri.fsPath
    );
  }

  dispose(): void {
    flow("ChangeDetector.dispose", 1, "enter");
    this.watcher.dispose();
  }
}