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

  it("keeps selected code authoritative over stale investigated content", () => {
    const context = resolveRequestContext({
      mode: "agent",
      selected: [{
        kind: "selection",
        path: "api/handlers/shop.go",
        content: "func GetShop() {}",
        language: "go",
        startLine: 10,
        endLine: 12
      }],
      investigated: [{
        path: "api/handlers/shop.go",
        content: "package handlers\n\nfunc GetShop() {}\n"
      }],
      evidence: [],
      indexSummary: "summary",
      maxFiles: 8
    });

    assert.equal(context.files[0].content, "func GetShop() {}");
    assert.equal(context.parts?.[0].kind, "selection");
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
