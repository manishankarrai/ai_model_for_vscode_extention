import type { AIContext, ContextEvidence, ContextFile, ContextPart, InteractionMode, SearchResult } from "../models/types.ts";
export function isSafeContextPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, "/").toLowerCase();
    return !normalized.startsWith("/") &&
        !normalized.split("/").includes("..") &&
        !normalized.endsWith(".pem") &&
        !normalized.endsWith(".key");
}
export function selectRankedFiles(ranked: SearchResult[], maxFiles: number): SearchResult[] {
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
}): AIContext {
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
    const investigatedByPath = new Map(options.investigated
        .filter((file) => isSafeContextPath(file.path))
        .map((file) => [file.path, file] as const));
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
    for (const part of selected) {
        if (files.length >= options.maxFiles) {
            break;
        }
        if (part.kind !== "selection" || seen.has(part.path)) {
            continue;
        }
        seen.add(part.path);
        const full = investigatedByPath.get(part.path);
        files.push(full ?? { path: part.path, content: part.content });
    }
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
    const otherEvidence = options.evidence.filter((item) => seen.has(item.path) && !selectedEvidence.some((s) => s.path === item.path));
    return {
        files,
        indexSummary: options.indexSummary,
        evidence: [...selectedEvidence, ...otherEvidence],
        parts: selected
    };
}
