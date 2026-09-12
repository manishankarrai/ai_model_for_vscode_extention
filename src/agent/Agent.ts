import * as vscode from "vscode";
import { AIRequest, AIResponse, AIContext, AgentProfile, AgentEvent, AgentTaskStatus, ContextPart, ContextFile, InteractionMode, InvestigationResult, ImplementationPlan, } from "../models/types";
import { IntentDetector } from "./IntentDetector";
import { Planner } from "./Planner";
import { ToolSelector } from "./ToolSelector";
import { InvestigationEngine } from "./InvestigationEngine";
import { InvestigationState } from "../intelligence/InvestigationState";
import { ProjectIndexer } from "../intelligence/ProjectIndexer";
import { SearchEngine } from "../intelligence/SearchEngine";
import { RelevanceRanker } from "../intelligence/RelevanceRanker";
import { ContextBuilder, InvestigationContextEvidence } from "../intelligence/ContextBuilder";
import { BackendClient } from "../backend/BackendClient";
import { ConversationState } from "../state/ConversationState";
import { TaskState } from "../state/TaskState";
import { TokenEstimator } from "../utils/TokenEstimator";
import { Logger } from "../utils/Logger";
import { ReadOnlyGuard } from "../safety/ReadOnlyGuard";
import { ProjectUnderstanding } from "../project/project-understanding";
import { ProjectMemory } from "../state/ProjectMemory";
import { resolveRequestContext } from "../intelligence/contextSelection";
import { getToolPolicy, isToolAllowed } from "../tools/toolPolicy";
import { WorkspaceToolRegistry } from "../tools/WorkspaceToolRegistry";
import type { AgentToolName, CodeChange } from "../models/types";
import { CodeChangeApplier } from "../safety/CodeChangeApplier";
type AdaptiveToolName = AgentToolName;
interface AdaptiveToolRequest {
    tool: AdaptiveToolName;
    path?: string;
    targetPath?: string;
    target_path?: string;
    query?: string;
    command?: string;
    content?: string;
    original?: string;
    updated?: string;
    taskName?: string;
    task_name?: string;
    changes?: CodeChange[];
    reason?: string;
}
interface AdaptiveDecision {
    action: "FINAL_ANSWER" | "CONTINUE_INVESTIGATION";
    answer?: string;
    confidence: number;
    reason?: string;
    tool?: AdaptiveToolRequest;
}
type AdaptiveAIResponse = AIResponse & {
    decision?: AdaptiveDecision;
    implementation_plan?: ImplementationPlan;
};
type AdaptiveAIRequest = AIRequest & {
    step?: number;
};
const ADAPTIVE_MAX_SEARCH_RESULTS = 10;
const ADAPTIVE_MAX_LIST_FILES = 10;
const ADAPTIVE_MAX_FILE_CHARS = 20000;
export class Agent {
    private readonly intentDetector = new IntentDetector();
    private readonly planner = new Planner();
    private readonly toolSelector = new ToolSelector();
    private readonly searchEngine = new SearchEngine();
    private readonly ranker = new RelevanceRanker();
    private readonly contextBuilder = new ContextBuilder();
    private readonly backend = new BackendClient();
    private lastRequest?: AdaptiveAIRequest;
    private readonly tokenEstimator = new TokenEstimator();
    private readonly investigationEngine: InvestigationEngine;
    private readonly workspaceTools: WorkspaceToolRegistry;
    constructor(private readonly indexer: ProjectIndexer, private readonly projectUnderstanding: ProjectUnderstanding, private readonly conversation: ConversationState, private readonly taskState: TaskState, private readonly projectMemory: ProjectMemory, private readonly logger: Logger, changeApplier = new CodeChangeApplier()) {
        this.workspaceTools =
            new WorkspaceToolRegistry(changeApplier);
        this.investigationEngine =
            new InvestigationEngine(logger);
    }
    async process(question: string, accessToken: string, selectedContext: ContextPart[] = [], mode: InteractionMode = "agent", agentProfile: AgentProfile = mode === "ask" ? "ask" : "coordinator", agentCount = 1, signal?: AbortSignal, onEvent?: (event: AgentEvent) => void): Promise<AIResponse> {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            throw new Error("Please open a workspace first.");
        }
        if (!question.trim()) {
            throw new Error("Question cannot be empty.");
        }
        const intent = this.intentDetector.detect(question);
        const requestId = this.createRequestId();
        if (onEvent && mode === "agent") {
            void this.backend.streamAgentEvents(requestId, accessToken, onEvent, signal).catch(async (error: unknown) => {
                try {
                    const task = await this.backend.getAgentTask(requestId, accessToken);
                    for (const event of (task as AgentTaskStatus).events ?? []) {
                        onEvent(event);
                    }
                }
                catch (statusError) {
                }
            });
        }
        this.taskState.start(requestId, question, intent);
        this.conversation.addUserMessage(question);
        try {
            let index = this.indexer.getIndex();
            if (!index) {
                this.taskState.setStatus("investigating");
                index =
                    await this.indexer.build(workspace.uri);
            }
            const projectModel = this.projectUnderstanding.getModel();
            this.taskState.setStatus("planning");
            const plan = this.planner.createPlan(intent, question);
            const selectedTools = this.toolSelector.select(intent);
            for (const tool of selectedTools) {
                ReadOnlyGuard.assertAllowed(tool, mode);
            }
            this.taskState.setStatus("investigating");
            const searchResults = mode === "ask"
                ? []
                : await this.searchEngine.search(question, index, 50);
            const ranked = this.ranker.rank(question, index, searchResults, projectModel);
            let investigation: InvestigationResult;
            if (mode === "ask") {
                investigation = {
                    question,
                    steps: [],
                    evidence: [],
                    filesInvestigated: [],
                    completed: true,
                    stoppedReason: "completed"
                };
            }
            else {
                investigation =
                    await this.investigationEngine.investigate(question, index, ranked, {
                        maxSteps: plan.maxSteps,
                        maxFiles: plan.maxFiles,
                        maxChars: plan.maxChars
                    });
            }
            this.projectMemory.addInvestigationArtifacts({
                findings: investigation.evidence
                    .slice(0, 8)
                    .map(evidence => `${evidence.path}: ${evidence.reason}`),
                dependencies: investigation.evidence
                    .flatMap(evidence => evidence.dependencies)
                    .slice(0, 25),
                conventions: projectModel?.frameworks.map(framework => `Framework: ${framework}`) ?? [],
                architectureNotes: projectModel?.entryPoints.map(entry => `Entry point: ${entry.filePath}`) ?? []
            });
            void this.projectMemory.save();
            const config = vscode.workspace
                .getConfiguration("mm3");
            const maxFiles = config.get<number>("maxFilesInContext", 1000);
            const maxChars = config.get<number>("maxContextChars", 5000000);
            const investigationEvidence: InvestigationContextEvidence[] = investigation.evidence.map(evidence => ({
                path: evidence.path,
                score: evidence.score,
                reason: evidence.reason,
                content: evidence.content,
                symbols: evidence.symbols,
                dependencies: evidence.dependencies,
                relatedSymbols: evidence.relatedSymbols
            }));
            let context: AIContext;
            if (mode === "ask") {
                context = resolveRequestContext({
                    mode,
                    selected: selectedContext,
                    investigated: [],
                    evidence: [],
                    indexSummary: "",
                    maxFiles
                });
            }
            else {
                const investigated = await this.contextBuilder.build(index, ranked, projectModel, {
                    maxFiles,
                    maxChars
                }, investigationEvidence);
                const selectedFiles = await this.readSelectedWorkspaceFiles(selectedContext);
                context = resolveRequestContext({
                    mode,
                    selected: selectedContext,
                    investigated: [...selectedFiles, ...investigated.files],
                    evidence: investigated.evidence,
                    indexSummary: investigated.indexSummary,
                    maxFiles
                });
            }
            this.taskState.setFiles(context.files.map(file => file.path));
            const estimatedTokens = this.tokenEstimator.estimateFiles(context.files);
            const request: AdaptiveAIRequest = {
                action: intent,
                request_id: requestId,
                question,
                mode,
                tool_policy: getToolPolicy(mode),
                agent: {
                    profile: agentProfile,
                    count: Math.max(1, Math.min(agentCount, mode === "ask" ? 1 : 5))
                },
                project: {
                    id: this.createProjectId(workspace.uri),
                    name: workspace.name,
                    indexVersion: index.version
                },
                context,
                memory: this.projectMemory.getContextForAI(),
                plan: plan.steps
            };
            this.lastRequest = request;
            const response = await this.runAdaptiveInvestigation(request, accessToken, workspace.uri, index, projectModel, ranked, plan, context, signal, onEvent);
            this.taskState.setAICalls(response.usage.ai_api_calls);
            if (response.answer &&
                response.answer.trim()) {
                this.conversation.addAssistantMessage(response.answer);
            }
            this.taskState.complete();
            return response;
        }
        catch (error) {
            this.taskState.fail();
            throw error;
        }
    }
    async retrySpecialist(profile: AgentProfile, accessToken: string, signal?: AbortSignal): Promise<string> {
        if (!this.lastRequest || this.lastRequest.mode !== "agent") {
            throw new Error("No Agent request is available for specialist retry.");
        }
        const request = {
            ...this.lastRequest,
            agent: {
                profile,
                count: 1
            }
        };
        const result = await this.backend.retryAgent(request, request.request_id, profile, accessToken, signal) as {
            answer: string;
        };
        return result.answer;
    }
    private async readSelectedWorkspaceFiles(selected: ContextPart[]): Promise<ContextFile[]> {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace || selected.length === 0) {
            return [];
        }
        const files: ContextFile[] = [];
        const seen = new Set<string>();
        for (const part of selected) {
            const relativePath = part.path.replace(/\\/g, "/");
            if (!relativePath || seen.has(relativePath)) {
                continue;
            }
            seen.add(relativePath);
            try {
                const uri = vscode.Uri.joinPath(workspace.uri, ...relativePath.split("/"));
                const document = await vscode.workspace.openTextDocument(uri);
                files.push({
                    path: relativePath,
                    content: document.getText()
                });
            }
            catch {
                if (part.content) {
                    files.push({
                        path: relativePath,
                        content: part.content
                    });
                }
            }
        }
        return files;
    }
    private async runAdaptiveInvestigation(initialRequest: AdaptiveAIRequest, accessToken: string, workspaceUri: vscode.Uri, index: any, projectModel: any, ranked: any[], plan: any, initialContext: any, signal?: AbortSignal, onEvent?: (event: AgentEvent) => void): Promise<AIResponse> {
        const state = new InvestigationState();
        let request: AdaptiveAIRequest = initialRequest;
        let context = initialContext;
        const totalUsage = {
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            ai_api_calls: 0,
            estimated_cost: 0,
            charged_credits: 0,
            wallet_balance: 0
        };
        for (;;) {
            if (!state.startStep()) {
                throw new Error(`Adaptive investigation stopped: ${state.stopReason}`);
            }
            const currentStep = state.steps;
            if (!state.incrementAICalls()) {
                throw new Error(`Adaptive investigation stopped: ${state.stopReason}`);
            }
            request = {
                ...request,
                context,
                step: currentStep
            };
            this.taskState.setStatus("sending");
            const rawResponse = await this.backend.sendAIRequest(request, accessToken, signal);
            const response = rawResponse as AdaptiveAIResponse;
            totalUsage.input_tokens +=
                response.usage.input_tokens;
            totalUsage.output_tokens +=
                response.usage.output_tokens;
            totalUsage.total_tokens +=
                response.usage.total_tokens;
            totalUsage.ai_api_calls +=
                response.usage.ai_api_calls;
            totalUsage.estimated_cost +=
                response.usage.estimated_cost;
            totalUsage.charged_credits +=
                response.usage.charged_credits ??
                    response.usage.estimated_cost ??
                    0;
            if (typeof response.usage.wallet_balance === "number") {
                totalUsage.wallet_balance =
                    response.usage.wallet_balance;
            }
            if (!response.decision) {
                return {
                    ...response,
                    usage: totalUsage
                };
            }
            if (response.decision.action ===
                "FINAL_ANSWER") {
                const answer = response.answer?.trim()
                    ||
                        response.decision.answer?.trim()
                    ||
                        "";
                if (!answer) {
                    state.stop("insufficient_evidence");
                    throw new Error("Gemini returned FINAL_ANSWER without an answer.");
                }
                state.stop("completed");
                return {
                    ...response,
                    answer,
                    usage: totalUsage,
                    decision: response.decision
                };
            }
            if (response.decision.action !==
                "CONTINUE_INVESTIGATION") {
                state.stop("error");
                throw new Error(`Unknown adaptive decision: ${response.decision.action}`);
            }
            const tool = response.decision.tool;
            if (!tool) {
                state.stop("insufficient_evidence");
                throw new Error("Gemini requested CONTINUE_INVESTIGATION without a tool.");
            }
            this.validateAdaptiveTool(tool);
            const toolKey = this.createToolRequestKey(tool);
            state.recordAIRequest(toolKey);
            if (!state.incrementToolCalls()) {
                throw new Error(`Adaptive investigation stopped: ${state.stopReason}`);
            }
            this.taskState.setStatus("investigating");
            let evidence: Array<{
                path: string;
                content: string;
            }>;
            try {
                evidence =
                    await this.executeAdaptiveTool(tool, workspaceUri, index);
                const mutatingTools = new Set([
                    "edit_file",
                    "write_file",
                    "create_file",
                    "delete_file",
                    "rename_file",
                    "move_file",
                    "apply_change_set",
                    "apply_patch",
                    "get_diagnostics"
                ]);
                if (mutatingTools.has(tool.tool) && tool.path?.trim()) {
                    state.clearPathInspectionKeys(tool.path.trim());
                }
                const target = tool.targetPath ?? tool.target_path;
                if ((tool.tool === "rename_file" || tool.tool === "move_file") &&
                    target?.trim()) {
                    state.clearPathInspectionKeys(target.trim());
                }
                const fileChangeTools = new Set([
                    "edit_file",
                    "write_file",
                    "create_file",
                    "delete_file",
                    "rename_file",
                    "move_file",
                    "apply_change_set",
                    "apply_patch"
                ]);
                if (onEvent && fileChangeTools.has(tool.tool)) {
                    const body = evidence
                        .map((item) => item.content)
                        .filter(Boolean)
                        .join("\n\n");
                    if (body.trim()) {
                        onEvent({
                            profile: (initialRequest.agent?.profile || "agent") as AgentEvent["profile"],
                            type: "progress",
                            message: "Updated `" + (tool.path || "file") + "`",
                            timestamp: Date.now()
                        });
                    }
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (message.includes("not approved")) {
                    throw error;
                }
                evidence = [{
                        path: `m3-tools/${tool.tool}.txt`,
                        content: `tool=${tool.tool}\nsuccess=false\n${message}`
                    }];
            }
            if (evidence.length === 0) {
                continue;
            }
            let addedChars = 0;
            let addedFiles = 0;
            for (const item of evidence) {
                if (state.isStopped) {
                    break;
                }
                if (state.totalChars >=
                    state.maxChars) {
                    state.stop("max_chars");
                    break;
                }
                const normalizedPath = this.normalizeRelativePath(item.path);
                if (!normalizedPath) {
                    continue;
                }
                if (this.isSensitivePath(normalizedPath)) {
                    continue;
                }
                const remaining = state.maxChars -
                    state.totalChars;
                if (remaining <= 0) {
                    state.stop("max_chars");
                    break;
                }
                const content = item.content.slice(0, Math.min(item.content.length, remaining, ADAPTIVE_MAX_FILE_CHARS));
                if (!content) {
                    continue;
                }
                const existingIndex = context.files.findIndex((file: any) => file.path ===
                    normalizedPath);
                if (existingIndex >= 0) {
                    context.files[existingIndex] = {
                        ...context.files[existingIndex],
                        content
                    };
                    const accepted = this.addEvidenceChars(state, content.length);
                    addedChars +=
                        accepted;
                    continue;
                }
                if (state.investigatedCount >=
                    state.maxFiles) {
                    state.stop("max_files");
                    break;
                }
                context.files.push({
                    path: normalizedPath,
                    content
                });
                state.markInvestigated(normalizedPath);
                const accepted = this.addEvidenceChars(state, content.length);
                addedChars +=
                    accepted;
                addedFiles++;
            }
            this.taskState.setFiles(context.files.map((file: any) => file.path));
            const adaptiveTokens = this.tokenEstimator.estimateFiles(context.files);
            if (state.isStopped) {
                throw new Error(`Adaptive investigation stopped: ${state.stopReason}`);
            }
            request = {
                ...request,
                context,
                step: currentStep
            };
        }
    }
    private addEvidenceChars(state: InvestigationState, chars: number): number {
        if (chars <= 0) {
            return 0;
        }
        const remaining = state.maxChars -
            state.totalChars;
        if (remaining <= 0) {
            state.stop("max_chars");
            return 0;
        }
        const accepted = Math.min(chars, remaining);
        state.addChars(accepted);
        return accepted;
    }
    private validateAdaptiveTool(tool: AdaptiveToolRequest): void {
        if (!isToolAllowed("agent", tool.tool)) {
            throw new Error(`Unsupported adaptive tool: ${tool.tool}`);
        }
        if (tool.tool === "read_file" && !tool.path?.trim()) {
            throw new Error("read_file requires a path.");
        }
        if (tool.tool === "search" && !tool.query?.trim()) {
            throw new Error("search requires a query.");
        }
        if ((tool.tool === "edit_file" || tool.tool === "write_file" || tool.tool === "create_file") &&
            !tool.path?.trim()) {
            throw new Error(`${tool.tool} requires a path.`);
        }
        if ((tool.tool === "edit_file" || tool.tool === "write_file" || tool.tool === "create_file") &&
            !(tool.updated ?? tool.content)?.length &&
            !tool.changes?.length) {
            throw new Error(`${tool.tool} requires file content.`);
        }
        if ((tool.tool === "delete_file") &&
            !tool.path?.trim()) {
            throw new Error("delete_file requires a path.");
        }
        if ((tool.tool === "move_file" || tool.tool === "rename_file") &&
            (!tool.path?.trim() || !(tool.targetPath ?? tool.target_path)?.trim())) {
            throw new Error(`${tool.tool} requires path and target_path.`);
        }
        if (tool.tool === "run_command" && !tool.command?.trim()) {
            throw new Error("run_command requires a command.");
        }
        if (tool.tool === "run_task" && !(tool.taskName ?? tool.task_name)?.trim()) {
            throw new Error("run_task requires a task_name.");
        }
        if ((tool.tool === "apply_change_set" || tool.tool === "apply_patch") &&
            !tool.changes?.length &&
            !(tool.path && (tool.updated ?? tool.content))) {
            throw new Error(`${tool.tool} requires changes.`);
        }
        if (!tool.reason?.trim()) {
        }
    }
    private async executeAdaptiveTool(tool: AdaptiveToolRequest, workspaceUri: vscode.Uri, index: any): Promise<Array<{
        path: string;
        content: string;
    }>> {
        if (tool.tool ===
            "read_file") {
            return this.executeAdaptiveReadFile(tool.path!, workspaceUri);
        }
        if (tool.tool ===
            "search") {
            return this.executeAdaptiveSearch(tool.query!, index, workspaceUri);
        }
        if (tool.tool ===
            "list_files") {
            return this.executeAdaptiveListFiles(workspaceUri);
        }
        const result = await this.workspaceTools.execute({
            tool: tool.tool,
            path: tool.path,
            targetPath: tool.targetPath ?? tool.target_path,
            query: tool.query,
            command: tool.command,
            content: tool.content,
            original: tool.original,
            updated: tool.updated,
            taskName: tool.taskName ?? tool.task_name,
            reason: tool.reason,
            changes: tool.changes
        }, "agent");
        return [{
                path: `m3-tools/${tool.tool}.txt`,
                content: [
                    `tool=${result.tool}`,
                    `success=${result.success}`,
                    result.output
                ].join("\n")
            }];
    }
    private async executeAdaptiveReadFile(relativePath: string, workspaceUri: vscode.Uri): Promise<Array<{
        path: string;
        content: string;
    }>> {
        const normalizedPath = this.normalizeRelativePath(relativePath);
        if (!normalizedPath) {
            throw new Error("Invalid file path.");
        }
        if (this.isSensitivePath(normalizedPath)) {
            throw new Error(`Access to sensitive file is blocked: ${normalizedPath}`);
        }
        const fileUri = vscode.Uri.joinPath(workspaceUri, ...normalizedPath.split("/"));
        try {
            const bytes = await vscode.workspace.fs.readFile(fileUri);
            let content = Buffer
                .from(bytes)
                .toString("utf8");
            if (content.length >
                ADAPTIVE_MAX_FILE_CHARS) {
                content =
                    content.slice(0, ADAPTIVE_MAX_FILE_CHARS);
            }
            return [
                {
                    path: normalizedPath,
                    content
                }
            ];
        }
        catch (error) {
            throw new Error(`Unable to read file: ${normalizedPath}`);
        }
    }
    private async executeAdaptiveSearch(query: string, index: any, workspaceUri: vscode.Uri): Promise<Array<{
        path: string;
        content: string;
    }>> {
        const searchResults = await this.searchEngine.search(query, index, ADAPTIVE_MAX_SEARCH_RESULTS);
        const results = searchResults.slice(0, ADAPTIVE_MAX_SEARCH_RESULTS);
        const evidence: Array<{
            path: string;
            content: string;
        }> = [];
        const seen = new Set<string>();
        for (const result of results) {
            const normalizedPath = this.normalizeRelativePath(result.path);
            if (!normalizedPath) {
                continue;
            }
            if (seen.has(normalizedPath)) {
                continue;
            }
            seen.add(normalizedPath);
            if (this.isSensitivePath(normalizedPath)) {
                continue;
            }
            try {
                const fileEvidence = await this.executeAdaptiveReadFile(normalizedPath, workspaceUri);
                evidence.push(...fileEvidence);
            }
            catch (error) {
            }
        }
        return evidence;
    }
    private async executeAdaptiveListFiles(workspaceUri: vscode.Uri): Promise<Array<{
        path: string;
        content: string;
    }>> {
        const uris = await vscode.workspace.findFiles("**/*", "**/{node_modules,.git,dist,build,out,coverage}/**", ADAPTIVE_MAX_LIST_FILES);
        const files: Array<{
            path: string;
            content: string;
        }> = [];
        for (const uri of uris) {
            const relative = vscode.workspace.asRelativePath(uri, false);
            const normalizedPath = this.normalizeRelativePath(relative);
            if (!normalizedPath) {
                continue;
            }
            if (this.isSensitivePath(normalizedPath)) {
                continue;
            }
            try {
                const fileEvidence = await this.executeAdaptiveReadFile(normalizedPath, workspaceUri);
                files.push(...fileEvidence);
            }
            catch (error) {
            }
        }
        return files;
    }
    private normalizeRelativePath(filePath: string): string {
        let normalized = filePath
            .replace(/\\/g, "/")
            .trim();
        while (normalized.startsWith("./")) {
            normalized =
                normalized.slice(2);
        }
        if (normalized.startsWith("/")) {
            return "";
        }
        if (/^[A-Za-z]:/.test(normalized)) {
            return "";
        }
        const parts = normalized.split("/");
        if (parts.some(part => part ===
            "..")) {
            return "";
        }
        return parts
            .filter(part => part.length > 0 &&
            part !== ".")
            .join("/");
    }
    private isSensitivePath(filePath: string): boolean {
        const normalized = filePath
            .replace(/\\/g, "/")
            .toLowerCase();
        const fileName = normalized
            .split("/")
            .pop() ?? "";
        const blockedExtensions = [
            ".pem",
            ".key",
            ".p12",
            ".pfx",
            ".crt",
            ".cer",
            ".der"
        ];
        if (blockedExtensions.some(extension => normalized.endsWith(extension))) {
            return true;
        }
        const blockedNames = [
            "id_rsa",
            "id_dsa",
            "id_ecdsa",
            "id_ed25519",
            "credentials",
            "credentials.json",
            "service-account.json"
        ];
        if (blockedNames.includes(fileName)) {
            return true;
        }
        if (fileName.includes("secret")
            ||
                fileName.includes("password")
            ||
                fileName.includes("token")) {
            return true;
        }
        return false;
    }
    private createToolRequestKey(tool: AdaptiveToolRequest): string {
        return [
            tool.tool,
            tool.path ?? "",
            tool.targetPath ?? tool.target_path ?? "",
            tool.query ?? "",
            tool.command ?? "",
            tool.taskName ?? tool.task_name ?? ""
        ].join("|");
    }
    getConversation() {
        return this.conversation.getMessages();
    }
    getTaskState() {
        return this.taskState.get();
    }
    clearConversation(): void {
        this.conversation.clear();
    }
    private createRequestId(): string {
        return [
            Date.now().toString(36),
            Math.random()
                .toString(36)
                .slice(2, 10)
        ].join("-");
    }
    private createProjectId(uri: vscode.Uri): string {
        let hash = 0;
        const value = uri.toString();
        for (let i = 0; i < value.length; i++) {
            hash =
                (hash << 5) -
                    hash +
                    value.charCodeAt(i);
            hash |= 0;
        }
        return `project-${Math.abs(hash)}`;
    }
}
