import { flow } from "../utils/flowLog.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { availableTools, getToolPolicy, isToolAllowed, requiresApproval } from "./toolPolicy.ts";

describe("agent tool policy", () => {
  it("exposes no tools in Ask mode", () => {
    flow("toolPolicy.test.askMode", 1, "enter");
    assert.deepEqual(availableTools("ask"), []);
    assert.equal(isToolAllowed("ask", "read_file"), false);
    assert.deepEqual(getToolPolicy("ask").allowed, []);
  });

  it("requires approval for mutating Agent tools", () => {
    assert.equal(isToolAllowed("agent", "edit_file"), true);
    assert.equal(isToolAllowed("agent", "run_command"), true);
    assert.equal(requiresApproval("run_command"), true);
    assert.equal(requiresApproval("apply_change_set"), true);
    assert.equal(getToolPolicy("agent").approval_required.includes("delete_file"), true);
  });
});
