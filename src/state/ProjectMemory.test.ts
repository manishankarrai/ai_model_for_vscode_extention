import { flow } from "../utils/flowLog.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProjectMemory } from "./ProjectMemory.ts";

describe("ProjectMemory", () => {
  it("stores project facts and returns a summary", () => {
    flow("ProjectMemory.test.storesFacts", 1, "enter");
    const memory = new ProjectMemory({
      get: () => undefined,
      update: async () => undefined,
    } as any);

    memory.initializeFromProjectModel({
      rootPath: "/tmp/project",
      languages: ["TypeScript"],
      frameworks: ["VS Code"],
      files: [],
      symbols: [],
      imports: [],
      dependencies: [],
      entryPoints: [],
      modules: [],
      configFiles: [],
      testFiles: [],
      createdAt: 0,
      updatedAt: 0,
    } as any);

    memory.recordFinding("Authentication is centralized in the API layer.");
    memory.addImportantDependency("@types/node");
    memory.addProjectConvention("Use read-only tools and validate file access.");

    const snapshot = memory.getSnapshot();

    assert.equal(snapshot.projectSummary.includes("TypeScript"), true);
    assert.equal(snapshot.findings.length >= 1, true);
    assert.equal(snapshot.dependencies.includes("@types/node"), true);
    assert.equal(snapshot.conventions.length >= 1, true);
  });
});
