export type InvestigationStopReason = "completed" | "max_steps" | "max_files" | "max_chars" | "max_ai_calls" | "max_tool_calls" | "loop_detected" | "timeout" | "insufficient_evidence" | "error";
export class InvestigationState {
    private readonly pendingFiles: string[] = [];
    private readonly queuedFiles = new Set<string>();
    private readonly investigatedFiles = new Set<string>();
    private readonly followedDependencies = new Set<string>();
    private readonly followedCalls = new Set<string>();
    private _totalChars = 0;
    private _steps = 0;
    private _aiCalls = 0;
    private _toolCalls = 0;
    private _stopReason: InvestigationStopReason | undefined;
    private readonly aiRequests = new Set<string>();
    private readonly aiRequestCounts = new Map<string, number>();
    private lastAIRequestKey = "";
    private consecutiveAIRequestCount = 0;
    readonly maxSteps = 1000;
    readonly maxFiles = 1000;
    readonly maxChars = 5000000;
    readonly maxAICalls = 1000;
    readonly maxToolCalls = 1000;
    get steps(): number {
        return this._steps;
    }
    startStep(): boolean {
        if (!this.canContinue()) {
            return false;
        }
        this._steps++;
        return true;
    }
    incrementSteps(): void {
        if (this.isStopped) {
            return;
        }
        if (this._steps >=
            this.maxSteps) {
            this.stop("max_steps");
            return;
        }
        this._steps++;
    }
    get aiCalls(): number {
        return this._aiCalls;
    }
    incrementAICalls(): boolean {
        if (this.isStopped) {
            return false;
        }
        if (this._aiCalls >=
            this.maxAICalls) {
            this.stop("max_ai_calls");
            return false;
        }
        this._aiCalls++;
        return true;
    }
    get toolCalls(): number {
        return this._toolCalls;
    }
    incrementToolCalls(): boolean {
        if (this.isStopped) {
            return false;
        }
        if (this._toolCalls >=
            this.maxToolCalls) {
            this.stop("max_tool_calls");
            return false;
        }
        this._toolCalls++;
        return true;
    }
    get totalChars(): number {
        return this._totalChars;
    }
    addChars(chars: number): boolean {
        if (chars <= 0) {
            return true;
        }
        if (this.isStopped) {
            return false;
        }
        const remaining = this.maxChars -
            this._totalChars;
        if (remaining <= 0) {
            this.stop("max_chars");
            return false;
        }
        const accepted = Math.min(chars, remaining);
        this._totalChars +=
            accepted;
        if (this._totalChars >=
            this.maxChars) {
            this.stop("max_chars");
        }
        return accepted === chars;
    }
    get pendingCount(): number {
        return this.pendingFiles.length;
    }
    get investigatedCount(): number {
        return this.investigatedFiles.size;
    }
    getInvestigatedFiles(): string[] {
        return [
            ...this.investigatedFiles
        ];
    }
    isQueued(filePath: string): boolean {
        return this.queuedFiles.has(filePath);
    }
    isInvestigated(filePath: string): boolean {
        return this.investigatedFiles.has(filePath);
    }
    queueFile(filePath: string): boolean {
        if (!filePath) {
            return false;
        }
        if (this.queuedFiles.has(filePath)) {
            return false;
        }
        if (this.investigatedFiles.has(filePath)) {
            return false;
        }
        if (this.investigatedFiles.size >=
            this.maxFiles) {
            this.stop("max_files");
            return false;
        }
        this.pendingFiles.push(filePath);
        this.queuedFiles.add(filePath);
        return true;
    }
    nextFile(): string | undefined {
        return this.pendingFiles.shift();
    }
    markInvestigated(filePath: string): void {
        if (!filePath) {
            return;
        }
        this.investigatedFiles.add(filePath);
        if (this.investigatedFiles.size >=
            this.maxFiles) {
            this.stop("max_files");
        }
    }
    hasFollowedDependency(source: string, target: string): boolean {
        return this.followedDependencies.has(`${source}->${target}`);
    }
    markDependencyFollowed(source: string, target: string): void {
        this.followedDependencies.add(`${source}->${target}`);
    }
    hasFollowedCall(sourceFile: string, sourceName: string, targetFile: string, targetName: string): boolean {
        return this.followedCalls.has([
            sourceFile,
            sourceName,
            targetFile,
            targetName
        ].join("->"));
    }
    markCallFollowed(sourceFile: string, sourceName: string, targetFile: string, targetName: string): void {
        this.followedCalls.add([
            sourceFile,
            sourceName,
            targetFile,
            targetName
        ].join("->"));
    }
    get stopReason(): InvestigationStopReason | undefined {
        return this._stopReason;
    }
    stop(reason: InvestigationStopReason): void {
        if (this._stopReason) {
            return;
        }
        this._stopReason =
            reason;
    }
    get isStopped(): boolean {
        return (this._stopReason !==
            undefined);
    }
    canContinue(): boolean {
        if (this.isStopped) {
            return false;
        }
        if (this._steps >=
            this.maxSteps) {
            this.stop("max_steps");
            return false;
        }
        if (this.investigatedFiles.size >=
            this.maxFiles) {
            this.stop("max_files");
            return false;
        }
        if (this._totalChars >=
            this.maxChars) {
            this.stop("max_chars");
            return false;
        }
        if (this._aiCalls >=
            this.maxAICalls) {
            this.stop("max_ai_calls");
            return false;
        }
        if (this._toolCalls >=
            this.maxToolCalls) {
            this.stop("max_tool_calls");
            return false;
        }
        return true;
    }
    hasAIRequest(requestKey: string): boolean {
        return this.aiRequests.has(requestKey);
    }
    recordAIRequest(requestKey: string): boolean {
        if (!requestKey) {
            return true;
        }
        const previousCount = this.aiRequestCounts.get(requestKey) ?? 0;
        const nextCount = previousCount + 1;
        this.aiRequestCounts.set(requestKey, nextCount);
        this.aiRequests.add(requestKey);
        if (requestKey === this.lastAIRequestKey) {
            this.consecutiveAIRequestCount += 1;
        }
        else {
            this.lastAIRequestKey = requestKey;
            this.consecutiveAIRequestCount = 1;
        }
        return true;
    }
    clearPathInspectionKeys(path: string): void {
        const normalized = path.trim();
        if (!normalized) {
            return;
        }
        for (const key of [...this.aiRequestCounts.keys()]) {
            if (key.startsWith(`read_file|${normalized}|`) ||
                key.startsWith(`get_diagnostics|${normalized}|`)) {
                this.aiRequestCounts.delete(key);
                this.aiRequests.delete(key);
            }
        }
        if (this.lastAIRequestKey.startsWith(`read_file|${normalized}|`) ||
            this.lastAIRequestKey.startsWith(`get_diagnostics|${normalized}|`)) {
            this.lastAIRequestKey = "";
            this.consecutiveAIRequestCount = 0;
        }
    }
    getSnapshot() {
        return {
            steps: this._steps,
            aiCalls: this._aiCalls,
            toolCalls: this._toolCalls,
            totalChars: this._totalChars,
            pendingFiles: this.pendingFiles.length,
            investigatedFiles: this.investigatedFiles.size,
            followedDependencies: this.followedDependencies.size,
            followedCalls: this.followedCalls.size,
            aiRequests: this.aiRequests.size,
            stopReason: this._stopReason
        };
    }
}
