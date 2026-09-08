import { flow } from "../utils/flowLog.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fileSelectionScore, stage12EvaluationSet } from "./evaluationSets.ts";

describe("stage 12 evaluation sets", () => {
  it("covers architecture, bugs, implementation, and selected code", () => {
    flow("evaluationSets.test.coversCategories", 1, "enter");
    const categories = new Set(stage12EvaluationSet().map((item) => item.category));
    assert.equal(categories.has("architecture"), true);
    assert.equal(categories.has("bug_analysis"), true);
    assert.equal(categories.has("implementation"), true);
    assert.equal(categories.has("selected_code"), true);
  });

  it("scores useful file selection", () => {
    assert.equal(
      fileSelectionScore(
        ["src/agent/Agent.ts", "services.go"],
        ["src/agent/Agent.ts", "services.go"]
      ),
      1
    );
    assert.equal(
      fileSelectionScore(["src/agent/Agent.ts"], ["src/agent/Agent.ts", "services.go"]),
      0.5
    );
  });
});
