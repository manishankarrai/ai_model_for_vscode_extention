import assert from "node:assert/strict";
import test from "node:test";

import { AgentRuntime } from "./AgentRuntime.ts";
import { ToolScheduler } from "./ToolScheduler.ts";
import { VerificationManager } from "./VerificationManager.ts";
import { ChangeImpactAnalyzer } from "./ChangeImpactAnalyzer.ts";
import { SpecialistPolicyResolver } from "./SpecialistPolicy.ts";
import { InvestigationBranchPlanner } from "./InvestigationBranchPlanner.ts";

test("AgentRuntime creates bounded investigation state", () => {
  const runtime = new AgentRuntime();
  const state = runtime.createInvestigationState({
    maxSteps: 2,
    maxFiles: 3,
    maxChars: 400,
    maxAICalls: 4,
    maxToolCalls: 5
  });

  assert.equal(state.maxSteps, 2);
  assert.equal(state.maxFiles, 3);
  assert.equal(state.maxChars, 400);
  assert.equal(state.maxAICalls, 4);
  assert.equal(state.maxToolCalls, 5);
});

test("AgentRuntime prepares context and invalidates its cache", () => {
  const runtime = new AgentRuntime();
  const input = {
    files: [{ path: "src/app.ts", content: "export const app = true;" }],
    indexSummary: "",
    evidence: [{ path: "src/app.ts", score: 1, reason: "selected", matchedSymbols: [], matchedTerms: [] }]
  };
  const options = { maxTokens: 40, policyVersion: "runtime-v1" };

  assert.equal(runtime.prepareContext(input, options).cacheHit, false);
  assert.equal(runtime.prepareContext(input, options).cacheHit, true);
  runtime.invalidatePath("src/app.ts");
  assert.equal(runtime.prepareContext(input, options).cacheHit, false);
});

test("AgentRuntime schedules parallel work before ordered work", async () => {
  const runtime = new AgentRuntime();
  const order: string[] = [];
  const results = await runtime.runToolBatch(
    [
      async () => { order.push("parallel-a"); return "a"; },
      async () => { order.push("parallel-b"); return "b"; }
    ],
    [async () => { order.push("ordered"); return "c"; }],
    2
  );

  assert.deepEqual(results, ["a", "b", "c"]);
  assert.equal(order.at(-1), "ordered");
});

test("AgentRuntime records redacted verification status", () => {
  const runtime = new AgentRuntime();
  const memory = {
    findings: [],
    openQuestions: [],
    verification: { required: true, completed: false }
  };

  const updated = runtime.updateVerificationMemory(memory, [
    { tool: "run_tests", success: true },
    { tool: "get_diagnostics", success: false }
  ]);

  assert.equal(updated?.verification.completed, false);
  assert.equal(updated?.verification.lastResult, "Verification requires attention: run_tests:passed, get_diagnostics:failed");
});

test("runtime components remain independently usable", async () => {
  const scheduler = new ToolScheduler();
  assert.deepEqual(await scheduler.run([async () => "parallel"], [async () => "ordered"], 1), ["parallel", "ordered"]);

  const verifier = new VerificationManager();
  const memory = { findings: [], openQuestions: [], verification: { required: true, completed: false } };
  assert.equal(verifier.updateMemory(memory, [{ tool: "run_tests", success: true }])?.verification.completed, true);
});

test("VerificationManager returns a retryable structured failure", () => {
  const verifier = new VerificationManager();
  const result = verifier.evaluate([
    { tool: "run_tests", success: false },
    { tool: "get_diagnostics", success: true }
  ]);
  assert.equal(result.completed, false);
  assert.equal(result.retryable, true);
  assert.deepEqual(result.failed, ["run_tests"]);
  assert.match(result.summary, /requires attention/);
});

test("AgentRuntime creates declarative plans and impact reports", () => {
  const runtime = new AgentRuntime();
  const plan = runtime.createPlan("implementation", "Implement a retry guard", "src/service.ts");
  assert.equal(plan.intent, "implementation");
  assert.match(runtime.formatPlan(plan), /Preferred phases/);

  const report = runtime.analyzeChangeImpact(["src/service.ts"], [
    { from: "src/handler.ts", to: "src/service.ts", kind: "import" },
    { from: "tests/service.test.ts", to: "Service", kind: "test", sourcePath: "tests/service.test.ts" }
  ]);
  assert.deepEqual(report.affectedFiles, ["src/handler.ts", "src/service.ts", "tests/service.test.ts"]);
  assert.deepEqual(report.tests, ["tests/service.test.ts"]);
});

test("AgentRuntime creates safe branches and specialist policy limits", () => {
  const runtime = new AgentRuntime();
  const plan = runtime.createPlan("bug_analysis", "Why does this fail?", "src/app.ts");
  const branches = runtime.createBranches(plan);
  assert.equal(branches[0].parallelizable, true);
  assert.equal(branches.some((branch) => branch.phase === "verification"), true);

  const policy = runtime.resolveSpecialistPolicy("ask", "ask", 4);
  assert.equal(policy.maxAgents, 1);
  assert.equal(policy.maxParallelBranches, 1);
});

test("specialist policy resolver keeps unknown profiles bounded", () => {
  const resolver = new SpecialistPolicyResolver();
  const policy = resolver.resolve("custom", "agent", 99);
  assert.equal(resolver.limitCount(policy, 99), 5);
});

test("branch planner marks command phases as ordered", () => {
  const planner = new InvestigationBranchPlanner();
  const branches = planner.create({
    intent: "implementation",
    phases: [{ name: "verification", tools: ["run_tests"], purpose: "verify" }],
    stopConditions: []
  });
  assert.equal(branches[0].parallelizable, false);
});

test("AgentRuntime executes branches and emits metrics", async () => {
  const runtime = new AgentRuntime();
  const branches = [
    { id: "ordered-first", phase: "verification", tools: ["run_tests"], purpose: "verify", parallelizable: false },
    { id: "parallel-second", phase: "target", tools: ["read_file"], purpose: "read", parallelizable: true }
  ];
  const results = await runtime.runInvestigationBranches(branches, async (branch) => branch.id, 2);
  assert.deepEqual(results, branches.map((branch) => branch.id));
  assert.equal(runtime.metricsSnapshot().counters["investigation_branches.completed"], branches.length);
});