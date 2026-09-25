import { flow } from "../utils/flowLog.ts";

import type {
  TaskState as MM3TaskState
} from "../models/types.ts";

export class TaskState {

  private state:
    MM3TaskState = {
      requestId: "",

      question: "",

      intent: "chat",

      status: "idle",

      startedAt: 0,

      filesUsed: [],

      aiCalls: 0,

      findings: [],

      openQuestions: []
    };

  start(
    requestId: string,
    question: string,
    intent: MM3TaskState["intent"]
  ): void {

    this.state = {
      requestId,

      question,

      intent,

      status: "planning",

      startedAt: Date.now(),

      filesUsed: [],

      aiCalls: 0,

      findings: [],

      openQuestions: []
    };
  }

  setStatus(
    status: MM3TaskState["status"]
  ): void {

    this.state.status =
      status;
  }

  reset(): void {
    this.state = {
      requestId: "",
      question: "",
      intent: "chat",
      status: "idle",
      startedAt: 0,
      filesUsed: [],
      aiCalls: 0,
      findings: [],
      openQuestions: []
    };
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

  addFinding(finding: string): void {
    const value = finding.trim();
    if (value && !this.state.findings.includes(value)) {
      this.state.findings.push(value);
    }
  }

  addOpenQuestion(question: string): void {
    const value = question.trim();
    if (value && !this.state.openQuestions.includes(value)) {
      this.state.openQuestions.push(value);
    }
  }

  complete(): void {
    flow("TaskState.complete", 1, "enter");

    this.state.status =
      "completed";

    this.state.completedAt =
      Date.now();
  }

  fail(): void {
    flow("TaskState.fail", 1, "enter");

    this.state.status =
      "failed";

    this.state.completedAt =
      Date.now();
  }

  get(): MM3TaskState {
    flow("TaskState.get", 1, "enter");
    return {
      ...this.state,

      filesUsed: [
        ...this.state.filesUsed
      ],

      findings: [
        ...this.state.findings
      ],

      openQuestions: [
        ...this.state.openQuestions
      ]
    };
  }
}