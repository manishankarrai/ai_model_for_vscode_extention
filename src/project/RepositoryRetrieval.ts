import { promises as fs } from "node:fs";
import * as path from "node:path";

import { ProjectScanner, type ProjectIndexSnapshot, type ProjectScannerStorage } from "./ProjectScanner.ts";
import { SymbolIndex, type IndexedSymbol } from "./SymbolIndex.ts";
import { SearchEngine, type RankedSearchResult } from "./SearchEngine.ts";

export interface Relationship {
  from: string;
  to: string;
  kind: "reference" | "import";
}

export interface RetrievalResult {
  success: boolean;
  path?: string;
  output: string;
}

export class RepositoryRetrieval {
  readonly scanner: ProjectScanner;
  readonly symbols = new SymbolIndex();
  readonly searchEngine = new SearchEngine();
  private snapshot?: ProjectIndexSnapshot;
  private readonly contents = new Map<string, string>();
  private relationships: Relationship[] = [];

  constructor(storage?: ProjectScannerStorage) {
    this.scanner = new ProjectScanner(storage);
  }

  invalidatePath(filePath: string): void {
    this.scanner.invalidatePath(filePath);
  }

  async refresh(workspacePath: string): Promise<ProjectIndexSnapshot> {
    this.snapshot = await this.scanner.scan(workspacePath);
    const activePaths = new Set(this.snapshot.files.map((file) => file.path));
    for (const filePath of this.contents.keys()) {
      if (!activePaths.has(filePath)) {
        this.contents.delete(filePath);
        this.symbols.removeFile(filePath);
      }
    }

    for (const filePath of this.snapshot.changedPaths) {
      await this.indexFile(workspacePath, filePath);
    }
    if (this.symbols.getSymbols().length === 0 && this.snapshot.files.length > 0) {
      for (const file of this.snapshot.files) {
        await this.indexFile(workspacePath, file.path);
      }
    }
    this.relationships = this.buildRelationships();
    return this.snapshot;
  }

  async readFileRange(
    workspacePath: string,
    filePath: string,
    startLine = 1,
    endLine?: number
  ): Promise<RetrievalResult> {
    const safePath = this.validatePath(filePath);
    const content = await fs.readFile(path.join(workspacePath, ...safePath.split("/")), "utf8");
    const lines = content.split("\n");
    const first = Math.max(1, startLine);
    const last = Math.min(lines.length, endLine ?? first + 199);
    const selected = lines.slice(first - 1, last).join("\n");
    return {
      success: true,
      path: safePath,
      output: `file=${safePath}\nlines=${first}-${last}\n\n${selected}`
    };
  }

  async readSymbol(workspacePath: string, query: string, filePath?: string): Promise<RetrievalResult> {
    await this.ensureRefreshed(workspacePath);
    const found = this.symbols.getSymbol(query, filePath);
    if (!found) {
      return { success: false, output: `Symbol '${query}' was not found.` };
    }
    const result = await this.readFileRange(workspacePath, found.path, found.startLine, found.endLine);
    return {
      ...result,
      output: `symbol=${found.qualifiedName}\nkind=${found.kind}\n${result.output}`
    };
  }

  async searchSymbols(workspacePath: string, query: string): Promise<RetrievalResult> {
    await this.ensureRefreshed(workspacePath);
    const matches = this.symbols.find(query);
    return {
      success: true,
      output: matches.length === 0
        ? `No symbols matched '${query}'.`
        : matches.map((item) => this.formatSymbol(item)).join("\n")
    };
  }

  async search(workspacePath: string, query: string, limit = 50): Promise<RankedSearchResult[]> {
    await this.ensureRefreshed(workspacePath);
    return this.searchEngine.search(
      query,
      [...this.contents.entries()].map(([filePath, content]) => ({
        path: filePath,
        content,
        symbols: this.symbols.getSymbols(filePath)
      })),
      this.relationships,
      limit
    );
  }

  async getFileSummary(workspacePath: string, filePath: string): Promise<RetrievalResult> {
    await this.ensureRefreshed(workspacePath);
    const safePath = this.validatePath(filePath);
    const file = this.snapshot?.files.find((item) => item.path === safePath);
    if (!file) {
      return { success: false, output: `File '${safePath}' was not indexed.` };
    }
    const symbols = this.symbols.getSymbols(safePath);
    return {
      success: true,
      path: safePath,
      output: [
        `path=${file.path}`,
        `language=${file.language}`,
        `lines=${file.lines}`,
        `size=${file.size}`,
        `hash=${file.hash}`,
        `symbols=${symbols.map((item) => `${item.qualifiedName}:${item.kind}:${item.startLine}-${item.endLine}`).join(", ") || "none"}`
      ].join("\n")
    };
  }

  async getProjectSummary(workspacePath: string): Promise<RetrievalResult> {
    const snapshot = await this.ensureRefreshed(workspacePath);
    return {
      success: true,
      output: [
        `indexVersion=${snapshot.indexVersion}`,
        snapshot.summary,
        `symbols=${this.symbols.getSymbols().length}`,
        `relationships=${this.relationships.length}`
      ].join("\n")
    };
  }

  async findDefinition(workspacePath: string, query: string): Promise<RetrievalResult> {
    await this.ensureRefreshed(workspacePath);
    const found = this.symbols.find(query);
    return {
      success: found.length > 0,
      output: found.length > 0
        ? found.map((item) => this.formatSymbol(item)).join("\n")
        : `No definition matched '${query}'.`
    };
  }

  async findReferences(workspacePath: string, query: string): Promise<RetrievalResult> {
    await this.ensureRefreshed(workspacePath);
    const references = this.relationships.filter((item) => item.to === query || item.to.endsWith(`.${query}`));
    return { success: true, output: this.formatRelationships(references, `No references found for '${query}'.`) };
  }

  async findCallers(workspacePath: string, query: string): Promise<RetrievalResult> {
    await this.ensureRefreshed(workspacePath);
    const callers = this.relationships.filter((item) => item.kind === "reference" && (item.to === query || item.to.endsWith(`.${query}`)));
    return { success: true, output: this.formatRelationships(callers, `No callers found for '${query}'.`) };
  }

  async findCallees(workspacePath: string, query: string): Promise<RetrievalResult> {
    await this.ensureRefreshed(workspacePath);
    const callees = this.relationships.filter((item) => item.kind === "reference" && (item.from === query || item.from.endsWith(`.${query}`)));
    return { success: true, output: this.formatRelationships(callees, `No callees found for '${query}'.`) };
  }

  private async ensureRefreshed(workspacePath: string): Promise<ProjectIndexSnapshot> {
    return this.snapshot ?? this.refresh(workspacePath);
  }

  private async indexFile(workspacePath: string, filePath: string): Promise<void> {
    const content = await fs.readFile(path.join(workspacePath, ...filePath.split("/")), "utf8");
    this.contents.set(filePath, content);
    const file = this.snapshot?.files.find((item) => item.path === filePath);
    this.symbols.indexFile(filePath, file?.language ?? "Other", content);
  }

  private buildRelationships(): Relationship[] {
    const symbols = this.symbols.getSymbols();
    const byName = new Map<string, IndexedSymbol>();
    for (const item of symbols) {
      byName.set(item.name, item);
      byName.set(item.qualifiedName, item);
    }
    const relationships: Relationship[] = [];
    for (const source of symbols) {
      const content = this.contents.get(source.path) ?? "";
      for (const [name, target] of byName) {
        if (target.id === source.id || !new RegExp(`\\b${this.escapeRegExp(name)}\\b`).test(content)) {
          continue;
        }
        relationships.push({ from: source.qualifiedName, to: target.qualifiedName, kind: "reference" });
      }
    }
    return [...new Map(relationships.map((item) => [`${item.from}:${item.to}:${item.kind}`, item])).values()];
  }

  private formatSymbol(item: IndexedSymbol): string {
    return `${item.qualifiedName} kind=${item.kind} path=${item.path} lines=${item.startLine}-${item.endLine}`;
  }

  private formatRelationships(items: Relationship[], empty: string): string {
    return items.length > 0 ? items.map((item) => `${item.kind} ${item.from} -> ${item.to}`).join("\n") : empty;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private validatePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..") || /(?:^|\/)(?:\.env|.*\.(?:key|pem))$/i.test(normalized)) {
      throw new Error("Unsafe repository path.");
    }
    return normalized;
  }
}