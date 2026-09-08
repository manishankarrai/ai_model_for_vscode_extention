import { flow } from "../utils/flowLog";

export type InvestigationStopReason =
  | "completed"
  | "max_steps"
  | "max_files"
  | "max_chars"
  | "max_ai_calls"
  | "max_tool_calls"
  | "loop_detected"
  | "timeout"
  | "insufficient_evidence"
  | "error";


export class InvestigationState {

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
  // AI Request Loop Detection
  // ==========================================================
  //
  // Stores unique investigation requests.
  //
  // Example:
  //
  //   read_file|src/auth/jwt.ts|
  //
  // If Gemini requests the exact same operation again,
  // the investigation is stopped.
  //
  // ==========================================================

  private readonly aiRequests =
    new Set<string>();


  // ==========================================================
  // Investigation Limits
  // ==========================================================

  /**
   * Maximum adaptive reasoning cycles.
   */
  readonly maxSteps = 16;


  /**
   * Maximum number of files investigated.
   */
  readonly maxFiles = 15;


  /**
   * Maximum evidence characters.
   */
  readonly maxChars = 50_000;


  /**
   * Maximum Gemini API calls.
   */
  readonly maxAICalls = 8;


  /**
   * Maximum local read-only tool calls.
   */
  readonly maxToolCalls = 20;


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


  // ==========================================================
  // Characters
  // ==========================================================

  get totalChars(): number {
    return this._totalChars;
  }


  /**
   * Adds evidence character count.
   *
   * The counter is capped at maxChars.
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

      this.stop(
        "max_chars"
      );

      return false;
    }


    const accepted =
      Math.min(
        chars,
        remaining
      );


    this._totalChars +=
      accepted;


    if (
      this._totalChars >=
      this.maxChars
    ) {

      this.stop(
        "max_chars"
      );
    }


    return accepted === chars;
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


    // --------------------------------------------------------
    // Maximum evidence characters
    // --------------------------------------------------------

    if (
      this._totalChars >=
      this.maxChars
    ) {

      this.stop(
        "max_chars"
      );

      return false;
    }


    // --------------------------------------------------------
    // Maximum Gemini calls
    // --------------------------------------------------------

    if (
      this._aiCalls >=
      this.maxAICalls
    ) {

      this.stop(
        "max_ai_calls"
      );

      return false;
    }


    // --------------------------------------------------------
    // Maximum local tool calls
    // --------------------------------------------------------

    if (
      this._toolCalls >=
      this.maxToolCalls
    ) {

      this.stop(
        "max_tool_calls"
      );

      return false;
    }


    return true;
  }


  // ==========================================================
  // AI Request Loop Detection
  // ==========================================================

  /**
   * Returns true if this exact investigation request has
   * already been processed.
   */
  hasAIRequest(
    requestKey: string
  ): boolean {

    return this.aiRequests.has(
      requestKey
    );
  }


  /**
   * Records an AI investigation request.
   *
   * Returns:
   *
   * true  → new request
   * false → duplicate request
   *
   * Duplicate requests automatically stop the investigation.
   */
  recordAIRequest(
    requestKey: string
  ): boolean {

    if (!requestKey) {
      return false;
    }


    if (
      this.aiRequests.has(
        requestKey
      )
    ) {

      this.stop(
        "loop_detected"
      );


      return false;
    }


    this.aiRequests.add(
      requestKey
    );


    return true;
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