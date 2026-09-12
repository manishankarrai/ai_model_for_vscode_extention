import { createHash } from "node:crypto";
import { previewDiff } from "../quality/diffPreview.ts";
import type { CodeChange } from "../models/types.ts";
export interface DiffHunk {
    id: string;
    startLine: number;
    lines: Array<{
        type: "context" | "removed" | "added";
        text: string;
    }>;
}
export interface FileChangeReview {
    path: string;
    originalHash: string;
    updatedHash: string;
    hunks: DiffHunk[];
}
export type ChangeSetStatus = "proposed" | "partially_approved" | "applied" | "rolled_back" | "rejected";
export interface ChangeSetAuditRecord {
    at: number;
    action: string;
    detail: string;
}
export interface NamedChangeSet {
    id: string;
    name: string;
    createdAt: number;
    status: ChangeSetStatus;
    files: FileChangeReview[];
    approvedPaths: string[];
    approvedHunkIds: string[];
    appliedSnapshot: Array<{
        path: string;
        original: string;
        updated: string;
    }>;
    audit: ChangeSetAuditRecord[];
}
export function contentHash(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}
export function splitHunks(path: string, original: string, updated: string): DiffHunk[] {
    const lines = previewDiff(original, updated);
    if (lines.length === 0) {
        return [];
    }
    const hunks: DiffHunk[] = [];
    let current: DiffHunk | undefined;
    let lineNo = 1;
    let hunkIndex = 0;
    const flush = () => {
        if (!current || current.lines.length === 0) {
            current = undefined;
            return;
        }
        hunks.push(current);
        current = undefined;
    };
    for (const line of lines) {
        const isChange = line.type === "added" || line.type === "removed";
        if (isChange && !current) {
            hunkIndex += 1;
            current = {
                id: `${path}#h${hunkIndex}`,
                startLine: lineNo,
                lines: []
            };
        }
        if (current) {
            current.lines.push(line);
            if (!isChange && current.lines.length > 0) {
                const trailingContext = current.lines.filter((item) => item.type === "context").length;
                if (trailingContext >= 2) {
                    flush();
                }
            }
        }
        if (line.type !== "added") {
            lineNo += 1;
        }
    }
    flush();
    return hunks;
}
export function buildFileReview(change: CodeChange): FileChangeReview {
    return {
        path: change.path,
        originalHash: contentHash(change.original),
        updatedHash: contentHash(change.updated),
        hunks: splitHunks(change.path, change.original, change.updated)
    };
}
export function createNamedChangeSet(changes: CodeChange[], name?: string): NamedChangeSet {
    const createdAt = Date.now();
    const id = `cs_${createdAt.toString(36)}_${contentHash(changes.map((c) => c.path).join("|")).slice(0, 8)}`;
    const files = changes.map(buildFileReview);
    return {
        id,
        name: name?.trim() || `Change set ${new Date(createdAt).toISOString()}`,
        createdAt,
        status: "proposed",
        files,
        approvedPaths: [],
        approvedHunkIds: [],
        appliedSnapshot: [],
        audit: [{
                at: createdAt,
                action: "created",
                detail: `${files.length} file(s) proposed`
            }]
    };
}
export function applyHunkApprovals(original: string, updated: string, hunkIds: string[], allHunks: DiffHunk[]): string {
    if (hunkIds.length === 0) {
        return original;
    }
    if (allHunks.length > 0 && hunkIds.length >= allHunks.length) {
        return updated;
    }
    const approved = new Set(hunkIds);
    if (allHunks.every((hunk) => approved.has(hunk.id))) {
        return updated;
    }
    return original;
}
export class ChangeSetStore {
    private readonly history: NamedChangeSet[] = [];
    private readonly maxHistory = 20;
    record(changeSet: NamedChangeSet): void {
        this.history.unshift(changeSet);
        if (this.history.length > this.maxHistory) {
            this.history.length = this.maxHistory;
        }
    }
    update(changeSet: NamedChangeSet): void {
        const index = this.history.findIndex((item) => item.id === changeSet.id);
        if (index >= 0) {
            this.history[index] = changeSet;
            return;
        }
        this.record(changeSet);
    }
    list(): NamedChangeSet[] {
        return [...this.history];
    }
    get(id: string): NamedChangeSet | undefined {
        return this.history.find((item) => item.id === id);
    }
    latestApplied(): NamedChangeSet | undefined {
        return this.history.find((item) => item.status === "applied");
    }
}
