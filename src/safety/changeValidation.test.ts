import { flow } from "../utils/flowLog.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertFileHashMatches,
  assertChangesWithinTaskScope,
  assertNotSensitivePath,
  assertWorkspaceTrusted,
  hashContent,
  isSensitivePath,
  resolveApplyContent,
  validateChangeSize,
  validateWorkspaceRelativePath
} from "./changeValidation.ts";
import {
  buildFileReview,
  createNamedChangeSet,
  splitHunks,
  applyHunkApprovals
} from "./changeSets.ts";
import {
  formatConflictSummary,
  resolveMemoryConflicts
} from "./memoryConflict.ts";

describe("stale-file protection", () => {
  it("rejects parent-path writes", () => {
    flow("changeValidation.test.parentPath", 1, "enter");
    assert.throws(
      () => validateWorkspaceRelativePath("../secret.ts"),
      /unsafe change path|rejected unsafe/i
    );
  });

  it("allows .env files and still rejects private keys", () => {
    assert.equal(isSensitivePath(".env"), false);
    assert.equal(isSensitivePath(".env.prod"), false);
    assert.equal(isSensitivePath(".env.example"), false);
    assert.throws(() => assertNotSensitivePath("secrets/id_rsa"), /sensitive path/i);
  });

  it("rejects untrusted workspace writes", () => {
    assert.throws(() => assertWorkspaceTrusted(false), /not trusted/i);
  });

  it("rejects selected-file changes outside the selected line range", () => {
    const contract = {
      requestId: "request-range",
      intent: "implementation" as const,
      selectedPaths: ["src/app.ts"],
      selectedRanges: [{ path: "src/app.ts", startLine: 2, endLine: 2 }],
      requiredDependencyPaths: [],
      dependencyEvidence: [],
      allowedEditPaths: ["src/app.ts"],
      dependencyEditPolicy: "selected-only" as const,
      acceptanceCriteria: [],
      validationCommands: []
    };

    assert.doesNotThrow(() => assertChangesWithinTaskScope([
      {
        path: "src/app.ts",
        original: "before\nselected\nafter",
        updated: "before\nchanged\nafter"
      }
    ], contract));
    assert.throws(() => assertChangesWithinTaskScope([
      {
        path: "src/app.ts",
        original: "before\nselected\nafter",
        updated: "changed-before\nselected\nafter"
      }
    ], contract), /out-of-range/i);
  });

  it("checks selected snippets after resolving them into the full file", () => {
    const contract = {
      requestId: "request-snippet-range",
      intent: "implementation" as const,
      selectedPaths: ["api/services/smartphone.go"],
      selectedRanges: [{ path: "api/services/smartphone.go", startLine: 62, endLine: 83 }],
      requiredDependencyPaths: [],
      dependencyEvidence: [],
      allowedEditPaths: ["api/services/smartphone.go"],
      dependencyEditPolicy: "selected-only" as const,
      acceptanceCriteria: [],
      validationCommands: []
    };
    const current = Array.from({ length: 90 }, (_, index) => `line ${index + 1}`).join("\n");
    const original = Array.from({ length: 22 }, (_, index) => `line ${index + 62}`).join("\n");
    const updatedSnippet = Array.from({ length: 22 }, (_, index) =>
      index === 10 ? "changed line 72" : `line ${index + 62}`
    ).join("\n");
    const updated = resolveApplyContent(current, original, updatedSnippet);

    assert.doesNotThrow(() => assertChangesWithinTaskScope([{
      path: "api/services/smartphone.go",
      original: current,
      updated
    }], contract));
  });

  it("rejects apply when hash drifted", () => {
    assert.throws(
      () => assertFileHashMatches("src/a.ts", "new", hashContent("old"), "apply"),
      /hash changed/i
    );
  });

  it("accepts an unchanged apply candidate", () => {
    validateChangeSize("src/a.ts", "old", "new");
    assertFileHashMatches("src/a.ts", "old", hashContent("old"), "apply");
  });

  it("rejects changes outside explicitly selected files", () => {
    const contract = {
      requestId: "request-1",
      intent: "implementation" as const,
      selectedPaths: ["handlers/user.go", "services/user.go"],
      selectedRanges: [],
      requiredDependencyPaths: [],
      dependencyEvidence: [],
      allowedEditPaths: ["handlers/user.go", "services/user.go"],
      dependencyEditPolicy: "selected-only" as const,
      acceptanceCriteria: ["change the timeout"],
      validationCommands: []
    };

    assert.doesNotThrow(() => assertChangesWithinTaskScope([
      { path: "./handlers\\user.go", original: "old", updated: "new" }
    ], contract));
    assert.throws(() => assertChangesWithinTaskScope([
      { path: "models/user.go", original: "old", updated: "new" }
    ], contract), /out-of-scope/i);
  });

  it("does not restrict requests without explicit file selection", () => {
    assert.doesNotThrow(() => assertChangesWithinTaskScope([
      { path: "src/any-file.ts", original: "old", updated: "new" }
    ], {
      requestId: "request-2",
      intent: "implementation",
      selectedPaths: [],
      selectedRanges: [],
      requiredDependencyPaths: [],
      dependencyEvidence: [],
      allowedEditPaths: [],
      dependencyEditPolicy: "selected-only",
      acceptanceCriteria: [],
      validationCommands: []
    }));
  });

  it("applies planned updates when original is a selection or has different newlines", () => {
    assert.equal(
      resolveApplyContent("a\r\nb\r\nc\r\n", "a\nb\nc\n", "a\nB\nc\n"),
      "a\r\nB\r\nc\r\n"
    );
    assert.equal(
      resolveApplyContent(
        "header\nfunc Update() {}\nfooter\n",
        "func Update() {}",
        "func Update() { return nil }"
      ),
      "header\nfunc Update() { return nil }\nfooter\n"
    );
    assert.equal(
      resolveApplyContent("current-full-file\n", "stale-snippet", "new-full-file\n"),
      "new-full-file\n"
    );
  });
});

describe("change sets", () => {
  it("builds named change sets with hunks and hashes", () => {
    const change = { path: "src/a.ts", original: "a\nb\nc\n", updated: "a\nB\nc\n" };
    const set = createNamedChangeSet([change], "fix-typo");
    assert.equal(set.name, "fix-typo");
    assert.equal(set.files.length, 1);
    assert.equal(set.files[0].originalHash.length, 64);
    assert.ok(splitHunks("src/a.ts", change.original, change.updated).length >= 1);
    assert.equal(buildFileReview(change).path, "src/a.ts");
    assert.equal(set.audit[0].action, "created");
  });

  it("applies only approved hunks", () => {
    const original = "one\ntwo\nthree\nfour\nfive";
    const updated = "ONE\ntwo\nthree\nfour\nFIVE";
    const hunks = splitHunks("src/a.ts", original, updated);
    const first = hunks.find((hunk) => hunk.startLine === 1);
    assert.ok(first);

    assert.equal(
      applyHunkApprovals(original, updated, [first.id], hunks),
      "ONE\ntwo\nthree\nfour\nfive"
    );
  });
});

describe("memory conflicts", () => {
  it("keeps both local and backend facts by default", () => {
    const { conflicts, merged } = resolveMemoryConflicts(
      [{ kind: "finding", content: "Auth uses JWT tokens in middleware", source: "local" }],
      [{ kind: "finding", content: "Auth uses session cookies in middleware", source: "backend" }],
      "keep_both"
    );
    assert.ok(conflicts.length >= 1);
    assert.ok(merged.length >= 2);
    assert.match(formatConflictSummary(conflicts), /keep_both/);
  });
});
