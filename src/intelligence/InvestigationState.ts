export type InvestigationStopReason =
  | "completed"
  | "max_steps"
  | "max_files"
  | "max_chars";

export class InvestigationState {

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

  private _totalChars = 0;

  private _steps = 0;

  /*
   * ---------------------------------------------
   * Steps
   * ---------------------------------------------
   */

  get steps(): number {
    return this._steps;
  }

  incrementSteps(): void {
    this._steps++;
  }

  /*
   * ---------------------------------------------
   * Characters
   * ---------------------------------------------
   */

  get totalChars(): number {
    return this._totalChars;
  }

  addChars(
    chars: number
  ): void {

    if (chars <= 0) {
      return;
    }

    this._totalChars += chars;
  }

  /*
   * ---------------------------------------------
   * Files
   * ---------------------------------------------
   */

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

  isQueued(
    filePath: string
  ): boolean {

    return this.queuedFiles.has(
      filePath
    );
  }

  isInvestigated(
    filePath: string
  ): boolean {

    return this.investigatedFiles.has(
      filePath
    );
  }

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

    this.pendingFiles.push(
      filePath
    );

    this.queuedFiles.add(
      filePath
    );

    return true;
  }

  nextFile():
    string | undefined {

    return this.pendingFiles.shift();
  }

  markInvestigated(
    filePath: string
  ): void {

    this.investigatedFiles.add(
      filePath
    );
  }

  /*
   * ---------------------------------------------
   * Dependencies
   * ---------------------------------------------
   */

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

  /*
   * ---------------------------------------------
   * Calls
   * ---------------------------------------------
   */

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
}
