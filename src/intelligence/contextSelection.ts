import { flow } from "../utils/flowLog.ts";

import type {
  AIContext,
  ContextEvidence,
  ContextFile,
  ContextPart,
  InteractionMode,
  SearchResult
} from "../models/types.ts";

export function isSafeContextPath(filePath: string): boolean {
  flow("isSafeContextPath", 1, "enter");
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();

  return !normalized.startsWith("/") &&
    !normalized.split("/").includes("..") &&
    !normalized.endsWith(".pem") &&
    !normalized.endsWith(".key");
}

export function selectRankedFiles(
  ranked: SearchResult[],
  maxFiles: number
): SearchResult[] {
  return ranked
    .filter((result) => isSafeContextPath(result.path))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(0, maxFiles));
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function takeUtf8Chunk(value: string, start: number, maxBytes: number): string {
  let low = start + 1;
  let high = value.length;
  let end = start;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (utf8Length(value.slice(start, middle)) <= maxBytes) {
      end = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (end > start && end < value.length && value.charCodeAt(end) >= 0xdc00 && value.charCodeAt(end) <= 0xdfff) {
    end -= 1;
  }

  return value.slice(start, Math.max(start + 1, end));
}

function lineCount(value: string): number {
  if (!value) {
    return 0;
  }
  return value.split("\n").length - (value.endsWith("\n") ? 1 : 0);
}

export function chunkContextParts(
  parts: ContextPart[],
  maxPartBytes: number,
  maxTotalBytes = Number.MAX_SAFE_INTEGER
): ContextPart[] {
  if (maxPartBytes <= 0 || maxTotalBytes <= 0) {
    return [];
  }

  const chunks: ContextPart[] = [];
  let totalBytes = 0;

  for (const part of parts) {
    if (totalBytes >= maxTotalBytes || !part.content) {
      break;
    }

    let offset = 0;
    const partChunks: Array<{
      content: string;
      startLine: number;
      endLine: number;
      byteStart: number;
      byteEnd: number;
    }> = [];
    while (offset < part.content.length && totalBytes < maxTotalBytes) {
      const remainingBytes = maxTotalBytes - totalBytes;
      const content = takeUtf8Chunk(
        part.content,
        offset,
        Math.min(maxPartBytes, remainingBytes)
      );
      if (!content) {
        break;
      }

      const startLine = (part.startLine ?? 1) + lineCount(part.content.slice(0, offset));
      const endLine = startLine + lineCount(content) - 1;

      partChunks.push({
        content,
        startLine,
        endLine,
        byteStart: utf8Length(part.content.slice(0, offset)),
        byteEnd: utf8Length(part.content.slice(0, offset + content.length))
      });

      totalBytes += utf8Length(content);
      offset += content.length;
    }

    const chunkCount = partChunks.length;
    const totalPartBytes = utf8Length(part.content);
    partChunks.forEach((chunk, index) => {
      chunks.push({
        ...part,
        content: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        chunkIndex: index + 1,
        chunkCount,
        byteStart: chunk.byteStart,
        byteEnd: chunk.byteEnd,
        totalBytes: totalPartBytes,
        hasMore: index + 1 < chunkCount || chunk.byteEnd < totalPartBytes
      });
    });
  }

  return chunks;
}

export function resolveRequestContext(options: {
  mode: InteractionMode;
  selected: ContextPart[];
  investigated: ContextFile[];
  evidence: ContextEvidence[];
  indexSummary: string;
  maxFiles: number;
}): AIContext {
  flow("resolveRequestContext", 1, "enter", { mode: options.mode, maxFiles: options.maxFiles });
  const selected = options.selected
    .filter((part) => isSafeContextPath(part.path))
    .slice(0, options.maxFiles);

  if (options.mode === "ask") {
    return {
      files: [],
      indexSummary: options.indexSummary,
      evidence: selected.map((part) => ({
        path: part.path,
        score: 1,
        reason: part.kind === "selection"
          ? "User-selected code"
          : "Explicitly attached context",
        matchedSymbols: [],
        matchedTerms: []
      })),
      parts: selected
    };
  }

  const files: ContextFile[] = [];
  // Selected context is sent through `parts` and rendered as selected context
  // by the backend. Keep it out of `files` to avoid sending and counting it twice.
  const seen = new Set(selected.map((part) => part.path));

  // Add only separately investigated evidence to the project-file context.
  for (const file of options.investigated) {
    if (files.length >= options.maxFiles) {
      break;
    }
    if (!isSafeContextPath(file.path) || seen.has(file.path)) {
      continue;
    }
    seen.add(file.path);
    files.push(file);
  }

  const selectedEvidence = selected.map((part) => ({
    path: part.path,
    score: 100,
    reason: part.kind === "selection"
      ? `User-selected code (${part.startLine ?? "?"}-${part.endLine ?? "?"})`
      : "User-attached file (priority context)",
    matchedSymbols: [] as string[],
    matchedTerms: [] as string[]
  }));

  const otherEvidence = options.evidence.filter(
    (item) => seen.has(item.path) && !selectedEvidence.some((s) => s.path === item.path)
  );

  return {
    files,
    indexSummary: options.indexSummary,
    evidence: [...selectedEvidence, ...otherEvidence],
    parts: selected
  };
}
