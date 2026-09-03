import {
  ProjectIndex,
  SymbolInfo
} from "../models/types";

export interface SymbolRelationship {
  from: SymbolInfo;
  to: SymbolInfo;
  type:
    | "same_file"
    | "name_reference"
    | "dependency";
  reason: string;
}

export class SymbolRelationshipGraph {

  private readonly relationships =
    new Map<string, SymbolRelationship[]>();

  build(
    index: ProjectIndex
  ): void {

    this.relationships.clear();

    /*
     * Build relationships between symbols that belong
     * to the same file.
     */
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
            from: source,
            to: target,
            type: "same_file",
            reason:
              "symbols are defined in the same file"
          });
        }
      }
    }

    /*
     * Build relationships based on symbol names
     * appearing in other indexed files.
     *
     * Example:
     *
     * GenerateToken()
     *      ↓
     * JwtSecret
     */
    for (
      const indexed of index.files.values()
    ) {

      const contentSymbols =
        indexed.symbols;

      for (
        const source of contentSymbols
      ) {

        for (
          const target of index.symbols
        ) {

          if (
            source.name === target.name
          ) {
            continue;
          }

          if (
            source.filePath ===
            target.filePath
          ) {
            continue;
          }

          /*
           * We cannot know the exact call/reference
           * relationship from the symbol index alone.
           *
           * Therefore this graph only creates a
           * relationship when the target symbol's
           * name appears in the source symbol's file.
           */
          const sourceFile =
            index.files.get(
              source.filePath
            );

          if (!sourceFile) {
            continue;
          }

          /*
           * The actual source text is not stored in
           * ProjectIndex, so this relationship is
           * intentionally handled by the async method
           * below instead.
           */
        }
      }
    }
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
          from: source,
          to: target,
          type: "name_reference",
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
            from: source,
            to: target,
            type: "dependency",
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

    const key =
      this.symbolKey(symbol);

    return [
      ...(this.relationships.get(key) ?? [])
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
        const relationship of relationships
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

  getRelationships(): SymbolRelationship[] {

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
            relationship.type
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
}