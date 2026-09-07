import * as vscode from "vscode";

import { flow } from "../utils/flowLog";

import {
  ProjectIndex,
  SymbolInfo
} from "../models/types";

import {
  Logger
} from "../utils/Logger";

export interface SymbolRelationship {
  from: SymbolInfo;
  to: SymbolInfo;

  type:
    | "same_file"
    | "name_reference"
    | "call"
    | "dependency";

  direction:
    | "outgoing"
    | "incoming";

  reason: string;
}

export class SymbolRelationshipGraph {

  private readonly relationships =
    new Map<string, SymbolRelationship[]>();

  constructor(
    private readonly logger: Logger
  ) {}

  build(
    index: ProjectIndex
  ): void {

    this.relationships.clear();

    this.logger.info(
      "Building symbol relationship graph",
      {
        files:
          index.files.size,

        symbols:
          index.symbols.length
      }
    );

    for (
      const indexed of index.files.values()
    ) {

      const symbols =
        indexed.symbols;

      for (
        let i = 0;
        i < symbols.length;
        i++
      ) {

        const source =
          symbols[i];

        for (
          let j = 0;
          j < symbols.length;
          j++
        ) {

          if (i === j) {
            continue;
          }

          const target =
            symbols[j];

          this.addRelationship({
            from:
              source,

            to:
              target,

            type:
              "same_file",

            direction:
              "outgoing",

            reason:
              "symbols are defined in the same file"
          });
        }
      }
    }

    this.logger.info(
      "Symbol relationship graph built",
      {
        relationships:
          this.getRelationshipCount()
      }
    );
  }

  async buildCallRelationships(
    filePath: string,
    index: ProjectIndex
  ): Promise<void> {

    const indexedFile =
      index.files.get(
        filePath
      );

    if (!indexedFile) {
      return;
    }

    const symbols =
      indexedFile.symbols;

    if (
      symbols.length === 0
    ) {
      return;
    }

    this.logger.info(
      "Building call relationships",
      {
        file:
          filePath,

        symbols:
          symbols.length
      }
    );

    const document =
      await vscode.workspace.openTextDocument(
        vscode.Uri.file(
          indexedFile.file.absolutePath
        )
      );

    let discovered =
      0;

    for (
      const symbol of symbols
    ) {

      try {

        const position =
          new vscode.Position(
            Math.max(
              0,
              symbol.line - 1
            ),
            Math.max(
              0,
              symbol.character
            )
          );

        const hierarchy =
          await vscode.commands.executeCommand<
            vscode.CallHierarchyItem[] | undefined
          >(
            "vscode.prepareCallHierarchy",
            document.uri,
            position
          );

        if (
          !hierarchy ||
          hierarchy.length === 0
        ) {
          continue;
        }

        for (
          const item of hierarchy
        ) {

          await this.addOutgoingCalls(
            item,
            symbol,
            index
          );

          await this.addIncomingCalls(
            item,
            symbol,
            index
          );

          discovered++;
        }

      } catch (error) {

        this.logger.info(
          "Call hierarchy unavailable for symbol",
          {
            file:
              filePath,

            symbol:
              symbol.name,

            error:
              error instanceof Error
                ? error.message
                : String(error)
          }
        );
      }
    }

    this.logger.info(
      "Call relationships built",
      {
        file:
          filePath,

        symbols:
          symbols.length,

        hierarchyItems:
          discovered,

        relationships:
          this.getRelationshipCount()
      }
    );
  }

  addFileReferenceRelationships(
    filePath: string,
    content: string,
    index: ProjectIndex
  ): void {

    const sourceSymbols =
      index.files.get(
        filePath
      )?.symbols ?? [];

    if (
      sourceSymbols.length === 0
    ) {
      return;
    }

    for (
      const target of index.symbols
    ) {

      if (
        target.filePath === filePath
      ) {
        continue;
      }

      if (
        !this.containsSymbolReference(
          content,
          target.name
        )
      ) {
        continue;
      }

      for (
        const source of sourceSymbols
      ) {

        this.addRelationship({
          from:
            source,

          to:
            target,

          type:
            "name_reference",

          direction:
            "outgoing",

          reason:
            `symbol "${target.name}" is referenced from ${filePath}`
        });
      }
    }
  }

  addDependencyRelationships(
    sourceFile: string,
    targetFiles: string[],
    index: ProjectIndex
  ): void {

    const sourceSymbols =
      index.files.get(
        sourceFile
      )?.symbols ?? [];

    for (
      const targetFile of targetFiles
    ) {

      const targetSymbols =
        index.files.get(
          targetFile
        )?.symbols ?? [];

      for (
        const source of sourceSymbols
      ) {

        for (
          const target of targetSymbols
        ) {

          this.addRelationship({
            from:
              source,

            to:
              target,

            type:
              "dependency",

            direction:
              "outgoing",

            reason:
              `${sourceFile} depends on ${targetFile}`
          });
        }
      }
    }
  }

  getRelatedSymbols(
    symbol: SymbolInfo
  ): SymbolRelationship[] {

    return [
      ...(
        this.relationships.get(
          this.symbolKey(symbol)
        ) ?? []
      )
    ];
  }

  getRelatedSymbolsByName(
    name: string
  ): SymbolRelationship[] {

    const results:
      SymbolRelationship[] = [];

    for (
      const relationships
        of this.relationships.values()
    ) {

      for (
        const relationship
          of relationships
      ) {

        if (
          relationship.from.name
            .toLowerCase()
            .includes(
              name.toLowerCase()
            ) ||
          relationship.to.name
            .toLowerCase()
            .includes(
              name.toLowerCase()
            )
        ) {

          results.push(
            relationship
          );
        }
      }
    }

    return results;
  }

  getRelationships():
    SymbolRelationship[] {

    const results:
      SymbolRelationship[] = [];

    for (
      const relationships
        of this.relationships.values()
    ) {

      results.push(
        ...relationships
      );
    }

    return results;
  }

  private async addOutgoingCalls(
    item: vscode.CallHierarchyItem,
    sourceSymbol: SymbolInfo,
    index: ProjectIndex
  ): Promise<void> {

    const calls =
      await vscode.commands.executeCommand<
        vscode.CallHierarchyOutgoingCall[] | undefined
      >(
        "vscode.provideOutgoingCalls",
        item
      );

    if (!calls) {
      return;
    }

    for (
      const call of calls
    ) {

      const target =
        this.findSymbol(
          call.to,
          index
        );

      if (!target) {
        continue;
      }

      this.addRelationship({
        from:
          sourceSymbol,

        to:
          target,

        type:
          "call",

        direction:
          "outgoing",

        reason:
          `${sourceSymbol.name} calls ${target.name}`
      });
    }
  }

  private async addIncomingCalls(
    item: vscode.CallHierarchyItem,
    targetSymbol: SymbolInfo,
    index: ProjectIndex
  ): Promise<void> {

    const calls =
      await vscode.commands.executeCommand<
        vscode.CallHierarchyIncomingCall[] | undefined
      >(
        "vscode.provideIncomingCalls",
        item
      );

    if (!calls) {
      return;
    }

    for (
      const call of calls
    ) {

      const source =
        this.findSymbol(
          call.from,
          index
        );

      if (!source) {
        continue;
      }

      this.addRelationship({
        from:
          source,

        to:
          targetSymbol,

        type:
          "call",

        direction:
          "incoming",

        reason:
          `${source.name} calls ${targetSymbol.name}`
      });
    }
  }

  private findSymbol(
    item: vscode.CallHierarchyItem,
    index: ProjectIndex
  ): SymbolInfo | undefined {

    const filePath =
      this.getRelativePath(
        item.uri,
        index
      );

    if (!filePath) {
      return undefined;
    }

    const line =
      item.range.start.line + 1;

    const sameLine =
      index.symbols.filter(
        symbol =>
          symbol.filePath === filePath &&
          symbol.line === line
      );

    if (
      sameLine.length === 1
    ) {
      return sameLine[0];
    }

    const sameName =
      index.symbols.find(
        symbol =>
          symbol.filePath === filePath &&
          symbol.name === item.name
      );

    return sameName;
  }

  private getRelativePath(
    uri: vscode.Uri,
    index: ProjectIndex
  ): string | undefined {

    const absolutePath =
      uri.fsPath.replace(
        /\\/g,
        "/"
      );

    for (
      const indexed of index.files.values()
    ) {

      const indexedPath =
        indexed.file.absolutePath
          .replace(
            /\\/g,
            "/"
          );

      if (
        indexedPath === absolutePath
      ) {

        return indexed.file.path;
      }
    }

    return undefined;
  }

  private addRelationship(
    relationship: SymbolRelationship
  ): void {

    const key =
      this.symbolKey(
        relationship.from
      );

    const existing =
      this.relationships.get(
        key
      ) ?? [];

    const alreadyExists =
      existing.some(
        item =>
          item.to.filePath ===
            relationship.to.filePath &&
          item.to.name ===
            relationship.to.name &&
          item.type ===
            relationship.type &&
          item.direction ===
            relationship.direction
      );

    if (
      alreadyExists
    ) {
      return;
    }

    existing.push(
      relationship
    );

    this.relationships.set(
      key,
      existing
    );
  }

  private containsSymbolReference(
    content: string,
    symbolName: string
  ): boolean {

    if (!symbolName.trim()) {
      return false;
    }

    const escaped =
      symbolName.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    const regex =
      new RegExp(
        `\\b${escaped}\\b`
      );

    return regex.test(
      content
    );
  }

  private symbolKey(
    symbol: SymbolInfo
  ): string {

    return [
      symbol.filePath,
      symbol.name,
      symbol.line
    ].join(":");
  }

  private getRelationshipCount(): number {
    flow("SymbolRelationshipGraph.getRelationshipCount", 1, "enter");

    let count = 0;

    for (
      const relationships
        of this.relationships.values()
    ) {

      count +=
        relationships.length;
    }

    return count;
  }
}