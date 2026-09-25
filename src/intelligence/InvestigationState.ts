import { flow } from "../utils/flowLog.ts";
import { adaptiveLimits } from "../config/adaptiveLimits.ts";

export type InvestigationStopReason =
  | "completed"
  | "max_steps"
  | "max_files"
  | "max_chars"
  | "max_ai_calls"
  | "max_tool_calls"
  | "timeout"
  | "insufficient_evidence"
  | "repeated_tool_failure"
  | "error";

export interface InvestigationLimits {
  maxSteps?: number;
  maxFiles?: number;
  maxChars?: number;
  maxAICalls?: number;
  maxToolCalls?: number;
}


export class InvestigationState {

  constructor(limits: InvestigationLimits = {}) {
    this.maxSteps = limits.maxSteps ?? adaptiveLimits.maxSteps;
    this.maxFiles = limits.maxFiles ?? adaptiveLimits.maxFiles;
    this.maxChars = limits.maxChars ?? adaptiveLimits.maxChars;
    this.maxAICalls = limits.maxAICalls ?? adaptiveLimits.maxAICalls;
    this.maxToolCalls = limits.maxToolCalls ?? adaptiveLimits.maxToolCalls;
  }

  // ==========================================================
  // Stage 3 — File Investigation State
  // ==========================================================

  private readonly pendingFiles:
    string[] = [];

  private readonly queuedFiles =
    new Set<string>();

  private readonly investigatedFiles =
    new Set<string>();

  private readonly followedDependencies =
    new Set<string>();

  private readonly followedCalls =
    new Set<string>();


  // ==========================================================
  // Evidence State
  // ==========================================================

  private _totalChars = 0;


  // ==========================================================
  // Stage 4 — Adaptive Reasoning State
  // ==========================================================
  //
  // A STEP represents one adaptive reasoning cycle:
  //
  //   Gemini
  //      ↓
  //   decision
  //      ↓
  //   optional local tool
  //      ↓
  //   evidence
  //
  // Example:
  //
  //   Step 1 → CONTINUE → read_file
  //   Step 2 → CONTINUE → search
  //   Step 3 → FINAL_ANSWER
  //
  // ==========================================================

  private _steps = 0;

  private _aiCalls = 0;

  private _toolCalls = 0;


  // ==========================================================
  // Stop State
  // ==========================================================

  private _stopReason:
    InvestigationStopReason | undefined;


  // ==========================================================
  // AI Request Telemetry
  // ==========================================================

  private readonly aiRequests =
    new Set<string>();

  /** How many times each exact tool key has been requested for telemetry. */
  private readonly aiRequestCounts =
    new Map<string, number>();


  // ==========================================================
  // Investigation Limits
  // ==========================================================

  /**
   * Maximum adaptive reasoning cycles.
   */
  readonly maxSteps: number;


  /**
   * Maximum number of files investigated.
   */
  readonly maxFiles: number;


  /**
   * Maximum evidence characters.
   */
  readonly maxChars: number;


  /**
   * Maximum AI API calls.
   */
  maxAICalls: number;


  /**
   * Maximum local tool calls (reads, edits, commands, etc.).
   */
  maxToolCalls: number;


  // ==========================================================
  // Steps
  // ==========================================================

  get steps(): number {
    return this._steps;
  }


  /**
   * Starts a new adaptive reasoning step.
   *
   * Returns false when the investigation cannot continue.
   */
  startStep(): boolean {
    flow("InvestigationState.startStep", 1, "enter");

    if (!this.canContinue()) {
      return false;
    }


    this._steps++;


    return true;
  }


  /**
   * Backward-compatible method for existing Stage 3 code.
   *
   * New Stage 4 code should prefer startStep().
   */
  incrementSteps(): void {
    flow("InvestigationState.incrementSteps", 1, "enter");

    if (this.isStopped) {
      return;
    }


    if (
      this._steps >=
      this.maxSteps
    ) {

      this.stop(
        "max_steps"
      );

      return;
    }


    this._steps++;
  }


  // ==========================================================
  // AI Calls
  // ==========================================================

  get aiCalls(): number {
    return this._aiCalls;
  }


  /**
   * Registers one Gemini API call.
   *
   * Returns false if the AI call limit has been reached.
   */
  incrementAICalls(): boolean {
    flow("InvestigationState.incrementAICalls", 1, "enter");

    if (this.isStopped) {
      return false;
    }


    if (
      this._aiCalls >=
      this.maxAICalls
    ) {

      this.stop(
        "max_ai_calls"
      );

      return false;
    }


    this._aiCalls++;


    return true;
  }

  extendAICalls(additional: number): boolean {
    flow("InvestigationState.extendAICalls", 1, "enter", { additional });

    if (additional <= 0 || this.stopReason !== "max_ai_calls") {
      return false;
    }

    this.maxAICalls += additional;
    this._stopReason = undefined;
    return true;
  }

  extendLimits(additionalToolCalls: number, additionalAICalls: number): boolean {
    flow("InvestigationState.extendLimits", 1, "enter", {
      additionalToolCalls,
      additionalAICalls
    });

    if (
      additionalToolCalls <= 0 ||
      additionalAICalls <= 0 ||
      (this.stopReason !== "max_ai_calls" && this.stopReason !== "max_tool_calls")
    ) {
      return false;
    }

    this.maxToolCalls += additionalToolCalls;
    this.maxAICalls += additionalAICalls;
    this._stopReason = undefined;
    return true;
  }


  // ==========================================================
  // Tool Calls
  // ==========================================================

  get toolCalls(): number {
    return this._toolCalls;
  }


  /**
   * Registers one local read-only tool call.
   *
   * Returns false if the tool-call limit has been reached.
   */
  incrementToolCalls(): boolean {
    flow("InvestigationState.incrementToolCalls", 1, "enter");

    if (this.isStopped) {
      return false;
    }


    if (
      this._toolCalls >=
      this.maxToolCalls
    ) {

      this.stop(
        "max_tool_calls"
      );

      return false;
    }


    this._toolCalls++;


    return true;
  }

  extendToolCalls(additional: number): boolean {
    flow("InvestigationState.extendToolCalls", 1, "enter", { additional });

    if (additional <= 0 || this.stopReason !== "max_tool_calls") {
      return false;
    }

    this.maxToolCalls += additional;
    this._stopReason = undefined;
    return true;
  }


  // ==========================================================
  // Characters
  // ==========================================================

  get totalChars(): number {
    return this._totalChars;
  }


  /**
   * Adds evidence character count for the current reasoning request.
   *
   * maxChars is a per-request evidence window, not a lifetime
   * investigation budget. Reaching it limits this request's evidence but
   * must not stop the investigation.
   */
  addChars(
    chars: number
  ): boolean {

    if (
      chars <= 0
    ) {

      return true;
    }


    if (this.isStopped) {
      return false;
    }


    const remaining =
      this.maxChars -
      this._totalChars;


    if (
      remaining <= 0
    ) {
      return false;
    }

    const accepted = Math.min(chars, remaining);
    this._totalChars += accepted;


    return accepted === chars;
  }


  /** Starts a fresh evidence window for the next reasoning request. */
  resetCharsForNextRequest(): void {
    flow("InvestigationState.resetCharsForNextRequest", 1, "enter");
    this._totalChars = 0;
  }


  // ==========================================================
  // Files
  // ==========================================================

  get pendingCount(): number {
    return this.pendingFiles.length;
  }


  get investigatedCount(): number {
    return this.investigatedFiles.size;
  }


  getInvestigatedFiles(): string[] {
    flow("InvestigationState.getInvestigatedFiles", 1, "enter");

    return [
      ...this.investigatedFiles
    ];
  }


  /**
   * Returns true when a file is waiting for investigation.
   */
  isQueued(
    filePath: string
  ): boolean {

    return this.queuedFiles.has(
      filePath
    );
  }


  /**
   * Returns true when a file has already been investigated.
   */
  isInvestigated(
    filePath: string
  ): boolean {

    return this.investigatedFiles.has(
      filePath
    );
  }


  /**
   * Queue a file for investigation.
   */
  queueFile(
    filePath: string
  ): boolean {

    if (!filePath) {
      return false;
    }


    if (
      this.queuedFiles.has(
        filePath
      )
    ) {

      return false;
    }


    if (
      this.investigatedFiles.has(
        filePath
      )
    ) {

      return false;
    }


    if (
      this.investigatedFiles.size >=
      this.maxFiles
    ) {

      this.stop(
        "max_files"
      );

      return false;
    }


    this.pendingFiles.push(
      filePath
    );


    this.queuedFiles.add(
      filePath
    );


    return true;
  }


  /**
   * Get the next queued file.
   */
  nextFile():
    string | undefined {

    return this.pendingFiles.shift();
  }


  /**
   * Mark a file as investigated.
   */
  markInvestigated(
    filePath: string
  ): void {

    if (!filePath) {
      return;
    }


    this.investigatedFiles.add(
      filePath
    );


    if (
      this.investigatedFiles.size >=
      this.maxFiles
    ) {

      this.stop(
        "max_files"
      );
    }
  }


  // ==========================================================
  // Dependencies
  // ==========================================================

  hasFollowedDependency(
    source: string,
    target: string
  ): boolean {

    return this.followedDependencies.has(
      `${source}->${target}`
    );
  }


  markDependencyFollowed(
    source: string,
    target: string
  ): void {

    this.followedDependencies.add(
      `${source}->${target}`
    );
  }


  // ==========================================================
  // Calls
  // ==========================================================

  hasFollowedCall(
    sourceFile: string,
    sourceName: string,
    targetFile: string,
    targetName: string
  ): boolean {

    return this.followedCalls.has(
      [
        sourceFile,
        sourceName,
        targetFile,
        targetName
      ].join("->")
    );
  }


  markCallFollowed(
    sourceFile: string,
    sourceName: string,
    targetFile: string,
    targetName: string
  ): void {

    this.followedCalls.add(
      [
        sourceFile,
        sourceName,
        targetFile,
        targetName
      ].join("->")
    );
  }


  // ==========================================================
  // Stop Reason
  // ==========================================================

  get stopReason():
    InvestigationStopReason | undefined {

    return this._stopReason;
  }


  /**
   * Stop the investigation.
   *
   * The first stop reason always wins.
   */
  stop(
    reason: InvestigationStopReason
  ): void {

    if (this._stopReason) {
      return;
    }


    this._stopReason =
      reason;
  }


  get isStopped(): boolean {

    return (
      this._stopReason !==
      undefined
    );
  }


  // ==========================================================
  // Central Continue Check
  // ==========================================================
  //
  // This is the main safety gate for Stage 4.
  //
  // Before every adaptive cycle:
  //
  //   state.canContinue()
  //
  // should be checked.
  //
  // ==========================================================

  canContinue(): boolean {
    flow("InvestigationState.canContinue", 1, "enter");

    // --------------------------------------------------------
    // Already stopped
    // --------------------------------------------------------

    if (this.isStopped) {
      return false;
    }


    // --------------------------------------------------------
    // Maximum adaptive reasoning steps
    // --------------------------------------------------------

    if (
      this._steps >=
      this.maxSteps
    ) {

      this.stop(
        "max_steps"
      );

      return false;
    }


    // --------------------------------------------------------
    // Maximum investigated files
    // --------------------------------------------------------

    if (
      this.investigatedFiles.size >=
      this.maxFiles
    ) {

      this.stop(
        "max_files"
      );

      return false;
    }


    return true;
  }


  // ==========================================================
  // AI Request Telemetry
  // ==========================================================

  /** Records an AI investigation request for telemetry only. */
  recordAIRequest(
    requestKey: string
  ): boolean {

    if (!requestKey) {
      return true;
    }

    const previousCount =
      this.aiRequestCounts.get(requestKey) ?? 0;
    const nextCount = previousCount + 1;
    this.aiRequestCounts.set(requestKey, nextCount);
    this.aiRequests.add(requestKey);
    return true;
  }

  /**
   * Clears recorded read/diagnostics keys for a path after a mutation
   * so the agent can re-inspect the updated file.
   */
  clearPathInspectionKeys(
    path: string
  ): void {
    const normalized = path.trim();
    if (!normalized) {
      return;
    }

    for (const key of [...this.aiRequestCounts.keys()]) {
      if (
        key.startsWith(`read_file|${normalized}|`) ||
        key.startsWith(`get_diagnostics|${normalized}|`)
      ) {
        this.aiRequestCounts.delete(key);
        this.aiRequests.delete(key);
      }
    }

  }


  // ==========================================================
  // Debug / Monitoring
  // ==========================================================

  /**
   * Returns a lightweight snapshot of the current state.
   *
   * Useful for Agent logging and debugging.
   */
  getSnapshot() {
    flow("InvestigationState.getSnapshot", 1, "enter");

    return {

      steps:
        this._steps,

      aiCalls:
        this._aiCalls,

      toolCalls:
        this._toolCalls,

      totalChars:
        this._totalChars,

      pendingFiles:
        this.pendingFiles.length,

      investigatedFiles:
        this.investigatedFiles.size,

      followedDependencies:
        this.followedDependencies.size,

      followedCalls:
        this.followedCalls.size,

      aiRequests:
        this.aiRequests.size,

      stopReason:
        this._stopReason
    };
  }
}