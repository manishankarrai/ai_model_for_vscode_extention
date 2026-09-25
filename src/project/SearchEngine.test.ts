import assert from "node:assert/strict";
import test from "node:test";

import { SearchEngine } from "./SearchEngine.ts";

test("SearchEngine ranks exact symbols above filename and text matches", () => {
  const engine = new SearchEngine();
  const results = engine.search("Create", [
    {
      path: "handlers/create.ts",
      content: "export function unrelated() { return Create; }",
      symbols: []
    },
    {
      path: "services/user.ts",
      content: "export function Create() { return true; }",
      symbols: [{
        id: "services/user.ts:1:Create",
        name: "Create",
        qualifiedName: "Create",
        kind: "function",
        path: "services/user.ts",
        language: "TypeScript",
        startLine: 1,
        endLine: 1
      }]
    }
  ]);

  assert.equal(results[0]?.path, "services/user.ts");
  assert.equal(results[0]?.matchedSymbols[0], "Create");
  assert.match(results[0]?.reason ?? "", /exact symbol/);
  assert.ok((results[0]?.score ?? 0) > (results[1]?.score ?? 0));
});

test("SearchEngine includes confidence-weighted graph signals and deduplicates identical candidates", () => {
  const engine = new SearchEngine();
  const document = {
    path: "service.ts",
    content: "function caller() { return target(); }",
    symbols: []
  };
  const results = engine.search("target", [document, document], [
    { from: "caller", to: "target", kind: "reference", confidence: 0.9 }
  ]);

  assert.equal(results.length, 1);
  assert.match(results[0]?.reason ?? "", /graph evidence/);
  assert.match(results[0]?.reason ?? "", /lexical=/);
  assert.equal(typeof results[0]?.lexicalScore, "number");
  assert.ok((results[0]?.score ?? 0) > (results[0]?.graphScore ?? 0));
  assert.match(results[0]?.snippet ?? "", /target/);
});

test("SearchEngine matches resolved relationship paths", () => {
  const engine = new SearchEngine();
  const results = engine.search("helper.ts", [{
    path: "service.ts",
    content: "import { helper } from './helper';",
    symbols: []
  }], [{
    from: "service.ts",
    to: "./helper",
    resolvedPath: "helper.ts",
    kind: "import",
    confidence: 0.95
  }]);

  assert.match(results[0]?.reason ?? "", /graph evidence/);
});

test("SearchEngine returns separate code-aware chunks for multiple matching symbols", () => {
  const engine = new SearchEngine();
  const results = engine.search("loadConfig loadValue", [{
    path: "storage.ts",
    content: [
      "export function loadConfig() {",
      "  return loadValue();",
      "}",
      "export function loadValue() {",
      "  return 'value';",
      "}"
    ].join("\n"),
    symbols: [
      {
        id: "storage.ts:1:loadConfig",
        name: "loadConfig",
        qualifiedName: "loadConfig",
        kind: "function",
        path: "storage.ts",
        language: "TypeScript",
        startLine: 1,
        endLine: 3
      },
      {
        id: "storage.ts:4:loadValue",
        name: "loadValue",
        qualifiedName: "loadValue",
        kind: "function",
        path: "storage.ts",
        language: "TypeScript",
        startLine: 4,
        endLine: 6
      }
    ]
  }]);

  assert.equal(results.length, 2);
  assert.deepEqual(results.map((result) => result.matchedSymbols[0]).sort(), ["loadConfig", "loadValue"]);
  assert.match(results[0]?.reason ?? "", /code chunk/);
  assert.match(results[0]?.snippet ?? "", /export function load/);
});

test("SearchEngine fuses semantic, selected, and recent-change signals", () => {
  const engine = new SearchEngine();
  const results = engine.search("config", [
    { path: "selected.ts", content: "export const config = true;", symbols: [], explicit: true },
    { path: "semantic.ts", content: "export const setting = true;", symbols: [], recentChange: true }
  ], [], 10, [{ path: "semantic.ts", score: 0.9 }]);

  assert.equal(results[0]?.path, "semantic.ts");
  assert.match(results[0]?.reason ?? "", /semantic=90\.00/);
  assert.match(results[0]?.reason ?? "", /recent=15\.00/);
  assert.match(results[0]?.reason ?? "", /fusion=/);
  assert.equal(results[0]?.semanticScore, 90);
  assert.equal(results[1]?.selectionScore, 80);
  assert.ok((results[0]?.score ?? 0) <= 100);
});

test("SearchEngine preserves symbol ranges from semantic matches", () => {
  const engine = new SearchEngine();
  const results = engine.search("unrelated term", [{
    path: "service.ts",
    content: "function loadProjectConfig() { return true; }",
    symbols: [{
      id: "service.ts:1:loadProjectConfig",
      name: "loadProjectConfig",
      qualifiedName: "loadProjectConfig",
      kind: "function",
      path: "service.ts",
      language: "TypeScript",
      startLine: 1,
      endLine: 1
    }]
  }], [], 10, [{ path: "service.ts", startLine: 1, endLine: 1, score: 0.8 }]);

  assert.equal(results[0]?.startLine, 1);
  assert.equal(results[0]?.endLine, 1);
  assert.match(results[0]?.snippet ?? "", /loadProjectConfig/);
});

test("SearchEngine keeps semantic scores scoped to matching symbol chunks", () => {
  const engine = new SearchEngine();
  const results = engine.search("First second", [{
    path: "service.ts",
    content: [
      "function First() { return true; }",
      "function Second() { return true; }"
    ].join("\n"),
    symbols: [
      {
        id: "service.ts:1:First",
        name: "First",
        qualifiedName: "First",
        kind: "function",
        path: "service.ts",
        language: "TypeScript",
        startLine: 1,
        endLine: 1
      },
      {
        id: "service.ts:2:Second",
        name: "Second",
        qualifiedName: "Second",
        kind: "function",
        path: "service.ts",
        language: "TypeScript",
        startLine: 2,
        endLine: 2
      }
    ]
  }], [], 10, [{ path: "service.ts", startLine: 2, endLine: 2, score: 0.8 }]);

  const second = results.find((result) => result.matchedSymbols[0] === "Second");
  const first = results.find((result) => result.matchedSymbols[0] === "First");
  assert.equal(second?.semanticScore, 80);
  assert.equal(first?.semanticScore, 0);
});

test("SearchEngine returns bounded semantic chunks for files without symbols", () => {
  const engine = new SearchEngine();
  const results = engine.search("configuration", [{
    path: "settings.yaml",
    content: "name: app\nmode: production\nconfiguration: strict\nregion: us\n",
    symbols: []
  }], [], 10, [{ path: "settings.yaml", startLine: 3, endLine: 3, score: 0.7 }]);

  assert.equal(results[0]?.startLine, 3);
  assert.equal(results[0]?.endLine, 3);
  assert.equal(results[0]?.snippet, "configuration: strict");
});