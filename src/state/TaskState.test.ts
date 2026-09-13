import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TaskState } from "./TaskState.ts";

class FakeMemento {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
}

const contract = {
  requestId: "req-1",
  intent: "implementation" as const,
  selectedPaths: ["src/handler.go"],
  selectedRanges: [{ path: "src/handler.go", startLine: 10, endLine: 20 }],
  requiredDependencyPaths: ["src/client.go"],
  dependencyEvidence: [{
    sourcePath: "src/handler.go",
    sourceSymbols: ["Handle"],
    targetPath: "src/client.go",
    targetSymbols: ["Client"],
    reason: "selected handler calls the client",
  }],
  allowedEditPaths: ["src/handler.go", "src/client.go"],
  dependencyEditPolicy: "selected-plus-required-dependencies" as const,
  acceptanceCriteria: ["preserve selected behavior"],
  validationCommands: ["go test ./..."],
};

describe("TaskState", () => {
  it("persists a task and normalizes older contracts on restart", async () => {
    const storage = new FakeMemento();
    const state = new TaskState(storage as never);

    state.start("req-1", "update timeout", "implementation", "agent", "coordinator");
    state.setContract({ ...contract, requiredDependencyPaths: [], dependencyEvidence: [] });
    state.setFiles(["src/handler.go"]);
    state.setAICalls(2);
    state.setCheckpoint(3.8);
    state.addValidation("go test ./...");

    await Promise.resolve();
    const restored = new TaskState(storage as never).get();

    assert.equal(restored.requestId, "req-1");
    assert.equal(restored.mode, "agent");
    assert.equal(restored.agentProfile, "coordinator");
    assert.deepEqual(restored.filesUsed, ["src/handler.go"]);
    assert.deepEqual(restored.validation, ["go test ./..."]);
    assert.equal(restored.lastStep, 3);
    assert.deepEqual(restored.contract?.requiredDependencyPaths, []);
    assert.deepEqual(restored.contract?.dependencyEvidence, []);
  });

  it("returns an isolated deep copy of nested contract state", () => {
    const state = new TaskState();
    state.start("req-2", "inspect", "analyze");
    state.setContract(contract);

    const snapshot = state.get();
    snapshot.contract!.selectedPaths.push("src/other.go");
    snapshot.contract!.dependencyEvidence[0].targetSymbols.push("NewClient");

    const unchanged = state.get();
    assert.deepEqual(unchanged.contract?.selectedPaths, ["src/handler.go"]);
    assert.deepEqual(unchanged.contract?.dependencyEvidence[0].targetSymbols, ["Client"]);
  });

  it("deduplicates validation and keeps only the latest twenty results", () => {
    const state = new TaskState();
    state.start("req-3", "validate", "bug_analysis");

    state.addValidation("  first  ");
    state.addValidation("first");
    for (let index = 2; index <= 21; index += 1) {
      state.addValidation(`check-${index}`);
    }

    const validation = state.get().validation;
    assert.equal(validation.length, 20);
    assert.equal(validation.includes("first"), false);
    assert.equal(validation[0], "check-2");
    assert.equal(validation[19], "check-21");
  });

  it("caps persisted checkpoint evidence and isolates snapshots", () => {
    const state = new TaskState();
    state.start("req-6", "resume", "analyze");
    state.setContextSnapshot([
      { path: "src/a.go", content: "a".repeat(150_000) },
      { path: "src/b.go", content: "b".repeat(100_000) },
    ]);

    const snapshot = state.get();
    assert.equal(snapshot.checkpointContext?.[0].content.length, 150_000);
    assert.equal(snapshot.checkpointContext?.[1].content.length, 50_000);
    snapshot.checkpointContext![0].content = "changed";
    assert.equal(state.get().checkpointContext?.[0].content.length, 150_000);
  });

  it("retains only the latest forty investigation checkpoints", () => {
    const state = new TaskState();
    state.start("req-7", "resume", "analyze");
    for (let step = 1; step <= 45; step += 1) {
      state.addCheckpoint({
        step,
        kind: "tool",
        tool: "read_file",
        path: `src/${step}.go`,
        success: true,
        summary: "1 evidence item(s)"
      });
    }

    const checkpoints = state.get().checkpoints ?? [];
    assert.equal(checkpoints.length, 40);
    assert.equal(checkpoints[0].step, 6);
    checkpoints[0].summary = "changed";
    assert.equal(state.get().checkpoints?.[0].summary, "1 evidence item(s)");
  });

  it("records failure and cancellation as terminal persisted states", () => {
    const failed = new TaskState();
    failed.start("req-4", "run", "implementation");
    failed.fail(new Error("validation failed"));
    assert.equal(failed.get().status, "failed");
    assert.equal(failed.get().lastError, "validation failed");
    assert.equal(typeof failed.get().completedAt, "number");

    const cancelled = new TaskState();
    cancelled.start("req-5", "stop", "chat");
    cancelled.cancel();
    assert.equal(cancelled.get().status, "cancelled");
    assert.equal(typeof cancelled.get().completedAt, "number");
  });
});