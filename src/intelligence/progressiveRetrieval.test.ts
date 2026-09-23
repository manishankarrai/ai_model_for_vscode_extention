import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyIntent,
  createRetrievalPlan,
  formatRetrievalPlan
} from "./progressiveRetrieval.ts";

test("classifyIntent recognizes bug and implementation questions", () => {
  assert.equal(classifyIntent("auto", "Why does rollback fail after an approved edit?"), "bug_analysis");
  assert.equal(classifyIntent("auto", "Implement a retry guard for this service"), "implementation");
  assert.equal(classifyIntent("architecture", "Explain the flow"), "architecture");
});

test("createRetrievalPlan orders bug retrieval from symptoms to verification", () => {
  const plan = createRetrievalPlan("bug_analysis", "Why is this failing?", "src/agent/Agent.ts");

  assert.deepEqual(plan.phases.map((phase) => phase.name), ["symptoms", "target", "verification"]);
  assert.equal(plan.phases[0].tools.includes("get_diagnostics"), true);
  assert.equal(plan.phases[2].tools.includes("run_tests"), true);
  assert.match(formatRetrievalPlan(plan), /Stop conditions/);
});

test("architecture planning starts with project mapping", () => {
  const plan = createRetrievalPlan("architecture", "How are modules connected?");

  assert.equal(plan.phases[0].tools[0], "get_project_summary");
  assert.equal(plan.phases[1].tools.includes("find_references"), true);
});