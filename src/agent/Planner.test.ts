import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Planner } from "./Planner.ts";

describe("Planner", () => {
  it("keeps selected-file implementation plans bounded", () => {
    const plan = new Planner().createPlan(
      "implementation",
      "change the timeout in the selected handlers",
      3
    );

    assert.equal(plan.maxFiles, 9);
    assert.equal(plan.maxSteps, 8);
    assert.equal(plan.maxSearchResults, 40);
  });

  it("keeps simple chat questions cheap", () => {
    const plan = new Planner().createPlan("chat", "where is the login handler?");

    assert.equal(plan.depth, "shallow");
    assert.equal(plan.maxFiles, 4);
    assert.equal(plan.maxSteps, 6);
  });

  it("gives bug analysis more room than a simple question", () => {
    const plan = new Planner().createPlan("bug_analysis", "why does the request fail?");

    assert.equal(plan.maxSteps, 18);
    assert.equal(plan.maxFiles, 14);
    assert.equal(plan.depth, "deep");
  });
});
