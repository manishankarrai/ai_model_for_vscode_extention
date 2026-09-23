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

test("SearchEngine includes relationship signals and deduplicates identical candidates", () => {
  const engine = new SearchEngine();
  const document = {
    path: "service.ts",
    content: "function caller() { return target(); }",
    symbols: []
  };
  const results = engine.search("target", [document, document], [
    { from: "caller", to: "target", kind: "reference" }
  ]);

  assert.equal(results.length, 1);
  assert.match(results[0]?.reason ?? "", /relationship match/);
  assert.match(results[0]?.snippet ?? "", /target/);
});