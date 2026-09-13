import { flow } from "../utils/flowLog.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveRequestContext, selectRankedFiles } from "./contextSelection.ts";

describe("context selection", () => {
  it("keeps Ask mode limited to explicit parts", () => {
    flow("contextSelection.test.askMode", 1, "enter");
    const context = resolveRequestContext({
      mode: "ask",
      selected: [{
        kind: "selection",
        path: "src/app.ts",
        content: "const value = 1;",
        language: "typescript",
        startLine: 4,
        endLine: 6
      }],
      investigated: [{ path: "src/other.ts", content: "should not leak" }],
      evidence: [{
        path: "src/other.ts",
        score: 9,
        reason: "ranked",
        matchedSymbols: [],
        matchedTerms: []
      }],
      indexSummary: "summary",
      maxFiles: 8
    });

    assert.equal(context.files.length, 1);
    assert.equal(context.files[0].path, "src/app.ts");
    assert.equal(context.parts?.[0].kind, "selection");
  });

  it("sends only the selected lines and excludes investigated dependencies", () => {
    const context = resolveRequestContext({
      mode: "agent",
      selected: [{
        kind: "selection",
        path: "api/handlers/shop.go",
        content: "func GetShop() {}",
        language: "go",
        startLine: 3,
        endLine: 3
      }],
      investigated: [{
        path: "api/handlers/shop.go",
        content: "package handlers\n\nfunc GetShop() {}\n\nfunc CreateShop() {}\n"
      }, {
        path: "api/services/shop.go",
        content: "func CreateShop() {}"
      }],
      evidence: [],
      indexSummary: "summary",
      maxFiles: 8
    });

    assert.match(context.files[0].content, /func GetShop\(\) \{\}/);
    assert.doesNotMatch(context.files[0].content, /func CreateShop\(\) \{\}/);
    assert.equal(context.files.length, 1);
    assert.equal(context.parts?.[0].kind, "selection");
    assert.match(context.evidence[0].reason, /complete AI context/);
  });

  it("sends an attached full file verbatim without adding dependencies", () => {
    const context = resolveRequestContext({
      mode: "agent",
      selected: [{
        kind: "attachment",
        path: "src/app.ts",
        content: "const app = true;",
        language: "typescript"
      }],
      investigated: [{ path: "src/dep.ts", content: "const dep = true;" }],
      evidence: [],
      indexSummary: "summary",
      maxFiles: 8,
      selectionScope: "full-file"
    });

    assert.deepEqual(context.files, [{
      path: "src/app.ts",
      content: "const app = true;"
    }]);
  });

  it("caps and ranks agent investigation files", () => {
    const ranked = selectRankedFiles([
      { path: "src/low.ts", score: 1, matches: 1, reason: "low" },
      { path: "src/high.ts", score: 12, matches: 3, reason: "high" },
      { path: "../secret.ts", score: 20, matches: 1, reason: "unsafe" }
    ], 1);

    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].path, "src/high.ts");
  });
});
