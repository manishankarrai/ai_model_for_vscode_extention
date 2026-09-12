import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertFileHashMatches, assertNotSensitivePath, assertWorkspaceTrusted, hashContent, isSensitivePath, resolveApplyContent, validateChangeSize, validateWorkspaceRelativePath } from "./changeValidation.ts";
import { buildFileReview, createNamedChangeSet, splitHunks } from "./changeSets.ts";
import { formatConflictSummary, resolveMemoryConflicts } from "./memoryConflict.ts";
describe("stale-file protection", () => {
    it("rejects parent-path writes", () => {
        assert.throws(() => validateWorkspaceRelativePath("../secret.ts"), /unsafe change path|rejected unsafe/i);
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
        assert.throws(() => assertFileHashMatches("src/a.ts", "new", hashContent("old"), "apply"), /hash changed/i);
    });
    it("accepts an unchanged apply candidate", () => {
        validateChangeSize("src/a.ts", "old", "new");
        assertFileHashMatches("src/a.ts", "old", hashContent("old"), "apply");
    });
    it("applies planned updates when original is a selection or has different newlines", () => {
        assert.equal(resolveApplyContent("a\r\nb\r\nc\r\n", "a\nb\nc\n", "a\nB\nc\n"), "a\r\nB\r\nc\r\n");
        assert.equal(resolveApplyContent("header\nfunc Update() {}\nfooter\n", "func Update() {}", "func Update() { return nil }"), "header\nfunc Update() { return nil }\nfooter\n");
        assert.equal(resolveApplyContent("current-full-file\n", "stale-snippet", "new-full-file\n"), "new-full-file\n");
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
        const { conflicts, merged } = resolveMemoryConflicts([{ kind: "finding", content: "Auth uses JWT tokens in middleware", source: "local" }], [{ kind: "finding", content: "Auth uses session cookies in middleware", source: "backend" }], "keep_both");
        assert.ok(conflicts.length >= 1);
        assert.ok(merged.length >= 2);
        assert.match(formatConflictSummary(conflicts), /keep_both/);
    });
});
