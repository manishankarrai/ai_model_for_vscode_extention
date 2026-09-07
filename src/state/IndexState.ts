import * as vscode from "vscode";

import { flow } from "../utils/flowLog";

import {
  ProjectIndex
} from "../models/types";

export class IndexState {

  private readonly key =
    "m3.index.metadata";

  constructor(
    private readonly storage:
      vscode.Memento
  ) {}

  async save(
    index: ProjectIndex
  ): Promise<void> {

    await this.storage.update(
      this.key,
      {
        rootPath: index.rootPath,

        version: index.version,

        fileCount: index.files.size,

        updatedAt: index.updatedAt
      }
    );
  }

  getMetadata(): unknown {
    flow("IndexState.getMetadata", 1, "enter");
    return this.storage.get(
      this.key
    );
  }

  async clear(): Promise<void> {
    flow("IndexState.clear", 1, "enter");

    await this.storage.update(
      this.key,
      undefined
    );
  }
}