import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSafeCommand } from "./commandPolicy.ts";
describe("command policy", () => {
    it("allows npm test and go test", () => {
        assert.deepEqual(parseSafeCommand("npm test"), {
            binary: "npm",
            args: ["test"]
        });
        assert.deepEqual(parseSafeCommand("go test ./..."), {
            binary: "go",
            args: ["test", "./..."]
        });
    });
    it("rejects shell chaining and unknown binaries", () => {
        assert.throws(() => parseSafeCommand("npm test && rm -rf /"), /metacharacters/);
        assert.throws(() => parseSafeCommand("curl https://example.com"), /blocked command binary/);
        assert.throws(() => parseSafeCommand("git reset --hard"), /destructive git/);
    });
});
