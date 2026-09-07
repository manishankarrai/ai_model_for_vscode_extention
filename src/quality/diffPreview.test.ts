import { flow } from "../utils/flowLog";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { previewDiff } from "./diffPreview.ts";

describe("diff preview", () => {
  it("renders added and removed lines", () => {
    flow("diffPreview.test.rendersLines", 1, "enter");
    const lines = previewDiff("const a = 1;\nconst b = 2;", "const a = 1;\nconst b = 3;");
    assert.equal(lines.some((line) => line.type === "removed" && line.text.includes("const b = 2")), true);
    assert.equal(lines.some((line) => line.type === "added" && line.text.includes("const b = 3")), true);
    assert.equal(lines.some((line) => line.type === "context" && line.text.includes("const a = 1")), true);
  });
});
