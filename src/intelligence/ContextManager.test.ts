import assert from "node:assert/strict";
import test from "node:test";

import { ContextManager } from "./ContextManager.ts";
import { MemoryContextCacheStore } from "./ContextCache.ts";

test("ContextManager ranks evidence, preserves explicit parts, and emits a manifest", () => {
  const result = new ContextManager().manage({
    files: [
      { path: "low.ts", content: "x".repeat(80) },
      { path: "high.ts", content: "important implementation" },
      { path: "high.ts", content: "important implementation" }
    ],
    indexSummary: "summary",
    evidence: [
      { path: "low.ts", score: 1, reason: "low", matchedSymbols: [], matchedTerms: [] },
      { path: "high.ts", score: 10, reason: "high", matchedSymbols: [], matchedTerms: [] }
    ],
    parts: [{ kind: "selection", path: "selected.ts", content: "selected code", language: "TypeScript" }]
  }, {
    maxTokens: 15,
    reservedTokens: 1,
    outputTokens: 1,
    exactPaths: ["selected.ts"]
  });

  assert.equal(result.context.parts?.[0]?.path, "selected.ts");
  assert.equal(result.manifest.version, 1);
  assert.equal(result.manifest.entries.find((entry) => entry.path === "selected.ts")?.status, "included");
  assert.equal(result.manifest.entries.filter((entry) => entry.path === "high.ts")[1]?.status, "deduplicated");
  assert.equal(result.manifest.entries.some((entry) => entry.status === "omitted"), true);
  assert.equal(result.context.manifest?.entries.length, result.manifest.entries.length);
});

test("ContextManager compresses oversized files and invalidates cached results by path", () => {
  const manager = new ContextManager();
  const input = {
    files: [{
      path: "large.ts",
      content: [
        "import { helper } from './helper';",
        ...Array.from({ length: 30 }, (_, index) => `const value_${index} = ${index};`),
        "export function target() { return helper(); }"
      ].join("\n")
    }],
    indexSummary: "",
    evidence: [{ path: "large.ts", score: 1, reason: "match", matchedSymbols: [], matchedTerms: [] }]
  };
  const options = { maxTokens: 24, policyVersion: "v1" };

  const first = manager.manage(input, options);
  assert.equal(first.cacheHit, false);
  assert.equal(first.context.files[0]?.compressed, true);
  assert.match(first.context.files[0]?.content ?? "", /export function target/);
  assert.equal(first.manifest.entries[0]?.status, "compressed");

  const cached = manager.manage(input, options);
  assert.equal(cached.cacheHit, true);
  assert.equal(cached.manifest.cacheHit, true);

  manager.invalidatePath("large.ts");
  assert.equal(manager.manage(input, options).cacheHit, false);
});

test("ContextManager expands dependency files and bounds task memory history", () => {
  const manager = new ContextManager();
  const result = manager.manage({
    files: [{ path: "entry.ts", content: "export function entry() { return helper(); }" }],
    indexSummary: "",
    evidence: [{ path: "entry.ts", score: 1, reason: "selected", matchedSymbols: [], matchedTerms: [] }],
    taskMemory: {
      findings: ["old finding", "latest finding"],
      openQuestions: ["question"],
      verification: { required: true, completed: false, lastResult: "verification details" }
    }
  }, {
    maxTokens: 80,
    dependencyFiles: [{ path: "helper.ts", content: "export function helper() { return true; }" }],
    maxTaskMemoryItems: 1,
    maxTaskMemoryChars: 24,
    policyVersion: "dependency-v1"
  });

  assert.deepEqual(result.context.files.map((file) => file.path), ["helper.ts", "entry.ts"]);
  assert.equal(result.manifest.entries.find((entry) => entry.path === "helper.ts")?.reason, "dependency context");
  assert.deepEqual(result.context.taskMemory?.findings, ["latest finding"]);
  assert.equal(result.context.taskMemory?.openQuestions[0], "question");
  assert.ok((result.context.taskMemory?.verification.lastResult?.length ?? 0) <= 24);
});

test("ContextManager restores a result from a durable cache store", () => {
  const store = new MemoryContextCacheStore();
  const input = {
    files: [{ path: "src/persisted.ts", content: "export const persisted = true;" }],
    indexSummary: "",
    evidence: []
  };
  const options = { maxTokens: 40, policyVersion: "durable-cache" };
  new ContextManager(store).manage(input, options);
  const restored = new ContextManager(store).manage(input, options);
  assert.equal(restored.cacheHit, true);
});
