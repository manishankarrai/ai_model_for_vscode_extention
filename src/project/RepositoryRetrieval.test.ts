import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import { RepositoryRetrieval } from "./RepositoryRetrieval.ts";

test("RepositoryRetrieval reads ranges, symbols, summaries, and relationships", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm3-retrieval-"));
  try {
    await fs.writeFile(path.join(workspace, "service.ts"), [
      "export class Service {",
      "  create() {",
      "    return helper();",
      "  }",
      "}",
      "function helper() {",
      "  return 1;",
      "}"
    ].join("\n"), "utf8");

    const retrieval = new RepositoryRetrieval();
    const range = await retrieval.readFileRange(workspace, "service.ts", 2, 4);
    assert.match(range.output, /lines=2-4/);
    assert.match(range.output, /return helper/);

    const symbol = await retrieval.readSymbol(workspace, "Service.create");
    assert.equal(symbol.success, true);
    assert.match(symbol.output, /kind=method/);
    assert.match(symbol.output, /lines=2-4/);

    const fileSummary = await retrieval.getFileSummary(workspace, "service.ts");
    assert.match(fileSummary.output, /Service.create:method:2-4/);

    const definition = await retrieval.findDefinition(workspace, "helper");
    assert.match(definition.output, /helper kind=function/);
    const callers = await retrieval.findCallers(workspace, "helper");
    assert.match(callers.output, /Service.create -> helper/);
    const callees = await retrieval.findCallees(workspace, "Service.create");
    assert.match(callees.output, /Service.create -> helper/);

    const projectSummary = await retrieval.getProjectSummary(workspace);
    assert.match(projectSummary.output, /indexVersion=1/);
    assert.match(projectSummary.output, /symbols=3/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("RepositoryRetrieval rejects unsafe paths", async () => {
  const retrieval = new RepositoryRetrieval();
  await assert.rejects(
    retrieval.readFileRange("/tmp", "../secret.txt"),
    /Unsafe repository path/
  );
});