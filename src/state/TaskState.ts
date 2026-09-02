import {
  TaskState as M3TaskState
} from "../models/types";

export class TaskState {

  private state:
    M3TaskState = {
      requestId: "",

      question: "",

      intent: "chat",

      status: "idle",

      startedAt: 0,

      filesUsed: [],

      aiCalls: 0
    };

  start(
    requestId: string,
    question: string,
    intent: M3TaskState["intent"]
  ): void {

    this.state = {
      requestId,

      question,

      intent,

      status: "planning",

      startedAt: Date.now(),

      filesUsed: [],

      aiCalls: 0
    };
  }

  setStatus(
    status: M3TaskState["status"]
  ): void {

    this.state.status =
      status;
  }

  setFiles(
    files: string[]
  ): void {

    this.state.filesUsed =
      files;
  }

  setAICalls(
    calls: number
  ): void {

    this.state.aiCalls =
      calls;
  }

  complete(): void {

    this.state.status =
      "completed";

    this.state.completedAt =
      Date.now();
  }

  fail(): void {

    this.state.status =
      "failed";

    this.state.completedAt =
      Date.now();
  }

  get(): M3TaskState {
    return {
      ...this.state,

      filesUsed: [
        ...this.state.filesUsed
      ]
    };
  }
}