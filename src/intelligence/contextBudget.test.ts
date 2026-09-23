import assert from "node:assert/strict";
import test from "node:test";

import { budgetContext, estimateTokens } from "./contextBudget.ts";

test("budgetContext preserves exact parts, reserves output, and compacts lower priority files", () => {
  const result = budgetContext({
    files: [
      { path: "target.ts", content: "target content", startLine: 1, endLine: 2 },
      { path: "unrelated.ts", content: "x".repeat(1000) }
    ],
    indexSummary: "project summary",
    evidence: [
      { path: "target.ts", score: 100, reason: "target", matchedSymbols: [], matchedTerms: [] },
      { path: "unrelated.ts", score: 1, reason: "other", matchedSymbols: [], matchedTerms: [] }
    ],
    parts: [{ kind: "selection", path: "target.ts", content: "target content", language: "TypeScript" }]
  }, {
    maxTokens: 30,
    reservedTokens: 5,
    outputTokens: 5,
    exactPaths: ["target.ts"]
  });

  assert.equal(result.context.parts?.length, 1);
  assert.equal(result.context.files.length, 0);
  assert.deepEqual(result.omittedFiles, ["unrelated.ts"]);
  assert.equal(result.deduplicatedFiles, 1);
  assert.match(result.summary, /Compacted Context/);
  assert.ok(result.estimatedTokens >= estimateTokens("target content"));
});

test("budgetContext removes duplicate ranges and keeps ranked files within budget", () => {
  const result = budgetContext({
    files: [
      { path: "same.ts", content: "same" },
      { path: "same.ts", content: "same" },
      { path: "other.ts", content: "other" }
    ],
    indexSummary: "",
    evidence: []
  }, { maxTokens: 10 });

  assert.equal(result.deduplicatedFiles, 1);
  assert.equal(result.context.files.length, 2);
});