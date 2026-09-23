import assert from "node:assert/strict";
import test from "node:test";

import { TaskState } from "./TaskState.ts";

test("TaskState keeps unique findings and open questions in snapshots", () => {
  const state = new TaskState();
  state.start("request-1", "Explain the change", "analyze");
  state.addFinding("The request is bounded locally.");
  state.addFinding("The request is bounded locally.");
  state.addOpenQuestion("Which caller owns the retry policy?");
  state.addOpenQuestion("Which caller owns the retry policy?");

  const snapshot = state.get();
  assert.deepEqual(snapshot.findings, ["The request is bounded locally."]);
  assert.deepEqual(snapshot.openQuestions, ["Which caller owns the retry policy?"]);
});