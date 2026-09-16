import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProjectIndex } from "../models/types";
import { buildProjectFingerprint } from "./projectFingerprint";

describe("project fingerprint", () => {
  it("contains structure metadata without file contents", () => {
    const index: ProjectIndex = {
      rootPath: "/workspace",
      version: 3,
      files: new Map([
        ["src/main.ts", {
          file: {
            path: "src/main.ts",
            absolutePath: "/workspace/src/main.ts",
            size: 1200,
            language: "TypeScript",
            hash: "a",
            modifiedAt: 1
          },
          symbols: [{ name: "main", kind: "function", filePath: "src/main.ts", line: 1, character: 1 }],
          dependencies: [{ source: "src/main.ts", target: "react", type: "package" }]
        }],
        ["src/main.test.ts", {
          file: {
            path: "src/main.test.ts",
            absolutePath: "/workspace/src/main.test.ts",
            size: 800,
            language: "TypeScript",
            hash: "b",
            modifiedAt: 1
          },
          symbols: [],
          dependencies: []
        }]
      ]),
      symbols: [{ name: "main", kind: "function", filePath: "src/main.ts", line: 1, character: 1 }],
      dependencies: [{ source: "src/main.ts", target: "react", type: "package" }],
      createdAt: 1,
      updatedAt: 2
    };

    const fingerprint = buildProjectFingerprint(index);
    assert.equal(fingerprint.file_count, 2);
    assert.equal(fingerprint.total_bytes, 2000);
    assert.equal(fingerprint.test_file_count, 1);
    assert.deepEqual(fingerprint.languages, ["TypeScript"]);
    assert.deepEqual(fingerprint.frameworks, ["react"]);
    assert.equal("content" in fingerprint, false);
  });
});