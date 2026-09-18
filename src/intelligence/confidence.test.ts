import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasSufficientAdaptiveConfidence } from "./confidence.ts";

describe("adaptive confidence", () => {
  it("requires confidence strictly greater than 0.70", () => {
    assert.equal(hasSufficientAdaptiveConfidence(0.69), false);
    assert.equal(hasSufficientAdaptiveConfidence(0.70), false);
    assert.equal(hasSufficientAdaptiveConfidence(0.7001), true);
  });

  it("rejects invalid confidence values", () => {
    assert.equal(hasSufficientAdaptiveConfidence(Number.NaN), false);
    assert.equal(hasSufficientAdaptiveConfidence(Number.POSITIVE_INFINITY), false);
  });
});