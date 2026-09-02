import * as vscode from "vscode";

import {
  IndexedFile,
  ProjectFile,
  ProjectIndex
} from "../models/types";

import { ProjectScanner } from "./ProjectScanner";
import { SymbolIndexer } from "./SymbolIndexer";
import { DependencyDetector } from "./DependencyDetector";

import {
  readTextFile
} from "../utils/FileUtils";

export class ProjectIndexer {

  private index: ProjectIndex | undefined;

  private readonly scanner =
    new ProjectScanner();

  private readonly symbolIndexer =
    new SymbolIndexer();

  private readonly dependencyDetector =
    new DependencyDetector();

  getIndex(): ProjectIndex | undefined {
    return this.index;
  }

  async build(
    rootUri: vscode.Uri
  ): Promise<ProjectIndex> {

    const files =
      await this.scanner.scan(
        rootUri
      );

    const previous =
      this.index;

    const indexedFiles =
      new Map<string, IndexedFile>();

    const allSymbols = [];
    const allDependencies = [];

    for (const file of files) {

      const previousFile =
        previous?.files.get(file.path);

      // ------------------------------------------------------
      // Incremental optimization
      // ------------------------------------------------------

      if (
        previousFile &&
        previousFile.file.hash === file.hash
      ) {

        indexedFiles.set(
          file.path,
          previousFile
        );

        allSymbols.push(
          ...previousFile.symbols
        );

        allDependencies.push(
          ...previousFile.dependencies
        );

        continue;
      }

      // ------------------------------------------------------
      // Changed/new file
      // ------------------------------------------------------

      const content =
        await readTextFile(
          vscode.Uri.file(
            file.absolutePath
          )
        );

      const symbols =
        await this.symbolIndexer.indexFile(
          file
        );

      const dependencies =
        this.dependencyDetector.detect(
          file.path,
          content
        );

      const indexed: IndexedFile = {
        file,

        symbols,

        dependencies
      };

      indexedFiles.set(
        file.path,
        indexed
      );

      allSymbols.push(
        ...symbols
      );

      allDependencies.push(
        ...dependencies
      );
    }

    const version =
      (previous?.version ?? 0) + 1;

    this.index = {
      rootPath: rootUri.fsPath,

      version,

      files: indexedFiles,

      symbols: allSymbols,

      dependencies: allDependencies,

      createdAt:
        previous?.createdAt ??
        Date.now(),

      updatedAt: Date.now()
    };

    return this.index;
  }

  async updateFile(
    uri: vscode.Uri
  ): Promise<void> {

    if (!this.index) {
      return;
    }

    const rootUri =
      vscode.Uri.file(
        this.index.rootPath
      );

    await this.build(rootUri);
  }

  removeFile(
    absolutePath: string
  ): void {

    if (!this.index) {
      return;
    }

    for (
      const [
        relativePath,
        indexed
      ] of this.index.files
    ) {

      if (
        indexed.file.absolutePath ===
        absolutePath
      ) {

        this.index.files.delete(
          relativePath
        );
      }
    }

    this.rebuildAggregates();
  }

  private rebuildAggregates(): void {

    if (!this.index) {
      return;
    }

    this.index.symbols = [];

    this.index.dependencies = [];

    for (
      const indexed of this.index.files.values()
    ) {

      this.index.symbols.push(
        ...indexed.symbols
      );

      this.index.dependencies.push(
        ...indexed.dependencies
      );
    }

    this.index.version++;

    this.index.updatedAt =
      Date.now();
  }
}