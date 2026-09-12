import { ProjectIndex, SearchResult } from "../models/types";
import { ReadOnlyToolRegistry } from "../tools/ReadOnlyToolRegistry";
import { DependencyResolver } from "../intelligence/DependencyResolver";
import { SymbolRelationshipGraph } from "../intelligence/SymbolRelationshipGraph";
import { Logger } from "../utils/Logger";
import { InvestigationState } from "../intelligence/InvestigationState";
export interface InvestigationStep {
    step: number;
    action: "search" | "read_file" | "follow_symbol" | "follow_dependency";
    target: string;
    reason: string;
    files: string[];
    completed: boolean;
}
export interface InvestigationEvidence {
    path: string;
    score: number;
    reason: string;
    content: string;
    symbols: string[];
    dependencies: string[];
    relatedSymbols?: string[];
}
export interface InvestigationResult {
    question: string;
    steps: InvestigationStep[];
    evidence: InvestigationEvidence[];
    filesInvestigated: string[];
    completed: boolean;
    stoppedReason: "completed" | "max_steps" | "max_files" | "max_chars";
}
export interface InvestigationOptions {
    maxSteps?: number;
    maxFiles?: number;
    maxChars?: number;
}
export class InvestigationEngine {
    private readonly tools = new ReadOnlyToolRegistry();
    private readonly dependencyResolver = new DependencyResolver();
    private readonly symbolGraph: SymbolRelationshipGraph;
    constructor(private readonly logger: Logger) {
        this.symbolGraph =
            new SymbolRelationshipGraph(logger);
    }
    async investigate(question: string, index: ProjectIndex, rankedResults: SearchResult[], options: InvestigationOptions = {}): Promise<InvestigationResult> {
        const maxSteps = options.maxSteps ?? 1000;
        const maxFiles = options.maxFiles ?? 1000;
        const maxChars = options.maxChars ?? 5000000;
        const state = new InvestigationState();
        const steps: InvestigationStep[] = [];
        const evidence: InvestigationEvidence[] = [];
        this.symbolGraph.build(index);
        if (state.steps >= maxSteps) {
            return this.createResult(question, steps, evidence, state, "max_steps");
        }
        steps.push({
            step: steps.length + 1,
            action: "search",
            target: question,
            reason: "use ranked search results as investigation starting points",
            files: rankedResults.map(result => result.path),
            completed: true
        });
        state.incrementSteps();
        for (const result of rankedResults) {
            state.queueFile(result.path);
        }
        while (state.pendingCount > 0) {
            if (state.steps >= maxSteps) {
                return this.createResult(question, steps, evidence, state, "max_steps");
            }
            if (state.investigatedCount >= maxFiles) {
                return this.createResult(question, steps, evidence, state, "max_files");
            }
            if (state.totalChars >= maxChars) {
                return this.createResult(question, steps, evidence, state, "max_chars");
            }
            const filePath = state.nextFile();
            if (!filePath) {
                break;
            }
            if (state.isInvestigated(filePath)) {
                continue;
            }
            let content: string;
            try {
                content =
                    await this.tools.readFile.execute(filePath);
            }
            catch (error) {
                continue;
            }
            state.markInvestigated(filePath);
            state.addChars(content.length);
            if (state.steps >= maxSteps) {
                return this.createResult(question, steps, evidence, state, "max_steps");
            }
            steps.push({
                step: steps.length + 1,
                action: "read_file",
                target: filePath,
                reason: "inspect relevant implementation",
                files: [
                    filePath
                ],
                completed: true
            });
            state.incrementSteps();
            this.symbolGraph
                .addFileReferenceRelationships(filePath, content, index);
            await this.symbolGraph
                .buildCallRelationships(filePath, index);
            const indexedFile = index.files.get(filePath);
            if (!indexedFile) {
                continue;
            }
            const relatedSymbols: string[] = [];
            for (const symbol of indexedFile.symbols) {
                const relationships = this.symbolGraph
                    .getRelatedSymbols(symbol);
                for (const relationship of relationships) {
                    relatedSymbols.push(`${relationship.to.name} (${relationship.type})`);
                }
            }
            const uniqueRelatedSymbols = [
                ...new Set(relatedSymbols)
            ];
            evidence.push({
                path: filePath,
                score: this.getEvidenceScore(filePath, rankedResults),
                reason: this.getEvidenceReason(filePath, rankedResults),
                content: this.limitContent(content, maxChars -
                    (state.totalChars -
                        content.length)),
                symbols: indexedFile.symbols.map(symbol => symbol.name),
                dependencies: indexedFile.dependencies.map(dependency => dependency.target),
                relatedSymbols: uniqueRelatedSymbols
            });
            for (const dependency of indexedFile.dependencies) {
                if (state.steps >= maxSteps) {
                    break;
                }
                if (state.hasFollowedDependency(dependency.source, dependency.target)) {
                    continue;
                }
                state.markDependencyFollowed(dependency.source, dependency.target);
                const resolvedFiles = await this.dependencyResolver.resolve(dependency, index);
                if (resolvedFiles.length === 0) {
                    continue;
                }
                for (const resolvedFile of resolvedFiles) {
                    if (state.isInvestigated(resolvedFile)) {
                        continue;
                    }
                    state.queueFile(resolvedFile);
                }
                if (state.steps >= maxSteps) {
                    break;
                }
                steps.push({
                    step: steps.length + 1,
                    action: "follow_dependency",
                    target: dependency.target,
                    reason: `follow project dependency from ${dependency.source}`,
                    files: resolvedFiles,
                    completed: true
                });
                state.incrementSteps();
            }
            for (const symbol of indexedFile.symbols) {
                if (state.steps >= maxSteps) {
                    break;
                }
                const relationships = this.symbolGraph
                    .getRelatedSymbols(symbol);
                const callRelationships = relationships.filter(relationship => relationship.type === "call");
                for (const relationship of callRelationships) {
                    if (state.steps >= maxSteps) {
                        break;
                    }
                    const targetFile = relationship.to.filePath;
                    if (state.isInvestigated(targetFile)) {
                        continue;
                    }
                    if (state.hasFollowedCall(relationship.from.filePath, relationship.from.name, relationship.to.filePath, relationship.to.name)) {
                        continue;
                    }
                    state.markCallFollowed(relationship.from.filePath, relationship.from.name, relationship.to.filePath, relationship.to.name);
                    const queued = state.queueFile(targetFile);
                    if (!queued) {
                        continue;
                    }
                    steps.push({
                        step: steps.length + 1,
                        action: "follow_symbol",
                        target: relationship.to.name,
                        reason: relationship.reason,
                        files: [
                            targetFile
                        ],
                        completed: true
                    });
                    state.incrementSteps();
                }
            }
        }
        return this.createResult(question, steps, evidence, state, "completed");
    }
    private getEvidenceScore(filePath: string, rankedResults: SearchResult[]): number {
        const result = rankedResults.find(item => item.path === filePath);
        return result?.score ?? 0;
    }
    private getEvidenceReason(filePath: string, rankedResults: SearchResult[]): string {
        const result = rankedResults.find(item => item.path === filePath);
        if (!result) {
            return ("file discovered through project relationships");
        }
        return result.reason;
    }
    private limitContent(content: string, remainingChars: number): string {
        if (remainingChars <= 0) {
            return "";
        }
        return content.slice(0, Math.min(content.length, remainingChars));
    }
    private createResult(question: string, steps: InvestigationStep[], evidence: InvestigationEvidence[], state: InvestigationState, stoppedReason: "completed" | "max_steps" | "max_files" | "max_chars"): InvestigationResult {
        return {
            question,
            steps,
            evidence,
            filesInvestigated: state.getInvestigatedFiles(),
            completed: stoppedReason ===
                "completed",
            stoppedReason
        };
    }
}
