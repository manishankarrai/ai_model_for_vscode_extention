import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InvestigationState } from "./InvestigationState.ts";

describe("InvestigationState evidence windows", () => {
  it("does not stop when one request reaches maxChars", () => {
    const state = new InvestigationState({
      maxSteps: 3,
      maxFiles: 3,
      maxChars: 3,
      maxAICalls: 3,
      maxToolCalls: 3
    });

    assert.equal(state.addChars(3), true);
    assert.equal(state.totalChars, 3);
    assert.equal(state.stopReason, undefined);
    assert.equal(state.startStep(), true);
  });

  it("opens a fresh character window for the next request", () => {
    const state = new InvestigationState({ maxChars: 3 });

    state.addChars(3);
    state.resetCharsForNextRequest();

    assert.equal(state.totalChars, 0);
    assert.equal(state.addChars(3), true);
    assert.equal(state.stopReason, undefined);
  });

  it("doubles both call limits after one approved continuation", () => {
    const state = new InvestigationState({
      maxAICalls: 4,
      maxToolCalls: 15
    });

    for (let index = 0; index < 4; index++) {
      assert.equal(state.incrementAICalls(), true);
    }
    state.stop("max_ai_calls");

    assert.equal(state.extendLimits(15, 4), true);
    assert.equal(state.maxAICalls, 8);
    assert.equal(state.maxToolCalls, 30);
    assert.equal(state.incrementAICalls(), true);
  });
});