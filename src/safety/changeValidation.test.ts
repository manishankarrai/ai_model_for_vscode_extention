import { flow } from "../utils/flowLog.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertFileHashMatches,
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
  splitHunks
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
    assert.throws(
      () => resolveApplyContent("current-full-file\n", "stale-snippet", "new-full-file\n"),
      /does not match the current file/i
    );
  });

  it("never replaces a file when a selected edit is stale or ambiguous", () => {
    assert.throws(
      () => resolveApplyContent(
        "function A() {}\nfunction B() {}\n",
        "function Missing() {}",
        "function Missing() { return true; }"
      ),
      /does not match the current file/i
    );
    assert.throws(
      () => resolveApplyContent(
        "function A() {}\nfunction A() {}\n",
        "function A() {}",
        "function A() { return true; }"
      ),
      /does not match the current file/i
    );
  });

  it("applies a uniquely matching selection when only whitespace differs", () => {
    assert.equal(
      resolveApplyContent(
        "func Update() {\n\treturn 1\n}\n",
        "func Update() {\n  return 1\n}",
        "func Update() {\n\treturn 2\n}"
      ),
      "func Update() {\n\treturn 2\n}\n"
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
