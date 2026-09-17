import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSafeCommand } from "./commandPolicy.ts";

describe("command policy", () => {
  it("parses ordinary, quoted, and platform-specific commands", () => {
    assert.deepEqual(parseSafeCommand("npm test"), {
      binary: "npm",
      args: ["test"]
    });
    assert.deepEqual(parseSafeCommand("go test ./..."), {
      binary: "go",
      args: ["test", "./..."]
    });
    assert.deepEqual(parseSafeCommand("python -c \"print('hello world')\""), {
      binary: "python",
      args: ["-c", "print('hello world')"]
    });
    assert.deepEqual(parseSafeCommand("pwsh -Command \"Get-ChildItem | Select-Object Name\""), {
      binary: "pwsh",
      args: ["-Command", "Get-ChildItem | Select-Object Name"]
    });
  });

  it("allows arbitrary executables because execution requires approval", () => {
    assert.deepEqual(parseSafeCommand("curl https://example.com"), {
      binary: "curl",
      args: ["https://example.com"]
    });
    assert.deepEqual(parseSafeCommand("npm test && rm -rf /"), {
      binary: "npm",
      args: ["test", "&&", "rm", "-rf", "/"]
    });
  });

  it("rejects malformed command lines", () => {
    assert.throws(() => parseSafeCommand('python -c "unfinished'), /unfinished quote/);
    assert.throws(() => parseSafeCommand("bad?command arg"), /invalid command executable/);
  });

  it("rejects oversized command payloads", () => {
    assert.throws(() => parseSafeCommand("node " + "x".repeat(4_001)), /longer than/);
    assert.throws(() => parseSafeCommand("node " + Array(65).fill("arg").join(" ")), /more than/);
  });
});
