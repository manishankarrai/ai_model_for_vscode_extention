import { flow } from "../utils/flowLog.ts";

import type {
  AIContext,
  ContextEvidence,
  ContextFile,
  ContextPart,
  InteractionMode,
  SearchResult,
  SelectionScope
} from "../models/types.ts";

export function isSafeContextPath(filePath: string): boolean {
  flow("isSafeContextPath", 1, "enter");
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();

  return !normalized.startsWith("/") &&
    !normalized.split("/").includes("..") &&
    !normalized.endsWith(".pem") &&
    !normalized.endsWith(".key");
}

function selectionMarker(language: string, marker: string): string {
  if (["python", "ruby", "shellscript", "yaml", "perl"].includes(language.toLowerCase())) {
    return `# ${marker}`;
  }
  if (["html", "xml", "css"].includes(language.toLowerCase())) {
    return `<!-- ${marker} -->`;
  }
  return `// ${marker}`;
}

// Wraps the user-selected lines with explicit markers inside the full file
// content so the AI cannot mistake the whole file for the intended edit scope.
export function annotateSelectedRegion(
  content: string,
  startLine: number,
  endLine: number,
  language = ""
): string {
  const lines = content.split("\n");
  if (!startLine || !endLine || startLine < 1 || endLine < startLine || startLine > lines.length) {
    return content;
  }

  const startIndex = startLine - 1;
  const endIndex = Math.min(endLine, lines.length) - 1;

  return [
    ...lines.slice(0, startIndex),
    selectionMarker(
      language,
      `>>>>>> MM3 SELECTION START (line ${startLine}) - restrict changes to this block unless the request clearly needs more >>>>>>`
    ),
    ...lines.slice(startIndex, endIndex + 1),
    selectionMarker(language, `<<<<<< MM3 SELECTION END (line ${endLine}) <<<<<<`),
    ...lines.slice(endIndex + 1)
  ].join("\n");
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

export function resolveRequestContext(options: {
  mode: InteractionMode;
  selected: ContextPart[];
  investigated: ContextFile[];
  evidence: ContextEvidence[];
  indexSummary: string;
  maxFiles: number;
  selectionScope?: SelectionScope;
}): AIContext {
  flow("resolveRequestContext", 1, "enter", { mode: options.mode, maxFiles: options.maxFiles });
  const selected = options.selected
    .filter((part) => isSafeContextPath(part.path))
    .slice(0, options.maxFiles);

  if (options.mode === "ask") {
    return {
      files: selected.map((part) => ({
        path: part.path,
        content: part.content
      })),
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
  const seen = new Set<string>();
  const investigatedByPath = new Map(
    options.investigated
      .filter((file) => isSafeContextPath(file.path))
      .map((file) => [file.path, file] as const)
  );

  const selectionScope = options.selectionScope ?? (selected.length > 0 ? "selection" : "workspace");
  if (selectionScope !== "workspace") {
    return {
      files: selected.map((part) => ({
        path: part.path,
        content: part.content
      })),
      indexSummary: options.indexSummary,
      evidence: selected.map((part) => ({
        path: part.path,
        score: 1,
        reason: selectionScope === "selection"
          ? "User-selected code is the complete AI context"
          : "User-attached full file is the complete AI context",
        matchedSymbols: [],
        matchedTerms: []
      })),
      parts: selected
    };
  }

  // 1) Selected full-file attachments first (workspace mode only).
  for (const part of selected) {
    if (files.length >= options.maxFiles) {
      break;
    }
    if (part.kind === "selection" || seen.has(part.path)) {
      continue;
    }
    seen.add(part.path);
    files.push({ path: part.path, content: part.content });
  }

  // 2) Selected selection paths: prefer full investigated content when available.
  for (const part of selected) {
    if (files.length >= options.maxFiles) {
      break;
    }
    if (part.kind !== "selection" || seen.has(part.path)) {
      continue;
    }
    seen.add(part.path);
    const full = investigatedByPath.get(part.path);
    if (full && part.startLine && part.endLine) {
      files.push({
        path: part.path,
        content: annotateSelectedRegion(
          full.content,
          part.startLine,
          part.endLine,
          part.language
        )
      });
    } else {
      files.push(full ?? { path: part.path, content: part.content });
    }
  }

  // 3) Remaining investigated evidence.
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
      ? `User-selected code (lines ${part.startLine ?? "?"}-${part.endLine ?? "?"}) - marked with MM3 SELECTION START/END in the file below; restrict changes to that block`
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
