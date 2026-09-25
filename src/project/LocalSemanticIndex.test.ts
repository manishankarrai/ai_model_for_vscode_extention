import assert from "node:assert/strict";
import test from "node:test";

import { LocalSemanticIndex } from "./LocalSemanticIndex.ts";
import type { EmbeddingProvider } from "./LocalSemanticIndex.ts";

class CountingEmbeddingProvider implements EmbeddingProvider {
  calls = 0;

  embed(content: string): Map<string, number> {
    this.calls += 1;
    return new Map(content.split(/\s+/).filter(Boolean).map((token) => [token, 1]));
  }
}

test("LocalSemanticIndex ranks related token vectors deterministically", async () => {
  const index = new LocalSemanticIndex();
  index.upsert({ path: "auth.ts", content: "validate user credentials and session token" });
  index.upsert({ path: "billing.ts", content: "calculate invoice totals and payment balance" });

  const results = await index.search("user session credentials", 10);
  assert.equal(results[0]?.path, "auth.ts");
  assert.ok((results[0]?.score ?? 0) > 0);
  assert.equal(results.length, 1);
});

test("LocalSemanticIndex supports symbol chunks and safe empty searches", async () => {
  const index = new LocalSemanticIndex();
  index.upsert({ path: "service.ts", startLine: 10, endLine: 20, content: "load project configuration" });
  assert.deepEqual(await index.search("", 10), []);
  const results = await index.search("configuration", 1);
  assert.deepEqual(results[0], {
    path: "service.ts",
    startLine: 10,
    endLine: 20,
    score: results[0]?.score
  });
  assert.equal(typeof results[0]?.score, "number");
});

test("LocalSemanticIndex tokenizes camelCase identifiers and removes complete files", async () => {
  const index = new LocalSemanticIndex();
  index.upsert({ path: "service.ts", content: "function loadProjectConfig() {}" });
  assert.equal((await index.search("project config", 10))[0]?.path, "service.ts");
  index.removeFile("service.ts");
  assert.deepEqual(await index.search("project config", 10), []);
});

test("LocalSemanticIndex downweights terms shared across documents", async () => {
  const index = new LocalSemanticIndex();
  index.upsert({ path: "generic.ts", content: "function handle shared request" });
  index.upsert({ path: "auth.ts", content: "function handle shared refreshAccessToken" });

  const results = await index.search("shared refreshAccessToken", 10);
  assert.equal(results[0]?.path, "auth.ts");
});

test("LocalSemanticIndex matches natural language aliases and ignores syntax boilerplate", async () => {
  const index = new LocalSemanticIndex();
  index.upsert({ path: "settings.ts", content: "export function loadProjectConfig() { return settings; }" });
  index.upsert({ path: "account.ts", content: "export class Account { return account; }" });

  const results = await index.search("configuration", 10);
  assert.equal(results[0]?.path, "settings.ts");
  assert.equal((await index.search("function return", 10)).length, 0);
});

test("LocalSemanticIndex uses identifier n-grams for related terminology", async () => {
  const index = new LocalSemanticIndex();
  index.upsert({ path: "auth.ts", content: "export function authenticateUser() {}" });
  assert.equal((await index.search("authentication", 10))[0]?.path, "auth.ts");
});

test("LocalSemanticIndex aborts cancelled searches", async () => {
  const controller = new AbortController();
  controller.abort();
  const index = new LocalSemanticIndex();
  await assert.rejects(index.search("config", 10, controller.signal), /cancelled/);
});

test("LocalSemanticIndex reuses document embeddings and invalidates them on clear", async () => {
  const provider = new CountingEmbeddingProvider();
  const index = new LocalSemanticIndex(provider);
  index.upsert({ path: "service.ts", content: "load configuration" });

  await index.search("configuration", 10);
  await index.search("load", 10);
  assert.equal(provider.calls, 3);

  index.clear();
  index.upsert({ path: "service.ts", content: "load configuration" });
  await index.search("configuration", 10);
  assert.equal(provider.calls, 5);
});

test("LocalSemanticIndex expands observability terminology", async () => {
  const index = new LocalSemanticIndex();
  index.upsert({ path: "metrics.ts", content: "telemetry tracing metrics" });

  const results = await index.search("observability", 5);

  assert.equal(results[0]?.path, "metrics.ts");
});