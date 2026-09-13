import { flow } from "../utils/flowLog.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  availableTools,
  getToolPolicy,
  isToolAllowed,
  requiresApproval
} from "./toolPolicy.ts";

describe("agent tool policy", () => {
  it("exposes no tools in Ask mode", () => {
    flow("toolPolicy.test.askMode", 1, "enter");
    assert.deepEqual(availableTools("ask"), []);
    assert.equal(isToolAllowed("ask", "read_file"), false);
    assert.deepEqual(getToolPolicy("ask").allowed, []);
  });

  it("auto-applies file mutations and terminal tools without approval", () => {
    assert.equal(isToolAllowed("agent", "edit_file"), true);
    assert.equal(isToolAllowed("agent", "run_command"), true);
    assert.equal(requiresApproval("run_command"), false);
    assert.equal(requiresApproval("run_task"), false);
    assert.equal(requiresApproval("run_tests"), false);
    assert.equal(requiresApproval("edit_file"), false);
    assert.equal(requiresApproval("create_file"), false);
    assert.equal(requiresApproval("delete_file"), false);
    assert.equal(requiresApproval("apply_change_set"), false);
    assert.equal(getToolPolicy("agent").approval_required.includes("delete_file"), false);
    assert.equal(getToolPolicy("agent").approval_required.includes("run_command"), false);
  });
});
