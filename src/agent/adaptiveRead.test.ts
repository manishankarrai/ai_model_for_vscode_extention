import assert from "node:assert/strict";
import test from "node:test";

import { readBoundedTextChunk } from "./adaptiveRead.ts";

test("paginates at line boundaries and reports remaining lines", () => {
  const content = Array.from({ length: 10 }, (_, index) => `line-${index + 1}`).join("\n");

  const first = readBoundedTextChunk(content, 0, 100, 3);
  assert.equal(first.startLine, 1);
  assert.equal(first.endLine, 3);
  assert.equal(first.totalLines, 10);
  assert.equal(first.remainingLines, 7);
  assert.equal(first.hasMore, true);
  assert.equal(first.content, "line-1\nline-2\nline-3\n");

  const second = readBoundedTextChunk(content, first.nextOffset, 100, 3);
  assert.equal(second.startLine, 4);
  assert.equal(second.endLine, 6);
  assert.equal(second.remainingLines, 4);
  assert.equal(second.content, "line-4\nline-5\nline-6\n");
});

test("reads a requested function range without loading the whole file", () => {
  const content = Array.from({ length: 100 }, (_, index) => `line-${index + 1}`).join("\n");

  const chunk = readBoundedTextChunk(content, 0, 1000, 4, 40, 50);

  assert.equal(chunk.startLine, 40);
  assert.equal(chunk.endLine, 43);
  assert.equal(chunk.totalLines, 100);
  assert.equal(chunk.remainingLines, 57);
  assert.equal(chunk.hasMore, true);
  assert.equal(chunk.content.startsWith("line-40\n"), true);
  assert.equal(chunk.content.endsWith("line-43\n"), true);

  const nextChunk = readBoundedTextChunk(content, chunk.nextOffset, 1000, 4, undefined, 50);
  assert.equal(nextChunk.startLine, 44);
  assert.equal(nextChunk.endLine, 47);
  assert.equal(nextChunk.hasMore, true);
});