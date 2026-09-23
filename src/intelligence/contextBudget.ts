import type { AIContext, ContextFile, ContextPart } from "../models/types.ts";

export interface ContextBudgetOptions {
  maxTokens: number;
  reservedTokens?: number;
  outputTokens?: number;
  exactPaths?: string[];
}

export interface ContextBudgetResult {
  context: AIContext;
  estimatedTokens: number;
  omittedFiles: string[];
  deduplicatedFiles: number;
  summary: string;
}

export function estimateTokens(value: string): number {
  return Math.ceil(Buffer.byteLength(value, "utf8") / 4);
}

function contentKey(file: ContextFile | ContextPart): string {
  let hash = 0;
  for (let index = 0; index < file.content.length; index += 1) {
    hash = ((hash << 5) - hash + file.content.charCodeAt(index)) | 0;
  }
  return `${file.path}:${hash}`;
}

function compactSummary(file: ContextFile): string {
  const range = file.startLine !== undefined
    ? ` lines=${file.startLine}-${file.endLine ?? file.startLine}`
    : "";
  return `- omitted ${file.path}${range} (${estimateTokens(file.content)} estimated tokens; exact content available through local retrieval)`;
}

export function budgetContext(
  input: AIContext,
  options: ContextBudgetOptions
): ContextBudgetResult {
  const reserved = Math.max(0, options.reservedTokens ?? 0) + Math.max(0, options.outputTokens ?? 0);
  const availableTokens = Math.max(0, options.maxTokens - reserved);
  const exactPaths = new Set(options.exactPaths ?? []);
  const selectedParts = input.parts ?? [];
  const seen = new Set<string>();
  const parts: ContextPart[] = [];
  const files: ContextFile[] = [];
  const omittedFiles: string[] = [];
  let deduplicatedFiles = 0;
  let usedTokens = 0;

  const candidates = [
    ...selectedParts.map((part) => ({ item: part, priority: 100 })),
    ...input.files.map((file) => ({
      item: file,
      priority: exactPaths.has(file.path) ? 95 : 50
    }))
  ].sort((left, right) => right.priority - left.priority);

  for (const candidate of candidates) {
    const key = contentKey(candidate.item);
    if (seen.has(key)) {
      deduplicatedFiles += 1;
      continue;
    }
    seen.add(key);
    const tokens = estimateTokens(candidate.item.content);
    if (usedTokens + tokens > availableTokens) {
      if (!("kind" in candidate.item)) {
        omittedFiles.push(candidate.item.path);
      }
      continue;
    }
    usedTokens += tokens;
    if (!("kind" in candidate.item)) {
      files.push(candidate.item);
    } else {
      parts.push(candidate.item);
    }
  }

  const omittedSummary = input.files
    .filter((file) => omittedFiles.includes(file.path))
    .map(compactSummary);
  const summary = [
    input.indexSummary,
    omittedSummary.length > 0 ? "\n## Compacted Context\n" + omittedSummary.join("\n") : "",
    `\nContext budget: ${usedTokens}/${availableTokens} estimated tokens; reserved ${reserved}.`
  ].filter(Boolean).join("\n");

  return {
    context: {
      files,
      indexSummary: summary,
      evidence: input.evidence.filter((item) => files.some((file) => file.path === item.path) || exactPaths.has(item.path)),
      parts,
      orchestration: input.orchestration,
      taskMemory: input.taskMemory
    },
    estimatedTokens: usedTokens + estimateTokens(summary),
    omittedFiles,
    deduplicatedFiles,
    summary
  };
}