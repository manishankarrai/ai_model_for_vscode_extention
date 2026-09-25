import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { ProjectScanner, type ProjectIndexSnapshot, type ProjectScannerStorage } from "./ProjectScanner.ts";
import { SymbolIndex, type IndexedSymbol, type SymbolIndexSnapshot } from "./SymbolIndex.ts";
import { SearchEngine, type RankedSearchResult } from "./SearchEngine.ts";
import { LocalSemanticIndex } from "./LocalSemanticIndex.ts";
import { CodeGraph, type CodeGraphSnapshot } from "./CodeGraph.ts";
import { flow } from "../utils/flowLog.ts";

type DependencyType = "dependency" | "devDependency" | "peerDependency" | "builtin" | "unknown";

interface DependencyMetadata {
  dependencyType: DependencyType;
  dependencyManager: "npm" | "go" | "python" | "cargo" | "jvm";
  dependencyName: string;
  dependencyVersion?: string;
}

interface PersistedSearchCache {
  indexVersion: number;
  entries: Array<{ key: string; results: RankedSearchResult[] }>;
}

export interface Relationship {
  from: string;
  to: string;
  kind: "reference" | "import" | "call" | "test" | "route" | "read" | "write";
  line?: number;
  provenance?: string;
  resolvedPath?: string;
  sourcePath?: string;
  confidence?: number;
  dependencyType?: DependencyType;
  dependencyManager?: DependencyMetadata["dependencyManager"];
  dependencyName?: string;
  dependencyVersion?: string;
}

export interface RetrievalResult {
  success: boolean;
  path?: string;
  output: string;
}

export interface RetrievalSearchTiming {
  semanticMs: number;
  rankingMs: number;
  totalMs: number;
  cacheHit: boolean;
}

export class RepositoryRetrieval {
  readonly scanner: ProjectScanner;
  readonly symbols = new SymbolIndex();
  readonly searchEngine = new SearchEngine();
  readonly semanticIndex: LocalSemanticIndex;
  readonly codeGraph = new CodeGraph();
  lastSearchTiming: RetrievalSearchTiming = { semanticMs: 0, rankingMs: 0, totalMs: 0, cacheHit: false };
  private snapshot?: ProjectIndexSnapshot;
  private readonly contents = new Map<string, string>();
  private relationships: Relationship[] = [];
  private readonly storage?: ProjectScannerStorage;
  private readonly semanticIndexedPaths = new Set<string>();
  private readonly searchCache = new Map<string, RankedSearchResult[]>();
  private workspacePath?: string;
  private restoredSearchCacheVersion?: number;

  constructor(storage?: ProjectScannerStorage, semanticIndex = new LocalSemanticIndex()) {
    this.storage = storage;
    this.semanticIndex = semanticIndex;
    this.scanner = new ProjectScanner(storage);
  }

  invalidatePath(filePath: string): void {
    this.scanner.invalidatePath(filePath);
  }

  async refresh(workspacePath: string): Promise<ProjectIndexSnapshot> {
    const resolvedWorkspace = path.resolve(workspacePath);
    if (this.workspacePath !== resolvedWorkspace) {
      this.workspacePath = resolvedWorkspace;
      this.contents.clear();
      this.symbols.clear();
      this.semanticIndex.clear();
      this.semanticIndexedPaths.clear();
      this.searchCache.clear();
      this.restoredSearchCacheVersion = undefined;
      this.snapshot = undefined;
    }
    this.snapshot = await this.scanner.scan(workspacePath);
    if (this.snapshot.changedPaths.length > 0 || this.snapshot.removedPaths.length > 0) {
      this.searchCache.clear();
    }
    if (this.restoredSearchCacheVersion !== this.snapshot.indexVersion) {
      this.restoreSearchCache(resolvedWorkspace, this.snapshot.indexVersion);
      this.restoredSearchCacheVersion = this.snapshot.indexVersion;
    }
    const restored = this.restoreSymbols(resolvedWorkspace, this.snapshot.indexVersion);
    const activePaths = new Set(this.snapshot.files.map((file) => file.path));
    for (const filePath of this.contents.keys()) {
      if (!activePaths.has(filePath)) {
        this.contents.delete(filePath);
        this.symbols.removeFile(filePath);
        this.semanticIndex.removeFile(filePath);
        this.semanticIndexedPaths.delete(filePath);
      }
    }

    for (const filePath of this.snapshot.changedPaths) {
      this.semanticIndex.removeFile(filePath);
      this.semanticIndexedPaths.delete(filePath);
      await this.indexFile(workspacePath, filePath);
      this.indexSemanticFile(filePath);
    }
    if (!restored && this.symbols.getSymbols().length === 0 && this.snapshot.files.length > 0) {
      for (const file of this.snapshot.files) {
        await this.indexFile(workspacePath, file.path);
        this.indexSemanticFile(file.path);
      }
    }
    if (restored) {
      for (const file of this.snapshot.files) {
        if (!this.contents.has(file.path)) {
          await this.loadContent(workspacePath, file.path);
        }
        if (!this.semanticIndexedPaths.has(file.path)) {
          this.indexSemanticFile(file.path);
        }
      }
    }
    const restoredRelationships = restored && this.restoreRelationships(resolvedWorkspace, this.snapshot.indexVersion);
    this.relationships = restoredRelationships ? restoredRelationships : this.buildRelationships();
    this.codeGraph.rebuild(this.relationships, this.symbols.getSymbols());
    this.persistSymbols(resolvedWorkspace, this.snapshot.indexVersion);
    this.persistRelationships(resolvedWorkspace, this.snapshot.indexVersion);
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
      output: `symbol=${found.qualifiedName}\nkind=${found.kind}${found.parser ? `\nparser=${found.parser}` : ""}\n${result.output}`
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

  async search(workspacePath: string, query: string, limit = 50, explicitPaths: string[] = [], signal?: AbortSignal): Promise<RankedSearchResult[]> {
    await this.ensureRefreshed(workspacePath);
    if (signal?.aborted) {
      throw new Error("Repository search cancelled");
    }
    const cacheKey = this.searchCacheKey(query, limit, explicitPaths);
    const cached = this.searchCache.get(cacheKey);
    if (cached) {
      this.lastSearchTiming = { semanticMs: 0, rankingMs: 0, totalMs: 0, cacheHit: true };
      return cached.map((result) => ({ ...result, matchedSymbols: [...result.matchedSymbols], matchedTerms: [...result.matchedTerms] }));
    }
    const startedAt = Date.now();
    const semanticMatches = await this.semanticIndex.search(query, limit, signal);
    const semanticMs = Date.now() - startedAt;
    const recentPaths = new Set(this.snapshot?.changedPaths ?? []);
    const selectedPaths = new Set(explicitPaths);
    const rankingStartedAt = Date.now();
    const results = this.searchEngine.search(
      query,
      [...this.contents.entries()].map(([filePath, content]) => ({
        path: filePath,
        content,
        symbols: this.symbols.getSymbols(filePath),
        explicit: selectedPaths.has(filePath),
        recentChange: recentPaths.has(filePath)
      })),
      this.relationships,
      limit,
      semanticMatches
    );
    const rankingMs = Date.now() - rankingStartedAt;
    this.lastSearchTiming = { semanticMs, rankingMs, totalMs: Date.now() - startedAt, cacheHit: false };
    this.searchCache.set(cacheKey, results.map((result) => ({ ...result, matchedSymbols: [...result.matchedSymbols], matchedTerms: [...result.matchedTerms] })));
    this.persistSearchCache(this.workspacePath, this.snapshot?.indexVersion ?? 0);
    flow("RepositoryRetrieval.search", 1, "completed", this.lastSearchTiming);
    return results;
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
        `symbols=${symbols.map((item) => `${item.qualifiedName}:${item.kind}:${item.startLine}-${item.endLine}${item.parser ? `:parser=${item.parser}` : ""}`).join(", ") || "none"}`
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

  async getRelationships(workspacePath: string): Promise<Relationship[]> {
    await this.ensureRefreshed(workspacePath);
    return this.relationships.map((relationship) => ({ ...relationship }));
  }

  async getCodeGraph(workspacePath: string): Promise<CodeGraphSnapshot> {
    await this.ensureRefreshed(workspacePath);
    return this.codeGraph.snapshot();
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
    const references = this.relationships.filter((item) => this.matchesRelationshipTarget(item, query));
    return { success: true, output: this.formatRelationships(references, `No references found for '${query}'.`) };
  }

  async findCallers(workspacePath: string, query: string): Promise<RetrievalResult> {
    await this.ensureRefreshed(workspacePath);
    const callers = this.relationships.filter((item) =>
      (item.kind === "reference" || item.kind === "call" || item.kind === "test") && this.matchesRelationshipTarget(item, query)
    );
    return { success: true, output: this.formatRelationships(callers, `No callers found for '${query}'.`) };
  }

  async findCallees(workspacePath: string, query: string): Promise<RetrievalResult> {
    await this.ensureRefreshed(workspacePath);
    const callees = this.relationships.filter((item) =>
      (item.kind === "reference" || item.kind === "call") && (item.from === query || item.from.endsWith(`.${query}`))
    );
    return { success: true, output: this.formatRelationships(callees, `No callees found for '${query}'.`) };
  }

  async findTests(workspacePath: string, query: string): Promise<RetrievalResult> {
    await this.ensureRefreshed(workspacePath);
    const tests = this.relationships.filter((item) => item.kind === "test" && this.matchesRelationshipTarget(item, query));
    return { success: true, output: this.formatRelationships(tests, `No tests found for '${query}'.`) };
  }

  async findRoutes(workspacePath: string, query: string): Promise<RetrievalResult> {
    await this.ensureRefreshed(workspacePath);
    const routes = this.relationships.filter((item) => item.kind === "route" && item.to.includes(query));
    return { success: true, output: this.formatRelationships(routes, `No routes found for '${query}'.`) };
  }

  async findReads(workspacePath: string, query: string): Promise<RetrievalResult> {
    await this.ensureRefreshed(workspacePath);
    const reads = this.relationships.filter((item) => item.kind === "read" && item.to.includes(query));
    return { success: true, output: this.formatRelationships(reads, `No reads found for '${query}'.`) };
  }

  async findWrites(workspacePath: string, query: string): Promise<RetrievalResult> {
    await this.ensureRefreshed(workspacePath);
    const writes = this.relationships.filter((item) => item.kind === "write" && item.to.includes(query));
    return { success: true, output: this.formatRelationships(writes, `No writes found for '${query}'.`) };
  }

  private async ensureRefreshed(workspacePath: string): Promise<ProjectIndexSnapshot> {
    return this.snapshot ?? this.refresh(workspacePath);
  }

  private async indexFile(workspacePath: string, filePath: string): Promise<void> {
    const content = await this.loadContent(workspacePath, filePath);
    this.contents.set(filePath, content);
    const file = this.snapshot?.files.find((item) => item.path === filePath);
    this.symbols.indexFile(filePath, file?.language ?? "Other", content);
  }

  private async loadContent(workspacePath: string, filePath: string): Promise<string> {
    const content = await fs.readFile(path.join(workspacePath, ...filePath.split("/")), "utf8");
    this.contents.set(filePath, content);
    return content;
  }

  private symbolStorageKey(workspacePath: string): string {
    return `mm3.symbol-index.v1.${createHash("sha256").update(workspacePath).digest("hex")}`;
  }

  private searchCacheKey(query: string, limit: number, explicitPaths: string[]): string {
    return [this.snapshot?.indexVersion ?? 0, query, limit, ...[...explicitPaths].sort()].join("|");
  }

  private relationshipStorageKey(workspacePath: string): string {
    return `mm3.relationship-index.v1.${createHash("sha256").update(workspacePath).digest("hex")}`;
  }

  private searchStorageKey(workspacePath: string): string {
    return `mm3.search-cache.v1.${createHash("sha256").update(workspacePath).digest("hex")}`;
  }

  private restoreSearchCache(workspacePath: string, indexVersion: number): void {
    this.searchCache.clear();
    const persisted = this.storage?.get<PersistedSearchCache>(this.searchStorageKey(workspacePath));
    if (!persisted || persisted.indexVersion !== indexVersion || !Array.isArray(persisted.entries)) {
      return;
    }
    for (const entry of persisted.entries.slice(-32)) {
      if (typeof entry.key !== "string" || !Array.isArray(entry.results)) {
        continue;
      }
      this.searchCache.set(entry.key, entry.results);
    }
  }

  private persistSearchCache(workspacePath: string | undefined, indexVersion: number): void {
    if (!workspacePath || !this.storage) {
      return;
    }
    try {
      void this.storage.update(this.searchStorageKey(workspacePath), {
        indexVersion,
        entries: [...this.searchCache.entries()].slice(-32).map(([key, results]) => ({ key, results }))
      } satisfies PersistedSearchCache);
    } catch {
      // A cache write must not prevent local retrieval from working.
    }
  }

  private restoreSymbols(workspacePath: string, indexVersion: number): boolean {
    const persisted = this.storage?.get<{ indexVersion: number; snapshot: SymbolIndexSnapshot }>(this.symbolStorageKey(workspacePath));
    if (!persisted || persisted.indexVersion !== indexVersion || !persisted.snapshot) {
      return false;
    }
    this.symbols.restore(persisted.snapshot);
    return this.symbols.getSymbols().length > 0;
  }

  private persistSymbols(workspacePath: string, indexVersion: number): void {
    try {
      void this.storage?.update(this.symbolStorageKey(workspacePath), {
        indexVersion,
        snapshot: this.symbols.snapshot()
      });
    } catch {
      // A cache write must not prevent local retrieval from working.
    }
  }

  private restoreRelationships(workspacePath: string, indexVersion: number): Relationship[] | undefined {
    const persisted = this.storage?.get<{ indexVersion: number; relationships: Relationship[] }>(this.relationshipStorageKey(workspacePath));
    if (!persisted || persisted.indexVersion !== indexVersion || !Array.isArray(persisted.relationships)) {
      return undefined;
    }
    return persisted.relationships.filter((item) =>
      item && typeof item.from === "string" && typeof item.to === "string" && typeof item.kind === "string"
    );
  }

  private persistRelationships(workspacePath: string, indexVersion: number): void {
    try {
      void this.storage?.update(this.relationshipStorageKey(workspacePath), {
        indexVersion,
        relationships: this.relationships
      });
    } catch {
      // A cache write must not prevent local retrieval from working.
    }
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
        const callLine = this.findCallLine(content, name, source.startLine, source.endLine);
        const isTest = this.isTestPath(source.path) && callLine !== undefined;
        relationships.push({
          from: source.qualifiedName,
          to: target.qualifiedName,
          kind: isTest ? "test" : callLine === undefined ? "reference" : "call",
          line: callLine ?? source.startLine,
          provenance: isTest ? "test-reference" : callLine === undefined ? "symbol-reference" : "symbol-call",
          confidence: isTest ? 0.95 : callLine === undefined ? 0.6 : 0.9,
          ...(isTest ? { sourcePath: source.path } : {})
        });
      }
      const language = this.snapshot?.files.find((file) => file.path === source.path)?.language ?? "Other";
      for (const access of this.extractDataAccesses(language, content, source.startLine, source.endLine)) {
        relationships.push({
          from: source.qualifiedName,
          to: access.path,
          kind: access.kind,
          line: access.line,
          provenance: "data-access",
          confidence: 0.85,
          sourcePath: source.path
        });
      }
    }
    for (const [filePath, content] of this.contents) {
      const language = this.snapshot?.files.find((file) => file.path === filePath)?.language ?? "Other";
      for (const imported of this.extractImports(language, content)) {
        const resolvedPath = language === "TypeScript" || language === "JavaScript"
          ? this.resolveImportPath(filePath, imported.path)
          : language === "Go" ? this.resolveGoImportPath(imported.path)
            : this.resolveModuleImportPath(language, filePath, imported.path);
        const dependency = resolvedPath === undefined ? this.dependencyInfo(imported.path, language) : undefined;
        relationships.push({
          from: filePath,
          to: imported.path,
          kind: "import",
          line: imported.line,
          sourcePath: filePath,
          provenance: resolvedPath === undefined ? "external-import" : "import-declaration",
          confidence: resolvedPath === undefined ? 0.7 : 0.95,
          ...(dependency ?? {}),
          ...(resolvedPath === undefined ? {} : { resolvedPath })
        });
      }
      for (const route of this.extractRoutes(language, filePath, content)) {
        relationships.push({
          from: filePath,
          to: `${route.method} ${route.path}`,
          kind: "route",
          line: route.line,
          provenance: "route-registration",
          confidence: 0.95,
          sourcePath: filePath
        });
      }
    }
    return [...new Map(relationships.map((item) => [`${item.from}:${item.to}:${item.kind}`, item])).values()];
  }

  private indexSemanticFile(filePath: string): void {
    const content = this.contents.get(filePath);
    if (content === undefined) {
      return;
    }
    const symbols = this.symbols.getSymbols(filePath);
    const language = this.snapshot?.files.find((file) => file.path === filePath)?.language ?? "Other";
    if (symbols.length === 0) {
      const lines = content.split("\n");
      for (const range of this.fallbackChunkRanges(lines, language)) {
        this.semanticIndex.upsert({
          path: filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          content: lines.slice(range.startLine - 1, range.endLine).join("\n")
        });
      }
      this.semanticIndexedPaths.add(filePath);
      return;
    }
    const lines = content.split("\n");
    for (const item of symbols) {
      this.semanticIndex.upsert({
        path: filePath,
        startLine: item.startLine,
        endLine: item.endLine,
        content: lines.slice(item.startLine - 1, item.endLine).join("\n")
      });
    }
    this.semanticIndexedPaths.add(filePath);
  }

  private fallbackChunkRanges(lines: string[], language: string): Array<{ startLine: number; endLine: number }> {
    const ranges: Array<{ startLine: number; endLine: number }> = [];
    const maxChunkLines = 80;
    const structuralBreaks = this.structuralBreaks(lines, language);
    let start = 0;
    for (let index = 0; index < lines.length; index += 1) {
      if (index > start && structuralBreaks.has(index) && index - start >= 4) {
        ranges.push({ startLine: start + 1, endLine: index });
        start = index;
      }
      const reachedLimit = index - start + 1 >= maxChunkLines;
      const naturalBoundary = lines[index].trim() === "" && index - start >= 12;
      if ((reachedLimit || naturalBoundary) && index >= start) {
        ranges.push({ startLine: start + 1, endLine: index + 1 });
        start = index + 1;
      }
    }
    if (start < lines.length) {
      ranges.push({ startLine: start + 1, endLine: lines.length });
    }
    return ranges;
  }

  private structuralBreaks(lines: string[], language: string): Set<number> {
    const breaks = new Set<number>();
    const braceLanguage = new Set(["TypeScript", "JavaScript", "Go", "Rust", "Java", "Kotlin", "CSharp", "PHP", "CSS", "SCSS", "HTML"]);
    if (language === "Markdown") {
      lines.forEach((line, index) => {
        if (index > 0 && /^\s*#{1,6}\s+/.test(line)) {
          breaks.add(index);
        }
      });
      return breaks;
    }
    if (language === "Python") {
      lines.forEach((line, index) => {
        if (index > 0 && /^(?:class|def|async\s+def)\s+/.test(line)) {
          breaks.add(index);
        }
      });
      return breaks;
    }
    if (!braceLanguage.has(language)) {
      return breaks;
    }

    let depth = 0;
    lines.forEach((line, index) => {
      const code = line.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g, "").replace(/\/\/.*$/, "");
      for (const character of code) {
        if (character === "{") {
          depth += 1;
        }
        if (character === "}") {
          depth = Math.max(0, depth - 1);
        }
      }
      if (depth === 0 && code.includes("}") && index + 1 < lines.length) {
        breaks.add(index + 1);
      }
    });
    return breaks;
  }

  private extractImports(language: string, content: string): Array<{ path: string; line: number }> {
    const imports: Array<{ path: string; line: number }> = [];
    let inGoImportBlock = false;
    content.split("\n").forEach((line, index) => {
      const lineNumber = index + 1;
      if (language === "Go") {
        if (/^\s*import\s*\(\s*$/.test(line)) {
          inGoImportBlock = true;
          return;
        }
        if (inGoImportBlock && /^\s*\)\s*$/.test(line)) {
          inGoImportBlock = false;
          return;
        }
        const goImport = (inGoImportBlock ? line : line.replace(/^\s*import\s+/, ""))
          .match(/^\s*(?:[A-Za-z_]\w*|\.)?\s*"([^"]+)"/);
        if (goImport && (inGoImportBlock || /^\s*import\s+/.test(line))) {
          imports.push({ path: goImport[1], line: lineNumber });
        }
        return;
      }

      if (language === "Python") {
        const pythonImport = line.match(/^\s*from\s+(\.*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import\b/)
          ?? line.match(/^\s*import\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/);
        if (pythonImport) {
          imports.push({ path: pythonImport[1], line: lineNumber });
        }
        return;
      }

      if (language === "Java" || language === "Kotlin") {
        const JVMImport = line.match(/^\s*import\s+(?:static\s+)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?:\.\*)?)/);
        if (JVMImport) {
          imports.push({ path: JVMImport[1], line: lineNumber });
        }
        return;
      }

      if (language === "Rust") {
        const rustImport = line.match(/^\s*use\s+([^;{\s]+)/);
        if (rustImport) {
          imports.push({ path: rustImport[1], line: lineNumber });
        }
        const rustModule = line.match(/^\s*mod\s+([A-Za-z_]\w*)\s*;/);
        if (rustModule) {
          imports.push({ path: `crate::${rustModule[1]}`, line: lineNumber });
        }
        return;
      }

      const importMatch = line.match(/^\s*import\s+(?:type\s+)?(?:[^"']+\s+from\s+)?["']([^"']+)["']/)
        ?? line.match(/^\s*export\s+[^"']+\s+from\s+["']([^"']+)["']/)
        ?? line.match(/^\s*["']([^"']+)["']\s*$/);
      if (importMatch) {
        imports.push({ path: importMatch[1], line: lineNumber });
      }
    });
    return imports;
  }

  private extractRoutes(language: string, filePath: string, content: string): Array<{ method: string; path: string; line: number }> {
    const routes: Array<{ method: string; path: string; line: number }> = [];
    const groups = new Map<string, string>();
    content.split("\n").forEach((line, index) => {
      const lineNumber = index + 1;
      if (language === "Go") {
        const group = line.match(/\b([A-Za-z_]\w*)\s*:=\s*\w+\.Group\(\s*"([^"]*)"\s*\)/);
        if (group) {
          groups.set(group[1], group[2]);
        }
        const route = line.match(/\b([A-Za-z_]\w*)\.(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\(\s*"([^"]+)"/);
        if (route) {
          routes.push({ method: route[2], path: this.joinRoutePath(groups.get(route[1]) ?? "", route[3]), line: lineNumber });
        }
        return;
      }

      const route = line.match(/\b(?:app|router)\.(get|post|put|patch|delete|options|head)\(\s*["']([^"']+)["']/i);
      if (route) {
        routes.push({ method: route[1].toUpperCase(), path: route[2], line: lineNumber });
      }
    });
    return routes;
  }

  private extractDataAccesses(
    language: string,
    content: string,
    startLine: number,
    endLine: number
  ): Array<{ kind: "read" | "write"; path: string; line: number }> {
    const accesses: Array<{ kind: "read" | "write"; path: string; line: number }> = [];
    const lines = content.split("\n");
    for (let index = Math.max(0, startLine - 1); index < Math.min(lines.length, endLine); index += 1) {
      const line = lines[index];
      if (language === "Go") {
        const match = line.match(/\b(?:os|ioutil)\.(ReadFile|WriteFile|Create)\(\s*"([^"]+)"/);
        if (match) {
          accesses.push({ kind: match[1] === "ReadFile" ? "read" : "write", path: match[2], line: index + 1 });
        }
        continue;
      }
      if (language === "Python") {
        const openMatch = line.match(/\bopen\(\s*["']([^"']+)["']\s*(?:,\s*["']([wax]+)["'])?/);
        const pathMethod = line.match(/\bPath\(\s*["']([^"']+)["']\s*\)\.(read_text|write_text)\s*\(/);
        if (openMatch) {
          accesses.push({ kind: openMatch[2]?.includes("w") || openMatch[2]?.includes("a") ? "write" : "read", path: openMatch[1], line: index + 1 });
        } else if (pathMethod) {
          accesses.push({ kind: pathMethod[2] === "read_text" ? "read" : "write", path: pathMethod[1], line: index + 1 });
        }
        continue;
      }
      const readMatch = line.match(/\b(?:fs(?:\.promises)?\.)?(?:readFile|readFileSync)\(\s*["'`]([^"'`]+)["'`]/);
      const writeMatch = line.match(/\b(?:fs(?:\.promises)?\.)?(?:writeFile|writeFileSync|appendFile|appendFileSync)\(\s*["'`]([^"'`]+)["'`]/);
      if (readMatch) {
        accesses.push({ kind: "read", path: readMatch[1], line: index + 1 });
      }
      if (writeMatch) {
        accesses.push({ kind: "write", path: writeMatch[1], line: index + 1 });
      }
    }
    return accesses;
  }

  private joinRoutePath(prefix: string, route: string): string {
    return path.posix.join(`/${prefix}`, route).replace(/\/+/g, "/");
  }

  private formatSymbol(item: IndexedSymbol): string {
    return `${item.qualifiedName} kind=${item.kind} path=${item.path} lines=${item.startLine}-${item.endLine}${item.parser ? ` parser=${item.parser}` : ""}`;
  }

  private formatRelationships(items: Relationship[], empty: string): string {
    return items.length > 0
      ? items.map((item) => [
        `${item.kind} ${item.from} -> ${item.to}`,
        item.resolvedPath === undefined ? undefined : `resolved=${item.resolvedPath}`,
        item.sourcePath === undefined ? undefined : `source=${item.sourcePath}`,
        item.line === undefined ? undefined : `line=${item.line}`,
        item.provenance === undefined ? undefined : `provenance=${item.provenance}`,
        item.confidence === undefined ? undefined : `confidence=${item.confidence.toFixed(2)}`,
        item.dependencyType === undefined ? undefined : `dependency=${item.dependencyType}`,
        item.dependencyManager === undefined ? undefined : `manager=${item.dependencyManager}`,
        item.dependencyName === undefined ? undefined : `package=${item.dependencyName}`,
        item.dependencyVersion === undefined ? undefined : `version=${item.dependencyVersion}`
      ].filter((part): part is string => part !== undefined).join(" ")).join("\n")
      : empty;
  }

  private matchesRelationshipTarget(item: Relationship, query: string): boolean {
    return [item.to, item.resolvedPath]
      .filter((target): target is string => target !== undefined)
      .some((target) => target === query || target.endsWith(`.${query}`));
  }

  private findCallLine(content: string, name: string, startLine: number, endLine: number): number | undefined {
    const callPattern = new RegExp(`\\b${this.escapeRegExp(name)}\\s*\\(`);
    const lines = content.split("\n");
    for (let index = Math.max(0, startLine - 1); index < Math.min(lines.length, endLine); index += 1) {
      if (callPattern.test(lines[index])) {
        return index + 1;
      }
    }
    return undefined;
  }

  private isTestPath(filePath: string): boolean {
    return /(?:^|\/)(?:__tests__|tests?)(?:\/|$)|(?:\.test|\.spec)\.[^/]+$|_test\.[^/]+$|(?:^|\/)test_[^/]+\.py$/i.test(filePath);
  }

  private resolveImportPath(filePath: string, specifier: string): string | undefined {
    const basePath = specifier.startsWith(".")
      ? path.posix.normalize(path.posix.join(path.posix.dirname(filePath), specifier))
      : this.resolveTypeScriptAlias(specifier) ?? this.resolveNodePackageImport(specifier);
    if (!basePath) {
      return undefined;
    }
    return this.resolveSourcePath(basePath);
  }

  private resolveTypeScriptAlias(specifier: string): string | undefined {
    const tsConfig = this.contents.get("tsconfig.json");
    if (!tsConfig) {
      return undefined;
    }
    let parsed: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
    try {
      parsed = JSON.parse(tsConfig) as typeof parsed;
    } catch {
      return undefined;
    }
    const compilerOptions = parsed.compilerOptions;
    if (!compilerOptions?.paths) {
      return undefined;
    }
    for (const [alias, targets] of Object.entries(compilerOptions.paths)) {
      const wildcard = alias.indexOf("*");
      const prefix = wildcard >= 0 ? alias.slice(0, wildcard) : alias;
      const suffix = wildcard >= 0 ? alias.slice(wildcard + 1) : "";
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix) || !targets?.[0]) {
        continue;
      }
      const wildcardValue = specifier.slice(prefix.length, specifier.length - suffix.length || undefined);
      return path.posix.normalize(path.posix.join(
        compilerOptions.baseUrl ?? ".",
        targets[0].replace("*", wildcardValue)
      ));
    }
    return undefined;
  }

  private resolveSourcePath(basePath: string): string | undefined {
    const candidates = [
      basePath,
      ...[".ts", ".tsx", ".js", ".jsx"].map((extension) => `${basePath}${extension}`),
      ...[".ts", ".tsx", ".js", ".jsx"].map((extension) => `${basePath}/index${extension}`)
    ];
    return candidates.find((candidate) => this.contents.has(candidate));
  }

  private resolveGoImportPath(specifier: string): string | undefined {
    const goMod = this.contents.get("go.mod") ?? "";
    const replacement = [...goMod.matchAll(/^\s*replace\s+(\S+)\s+=>\s+([^\s]+)\s*$/gm)]
      .find((match) => specifier === match[1] || specifier.startsWith(`${match[1]}/`));
    if (replacement) {
      const suffix = specifier.slice(replacement[1].length).replace(/^\//, "");
      const replacedPath = path.posix.normalize(path.posix.join(replacement[2], suffix));
      return this.findGoPackagePath(replacedPath);
    }
    const modulePath = goMod.match(/^\s*module\s+(\S+)/m)?.[1];
    if (!modulePath || (specifier !== modulePath && !specifier.startsWith(`${modulePath}/`))) {
      return undefined;
    }
    const relativePath = specifier === modulePath ? "" : specifier.slice(modulePath.length + 1);
    return this.findGoPackagePath(relativePath);
  }

  private findGoPackagePath(relativePath: string): string | undefined {
    const packageFiles = [...this.contents.keys()].filter((filePath) =>
      filePath.endsWith(".go") && path.posix.dirname(filePath) === relativePath
    );
    return packageFiles.length > 0 ? relativePath || "." : undefined;
  }

  private resolveNodePackageImport(specifier: string): string | undefined {
    const packageParts = specifier.startsWith("@") ? specifier.split("/").slice(0, 2) : specifier.split("/").slice(0, 1);
    const packageName = packageParts.join("/");
    const subpath = specifier.slice(packageName.length).replace(/^\//, "");
    for (const [filePath, content] of this.contents) {
      if (path.posix.basename(filePath) !== "package.json") {
        continue;
      }
      try {
        const manifest = JSON.parse(content) as { name?: string; main?: string; module?: string; types?: string };
        if (manifest.name !== packageName) {
          continue;
        }
        const packageRoot = path.posix.dirname(filePath);
        const entry = subpath || manifest.types || manifest.module || manifest.main || "index.ts";
        return this.resolveSourcePath(path.posix.normalize(path.posix.join(packageRoot, entry.replace(/\.js$/, ".ts"))));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private resolveModuleImportPath(language: string, filePath: string, specifier: string): string | undefined {
    if (language === "Python") {
      const relativeDots = specifier.match(/^\.+/)?.[0].length ?? 0;
      let relativeDirectory = path.posix.dirname(filePath);
      for (let depth = 1; depth < relativeDots; depth += 1) {
        relativeDirectory = path.posix.dirname(relativeDirectory);
      }
      const moduleName = specifier.slice(relativeDots).replace(/\./g, "/");
      const relativeBase = relativeDots > 0
        ? path.posix.normalize(path.posix.join(relativeDirectory, moduleName))
        : moduleName;
      const packageRoot = this.pythonPackageRoot();
      return [
        packageRoot ? path.posix.join(packageRoot, relativeBase) : relativeBase,
        `${relativeBase}.py`,
        `${relativeBase}/__init__.py`
      ].flatMap((candidate) => [candidate, `${candidate}.py`, `${candidate}/__init__.py`])
        .find((candidate) => this.contents.has(candidate));
    }
    if (language === "Java" || language === "Kotlin") {
      const extension = language === "Java" ? ".java" : ".kt";
      const basePath = specifier.replace(/\./g, "/");
      if (basePath.endsWith("/*")) {
        const packagePath = basePath.slice(0, -2);
        return [...this.contents.keys()].some((candidate) =>
          candidate.startsWith(`${packagePath}/`) && candidate.endsWith(extension)
        ) ? packagePath : undefined;
      }
      return this.contents.has(`${basePath}${extension}`) ? `${basePath}${extension}` : undefined;
    }
    if (language === "Rust") {
      const crateRoot = this.rustCrateRoot();
      const modulePath = specifier.replace(/^crate::/, `${crateRoot}/`).replace(/::/g, "/");
      return [
        `${modulePath}.rs`,
        `${modulePath}/mod.rs`
      ].find((candidate) => this.contents.has(candidate));
    }
    return undefined;
  }

  private pythonPackageRoot(): string | undefined {
    const pyproject = this.contents.get("pyproject.toml");
    const configuredRoot = pyproject?.match(/package-dir\s*=\s*\{[^}]*["']?\s*=\s*["']([^"']+)["']/)?.[1]
      ?? this.contents.get("setup.cfg")?.match(/^\s*=\s*(\S+)\s*$/m)?.[1];
    if (configuredRoot && [...this.contents.keys()].some((filePath) => filePath.startsWith(`${configuredRoot}/`))) {
      return configuredRoot;
    }
    return undefined;
  }

  private rustCrateRoot(): string {
    const cargo = this.contents.get("Cargo.toml");
    const libPath = cargo?.match(/^\s*path\s*=\s*["']([^"']+)["']\s*$/m)?.[1];
    return libPath ? path.posix.dirname(libPath) : "src";
  }

  private dependencyInfo(specifier: string, language: string): DependencyMetadata | undefined {
    if (specifier.startsWith(".")) {
      return undefined;
    }
    if (language === "TypeScript" || language === "JavaScript") {
      return this.nodeDependencyInfo(specifier);
    }
    if (language === "Go") {
      return this.goDependencyInfo(specifier);
    }
    if (language === "Python") {
      return this.pythonDependencyInfo(specifier);
    }
    if (language === "Rust") {
      return this.cargoDependencyInfo(specifier);
    }
    if (language === "Java" || language === "Kotlin") {
      return this.jvmDependencyInfo(specifier);
    }
    return undefined;
  }

  private nodeDependencyInfo(specifier: string): DependencyMetadata | undefined {
    const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "http", "https", "os", "path", "stream", "url", "util"]);
    const builtinName = specifier.replace(/^node:/, "");
    if (specifier.startsWith("node:") || builtins.has(builtinName)) {
      return { dependencyType: "builtin", dependencyManager: "npm", dependencyName: builtinName };
    }
    if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
      return undefined;
    }
    const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
    for (const [filePath, content] of this.contents) {
      if (path.posix.basename(filePath) !== "package.json") {
        continue;
      }
      try {
        const manifest = JSON.parse(content) as {
          dependencies?: Record<string, unknown>;
          devDependencies?: Record<string, unknown>;
          peerDependencies?: Record<string, unknown>;
        };
        for (const [field, type] of [["dependencies", "dependency"], ["devDependencies", "devDependency"], ["peerDependencies", "peerDependency"]] as const) {
          const value = manifest[field]?.[packageName];
          if (value !== undefined) {
            return {
              dependencyType: type,
              dependencyManager: "npm",
              dependencyName: packageName,
              ...(typeof value === "string" ? { dependencyVersion: value } : {})
            };
          }
        }
      } catch {
        continue;
      }
    }
    return { dependencyType: "unknown", dependencyManager: "npm", dependencyName: packageName };
  }

  private goDependencyInfo(specifier: string): DependencyMetadata {
    const goMod = this.contents.get("go.mod") ?? "";
    const requirements: Array<{ name: string; version: string }> = [];
    for (const match of goMod.matchAll(/^\s*require\s+([^\s(]+)\s+([^\s]+)\s*$/gm)) {
      requirements.push({ name: match[1], version: match[2] });
    }
    const block = goMod.match(/\brequire\s*\(([\s\S]*?)\)/)?.[1] ?? "";
    for (const match of block.matchAll(/^\s*([^\s]+)\s+([^\s]+)(?:\s*\/\/.*)?$/gm)) {
      requirements.push({ name: match[1], version: match[2] });
    }
    const match = requirements
      .filter((item) => specifier === item.name || specifier.startsWith(`${item.name}/`))
      .sort((left, right) => right.name.length - left.name.length)[0];
    return match
      ? { dependencyType: "dependency", dependencyManager: "go", dependencyName: match.name, dependencyVersion: match.version }
      : { dependencyType: "unknown", dependencyManager: "go", dependencyName: specifier };
  }

  private pythonDependencyInfo(specifier: string): DependencyMetadata | undefined {
    const packageName = specifier.replace(/^\.+/, "").split(".")[0];
    if (!packageName) {
      return undefined;
    }
    const manifests = [this.contents.get("pyproject.toml") ?? "", this.contents.get("setup.cfg") ?? ""];
    for (const manifest of manifests) {
      const quotedDependencies = [...manifest.matchAll(/["']([A-Za-z][A-Za-z0-9_.-]*)(?:[<>=!~]+[^"']*)?["']/g)].map((item) => item[1]);
      const bareDependencies = [...manifest.matchAll(/(?:^|\n)\s*([A-Za-z][A-Za-z0-9_.-]*)\s*(?:[<>=!~]+|$)/gm)].map((item) => item[1]);
      const dependencyName = [...quotedDependencies, ...bareDependencies]
        .find((candidate) => candidate.replace(/[-_.]/g, "").toLowerCase() === packageName.replace(/[-_.]/g, "").toLowerCase());
      if (dependencyName) {
        return { dependencyType: "dependency", dependencyManager: "python", dependencyName };
      }
    }
    return { dependencyType: "unknown", dependencyManager: "python", dependencyName: packageName };
  }

  private cargoDependencyInfo(specifier: string): DependencyMetadata {
    const crateName = specifier.split("::")[0].replace(/-/g, "_");
    const cargo = this.contents.get("Cargo.toml") ?? "";
    let section = "";
    for (const line of cargo.split("\n")) {
      const header = line.match(/^\s*\[([^\]]+)\]/)?.[1] ?? "";
      if (header) {
        section = header;
      }
      if (!["dependencies", "dev-dependencies", "build-dependencies"].includes(section)) {
        continue;
      }
      const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(?:["']([^"']+)["']|\{[^}]*version\s*=\s*["']([^"']+)["'])/);
      if (match && match[1].replace(/-/g, "_") === crateName) {
        return {
          dependencyType: section === "dev-dependencies" ? "devDependency" : "dependency",
          dependencyManager: "cargo",
          dependencyName: match[1],
          ...(match[2] ?? match[3] ? { dependencyVersion: match[2] ?? match[3] } : {})
        };
      }
    }
    return { dependencyType: "unknown", dependencyManager: "cargo", dependencyName: crateName };
  }

  private jvmDependencyInfo(specifier: string): DependencyMetadata {
    const pom = this.contents.get("pom.xml") ?? "";
    for (const block of pom.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
      const group = block[1].match(/<groupId>\s*([^<]+)\s*<\/groupId>/)?.[1];
      const artifact = block[1].match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/)?.[1];
      const version = block[1].match(/<version>\s*([^<]+)\s*<\/version>/)?.[1];
      if (group && specifier.startsWith(group)) {
        return { dependencyType: "dependency", dependencyManager: "jvm", dependencyName: artifact ? `${group}:${artifact}` : group, ...(version ? { dependencyVersion: version } : {}) };
      }
    }
    const gradle = this.contents.get("build.gradle") ?? this.contents.get("build.gradle.kts") ?? "";
    const gradleMatch = gradle.match(/(?:implementation|api|compileOnly|runtimeOnly)\s*[\("']([^:"']+):([^:"']+):([^"')]+)["')]/);
    if (gradleMatch && specifier.startsWith(gradleMatch[1])) {
      return { dependencyType: "dependency", dependencyManager: "jvm", dependencyName: `${gradleMatch[1]}:${gradleMatch[2]}`, dependencyVersion: gradleMatch[3] };
    }
    return { dependencyType: "unknown", dependencyManager: "jvm", dependencyName: specifier.split(".").slice(0, 2).join(".") };
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