import assert from "node:assert/strict";
import test from "node:test";

import { GitignoreRules } from "./gitignore.ts";

test("matches ignored directories, file globs, and nested paths", () => {
  const rules = GitignoreRules.fromText([
    ".angular/",
    ".vscode/",
    "build/",
    "*.log",
    "!keep.log"
  ].join("\n"));

  assert.equal(rules.isIgnored(".angular/cache/index.js"), true);
  assert.equal(rules.isIgnored("src/.vscode/settings.json"), true);
  assert.equal(rules.isIgnored("build/output.js"), true);
  assert.equal(rules.isIgnored("logs/server.log"), true);
  assert.equal(rules.isIgnored("keep.log"), false);
  assert.equal(rules.isIgnored("src/main.ts"), false);
});

test("supports root-relative patterns and double-star globs", () => {
  const rules = GitignoreRules.fromText([
    "/generated/",
    "**/*.snap"
  ].join("\n"));

  assert.equal(rules.isIgnored("generated/file.ts"), true);
  assert.equal(rules.isIgnored("src/generated/file.ts"), false);
  assert.equal(rules.isIgnored("src/deep/result.snap"), true);
});