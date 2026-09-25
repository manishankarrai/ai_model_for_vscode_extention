import { budgetContext, type ContextBudgetOptions, type ContextBudgetResult } from "./contextBudget.ts";
import type { AIContext, ContextFile, ContextManifest, TaskMemory } from "../models/types.ts";
import { MemoryContextCacheStore, type ContextCacheStore } from "./ContextCache.ts";

export interface ContextManagerOptions extends ContextBudgetOptions {
  policyVersion?: string;
  dependencyFiles?: ContextFile[];
  dependencyPaths?: string[];
  maxTaskMemoryItems?: number;
  maxTaskMemoryChars?: number;
  cacheTtlMs?: number;
}

export interface ContextManagerResult extends ContextBudgetResult {
  manifest: ContextManifest;
  cacheHit: boolean;
}

interface CachedContext {
  paths: Set<string>;
  result: ContextManagerResult;
  expiresAt: number;
}

function fingerprint(file: ContextFile): string {
  let hash = 0;
  for (let index = 0; index < file.content.length; index += 1) {
    hash = ((hash << 5) - hash + file.content.charCodeAt(index)) | 0;
  }
  return `${file.path}:${hash}`;
}

export class ContextManager {
  private readonly cache = new Map<string, CachedContext>();
  private readonly cacheStore: ContextCacheStore;

  constructor(cacheStore: ContextCacheStore = new MemoryContextCacheStore()) {
    this.cacheStore = cacheStore;
  }

  clear(): void {
    this.cache.clear();
    this.cacheStore.clear();
  }

  invalidatePath(filePath: string): void {
    for (const [key, cached] of this.cache) {
      if (cached.paths.has(filePath)) {
        this.cache.delete(key);
        this.cacheStore.delete(key);
      }
    }
  }

  manage(input: AIContext, options: ContextManagerOptions): ContextManagerResult {
    const expandedFiles = this.expandDependencyFiles(input.files, options.dependencyFiles ?? []);
    const dependencyPaths = new Set([
      ...(options.dependencyPaths ?? []),
      ...(options.dependencyFiles ?? []).map((file) => file.path)
    ]);
    const managedTaskMemory = this.normalizeTaskMemory(input.taskMemory, options);
    const expandedEvidence = this.expandDependencyEvidence(input.evidence, options.dependencyFiles ?? [], dependencyPaths);
    const expandedInput: AIContext = {
      ...input,
      files: expandedFiles,
      evidence: expandedEvidence,
      taskMemory: managedTaskMemory
    };
    const cacheKey = this.cacheKey(expandedInput, options, dependencyPaths);
    const now = Date.now();
    const cached = this.cache.get(cacheKey) ?? (() => {
      const stored = this.cacheStore.get(cacheKey);
      return stored
        ? {
            paths: new Set(expandedFiles.map((file) => file.path)),
            result: stored,
            expiresAt: now + (options.cacheTtlMs ?? 300_000)
          }
        : undefined;
    })();
    if (cached && cached.expiresAt > now) {
      this.cache.set(cacheKey, cached);
      return this.withCacheHit(cached.result, true);
    }
    if (cached) {
      this.cache.delete(cacheKey);
      this.cacheStore.delete(cacheKey);
    }
    const evidenceScores = new Map(expandedEvidence.map((item) => [item.path, item.score]));
    const availableTokens = Math.max(0, options.maxTokens - Math.max(0, options.reservedTokens ?? 0) - Math.max(0, options.outputTokens ?? 0));
    const exactPaths = new Set(options.exactPaths ?? []);
    const rankedInput: AIContext = {
      ...expandedInput,
      files: [...expandedFiles].sort((left, right) =>
        this.contextScore(right, evidenceScores, dependencyPaths) - this.contextScore(left, evidenceScores, dependencyPaths) || left.path.localeCompare(right.path)
      ).map((file) => exactPaths.has(file.path) ? file : this.compressFile(file, availableTokens * 4))
    };
    const compressedPaths = new Set(rankedInput.files.filter((file) => file.compressed).map((file) => file.path));
    const budgeted = budgetContext(rankedInput, options);
    const included = new Set(budgeted.context.files.map((file) => file.path));
    const includedParts = new Set((budgeted.context.parts ?? []).map((part) => part.path));
    const seen = new Set<string>();
    const entries: ContextManifest["entries"] = [];

    for (const part of input.parts ?? []) {
      entries.push({
        path: part.path,
        kind: "part",
        status: includedParts.has(part.path) ? "included" : "omitted",
        estimatedTokens: Math.ceil(Buffer.byteLength(part.content, "utf8") / 4),
        reason: "explicit context"
      });
    }
    for (const file of expandedFiles) {
      const key = fingerprint(file);
      const duplicate = seen.has(key);
      seen.add(key);
      const dependency = dependencyPaths.has(file.path);
      entries.push({
        path: file.path,
        kind: "file",
        status: duplicate ? "deduplicated" : compressedPaths.has(file.path) && included.has(file.path) ? "compressed" : included.has(file.path) ? "included" : "omitted",
        estimatedTokens: Math.ceil(Buffer.byteLength(file.content, "utf8") / 4),
        reason: duplicate ? "duplicate content" : compressedPaths.has(file.path) ? dependency ? "dependency context; structure-aware compression" : "structure-aware compression" : dependency ? "dependency context" : included.has(file.path) ? "ranked context" : "token budget"
      });
    }

    const manifest: ContextManifest = {
      version: 1,
      estimatedTokens: budgeted.estimatedTokens,
      availableTokens: Math.max(0, options.maxTokens - Math.max(0, options.reservedTokens ?? 0) - Math.max(0, options.outputTokens ?? 0)),
      reservedTokens: Math.max(0, options.reservedTokens ?? 0) + Math.max(0, options.outputTokens ?? 0),
      entries,
      cacheHit: false
    };
    const result: ContextManagerResult = {
      ...budgeted,
      context: { ...budgeted.context, manifest },
      manifest,
      cacheHit: false
    };
    const cachedResult: CachedContext = {
      paths: new Set([...expandedFiles.map((file) => file.path), ...(input.parts ?? []).map((part) => part.path)]),
      result,
      expiresAt: now + (options.cacheTtlMs ?? 300_000)
    };
    this.cache.set(cacheKey, cachedResult);
    this.cacheStore.set(cacheKey, result);
    return result;
  }

  private withCacheHit(result: ContextManagerResult, cacheHit: boolean): ContextManagerResult {
    const manifest = { ...result.manifest, cacheHit };
    return {
      ...result,
      cacheHit,
      context: { ...result.context, manifest },
      manifest
    };
  }

  private cacheKey(input: AIContext, options: ContextManagerOptions, dependencyPaths: Set<string>): string {
    const parts = [
      options.policyVersion ?? "default",
      String(options.maxTokens),
      String(options.reservedTokens ?? 0),
      String(options.outputTokens ?? 0),
      (options.exactPaths ?? []).join(","),
      [...dependencyPaths].sort().join(","),
      String(options.maxTaskMemoryItems ?? 0),
      String(options.maxTaskMemoryChars ?? 0),
      input.indexSummary,
      ...input.evidence.map((item) => `${item.path}:${item.score}:${item.reason}`),
      ...input.files.map((file) => fingerprint(file)),
      ...(input.parts ?? []).map((part) => `${part.path}:${fingerprint({ path: part.path, content: part.content })}`),
      JSON.stringify(input.taskMemory ?? null)
    ].join("|");
    let hash = 0;
    for (let index = 0; index < parts.length; index += 1) {
      hash = ((hash << 5) - hash + parts.charCodeAt(index)) | 0;
    }
    return String(hash);
  }

  private expandDependencyFiles(files: ContextFile[], dependencyFiles: ContextFile[]): ContextFile[] {
    const seen = new Set(files.map((file) => fingerprint(file)));
    return [...files, ...dependencyFiles.filter((file) => {
      const key = fingerprint(file);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })];
  }

  private expandDependencyEvidence(
    evidence: AIContext["evidence"],
    dependencyFiles: ContextFile[],
    dependencyPaths: Set<string>
  ): AIContext["evidence"] {
    const expanded = [...evidence];
    const knownPaths = new Set(expanded.map((item) => item.path));
    for (const file of dependencyFiles) {
      if (knownPaths.has(file.path)) {
        continue;
      }
      expanded.push({
        path: file.path,
        score: 2,
        reason: "dependency expansion",
        matchedSymbols: [],
        matchedTerms: []
      });
      knownPaths.add(file.path);
    }
    return expanded.map((item) => dependencyPaths.has(item.path) && item.reason !== "dependency expansion"
      ? { ...item, reason: `${item.reason}; dependency context` }
      : item);
  }

  private contextScore(file: ContextFile, evidenceScores: Map<string, number>, dependencyPaths: Set<string>): number {
    return (evidenceScores.get(file.path) ?? 0) + (dependencyPaths.has(file.path) ? 5 : 0);
  }

  private normalizeTaskMemory(memory: TaskMemory | undefined, options: ContextManagerOptions): TaskMemory | undefined {
    if (!memory) {
      return undefined;
    }
    const maxItems = Math.max(1, options.maxTaskMemoryItems ?? 12);
    let remainingChars = Math.max(1, options.maxTaskMemoryChars ?? 12_000);
    const limit = (items: string[]): string[] => items.slice(-maxItems).map((item) => {
      if (remainingChars <= 0) {
        return "";
      }
      const selected = item.slice(0, remainingChars);
      remainingChars -= selected.length;
      return selected;
    }).filter(Boolean);
    const lastResult = memory.verification.lastResult?.slice(0, Math.max(0, remainingChars));
    return {
      findings: limit(memory.findings),
      openQuestions: limit(memory.openQuestions),
      verification: {
        ...memory.verification,
        ...(lastResult !== undefined ? { lastResult } : {})
      }
    };
  }

  private compressFile(file: ContextFile, maxChars: number): ContextFile {
    if (maxChars <= 0 || Buffer.byteLength(file.content, "utf8") <= maxChars) {
      return file;
    }
    const lines = file.content.split("\n");
    const marker = "\n... [context compressed; retrieve exact ranges locally] ...\n";
    const declarationLines = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /\b(?:export|class|interface|function|func|def|route)\b/.test(line));
    const supportingLines = [
      ...lines.slice(0, Math.min(4, lines.length)).map((line, index) => ({ line, index })),
      ...lines.slice(Math.max(0, lines.length - 4)).map((line, index) => ({ line, index: index + Math.max(0, lines.length - 4) }))
    ];
    const candidates = [...declarationLines, ...supportingLines]
      .filter((candidate, index, all) => all.findIndex((item) => item.index === candidate.index) === index);
    let remaining = Math.max(1, maxChars - marker.length);
    const excerptLines: string[] = [];
    for (const candidate of candidates) {
      if (remaining <= 0) {
        break;
      }
      const line = `${candidate.index + 1}: ${candidate.line}`;
      const selected = line.slice(0, remaining);
      excerptLines.push(selected);
      remaining -= selected.length + 1;
    }
    const excerpt = excerptLines.join("\n");
    return {
      ...file,
      content: `${excerpt}${marker}`.slice(0, maxChars),
      compressed: true
    };
  }
}
