import { flow } from "../utils/flowLog.ts";
import type * as vscode from "vscode";

import type {
  ContextFile,
  InvestigationCheckpoint,
  TaskState as MM3TaskState
} from "../models/types.ts";

export class TaskState {

  private readonly key = "mm3.task.state.v1";
  private readonly storage?: vscode.Memento;

  constructor(storage?: vscode.Memento) {
    this.storage = storage;
    const saved = storage?.get<MM3TaskState>(this.key);
    if (saved) {
      this.state = {
        ...this.state,
        ...saved,
        validation: saved.validation ?? [],
        checkpointContext: saved.checkpointContext ?? [],
        checkpoints: saved.checkpoints ?? [],
        contract: saved.contract
          ? {
              ...saved.contract,
              requiredDependencyPaths: saved.contract.requiredDependencyPaths ?? [],
              dependencyEvidence: saved.contract.dependencyEvidence ?? []
            }
          : undefined
      };
    }
  }

  private state:
    MM3TaskState = {
      requestId: "",

      question: "",

      intent: "chat",

      mode: "ask",

      agentProfile: "ask",

      status: "idle",

      startedAt: 0,

      filesUsed: [],

      aiCalls: 0,

      validation: []
    };

  start(
    requestId: string,
    question: string,
    intent: MM3TaskState["intent"],
    mode: MM3TaskState["mode"] = "agent",
    agentProfile: MM3TaskState["agentProfile"] = mode === "ask" ? "ask" : "coordinator"
  ): void {

    this.state = {
      requestId,

      question,

      intent,

      mode,

      agentProfile,

      status: "planning",

      startedAt: Date.now(),

      filesUsed: [],

      aiCalls: 0,

      validation: []
    };

    this.persist();
  }

  setStatus(
    status: MM3TaskState["status"]
  ): void {

    this.state.status =
      status;

    this.persist();
  }

  setFiles(
    files: string[]
  ): void {

    this.state.filesUsed =
      files;

    this.persist();
  }

  setAICalls(
    calls: number
  ): void {

    this.state.aiCalls =
      calls;

    this.persist();
  }

  setCheckpoint(step: number): void {
    this.state.lastStep = Math.max(0, Math.floor(step));
    this.persist();
  }

  restoreCheckpoint(step: number | undefined, validation: string[] = []): void {
    if (typeof step === "number" && Number.isFinite(step)) {
      this.state.lastStep = Math.max(0, Math.floor(step));
    }
    for (const result of validation) {
      const normalized = result.trim();
      if (normalized && !this.state.validation.includes(normalized)) {
        this.state.validation = [...this.state.validation, normalized].slice(-20);
      }
    }
    this.persist();
  }

  setContextSnapshot(files: ContextFile[]): void {
    const snapshot: ContextFile[] = [];
    let remaining = 200_000;
    for (const file of files) {
      if (remaining <= 0) {
        break;
      }
      const content = file.content.slice(0, remaining);
      snapshot.push({ path: file.path, content });
      remaining -= content.length;
    }
    this.state.checkpointContext = snapshot;
    this.persist();
  }

  addCheckpoint(checkpoint: InvestigationCheckpoint): void {
    this.state.checkpoints = [
      ...(this.state.checkpoints ?? []),
      { ...checkpoint }
    ].slice(-40);
    this.persist();
  }

  setContract(contract: MM3TaskState["contract"]): void {
    this.state.contract = contract;
    this.persist();
  }

  addValidation(result: string): void {
    const normalized = result.trim();
    if (!normalized || this.state.validation.includes(normalized)) {
      return;
    }
    this.state.validation = [...this.state.validation, normalized].slice(-20);
    this.persist();
  }

  complete(): void {
    flow("TaskState.complete", 1, "enter");

    this.state.status =
      "completed";

    this.state.completedAt =
      Date.now();

    this.persist();
  }

  fail(error?: unknown): void {
    flow("TaskState.fail", 1, "enter");

    this.state.status =
      "failed";

    this.state.completedAt =
      Date.now();

    this.state.lastError = error instanceof Error
      ? error.message
      : error
        ? String(error)
        : undefined;

    this.persist();
  }

  cancel(): void {
    flow("TaskState.cancel", 1, "enter");

    this.state.status =
      "cancelled";

    this.state.completedAt =
      Date.now();

    this.persist();
  }

  get(): MM3TaskState {
    flow("TaskState.get", 1, "enter");
    return {
      ...this.state,

      filesUsed: [
        ...this.state.filesUsed
      ],

      validation: [
        ...this.state.validation
      ],

      checkpointContext: this.state.checkpointContext?.map((file) => ({
        ...file
      })) ?? [],

      checkpoints: this.state.checkpoints?.map((checkpoint) => ({
        ...checkpoint
      })) ?? [],

      contract: this.state.contract
        ? {
            ...this.state.contract,
            selectedPaths: [...this.state.contract.selectedPaths],
            selectedRanges: [...this.state.contract.selectedRanges],
            requiredDependencyPaths: [...this.state.contract.requiredDependencyPaths],
            dependencyEvidence: this.state.contract.dependencyEvidence.map((evidence) => ({
              ...evidence,
              sourceSymbols: [...evidence.sourceSymbols],
              targetSymbols: [...evidence.targetSymbols]
            })),
            allowedEditPaths: [...this.state.contract.allowedEditPaths],
            acceptanceCriteria: [...this.state.contract.acceptanceCriteria],
            validationCommands: [...this.state.contract.validationCommands]
          }
        : undefined
    };
  }

  private persist(): void {
    void this.storage?.update(this.key, this.state);
  }
}