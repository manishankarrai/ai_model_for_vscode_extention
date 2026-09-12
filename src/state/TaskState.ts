import { TaskState as MM3TaskState } from "../models/types";
export class TaskState {
    private state: MM3TaskState = {
        requestId: "",
        question: "",
        intent: "chat",
        status: "idle",
        startedAt: 0,
        filesUsed: [],
        aiCalls: 0
    };
    start(requestId: string, question: string, intent: MM3TaskState["intent"]): void {
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
    setStatus(status: MM3TaskState["status"]): void {
        this.state.status =
            status;
    }
    setFiles(files: string[]): void {
        this.state.filesUsed =
            files;
    }
    setAICalls(calls: number): void {
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
    get(): MM3TaskState {
        return {
            ...this.state,
            filesUsed: [
                ...this.state.filesUsed
            ]
        };
    }
}
