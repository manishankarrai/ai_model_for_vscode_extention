import type { Relationship } from "../project/RepositoryRetrieval.ts";

export interface ChangeImpactReport {
  changedPaths: string[];
  affectedFiles: string[];
  affectedSymbols: string[];
  tests: string[];
  routes: string[];
  dataAccess: string[];
  relationships: Relationship[];
}

export class ChangeImpactAnalyzer {
  analyze(changedPaths: string[], relationships: Relationship[]): ChangeImpactReport {
    const normalizedPaths = [...new Set(changedPaths.map((item) => item.trim()).filter(Boolean))].sort();
    const pathStems = normalizedPaths.map((changedPath) => {
      const fileName = changedPath.split("/").at(-1) ?? changedPath;
      return fileName.replace(/\.[^.]+$/, "").toLowerCase();
    });
    const matches = relationships.filter((relationship) => normalizedPaths.some((changedPath, index) => {
      const stem = pathStems[index];
      return relationship.from === changedPath ||
        relationship.to === changedPath ||
        relationship.resolvedPath === changedPath ||
        relationship.sourcePath === changedPath ||
        relationship.to.toLowerCase().includes(stem);
    }));
    const affectedFiles = new Set<string>(normalizedPaths);
    const affectedSymbols = new Set<string>();
    const tests = new Set<string>();
    const routes = new Set<string>();
    const dataAccess = new Set<string>();

    for (const relationship of matches) {
      if (relationship.sourcePath) {
        affectedFiles.add(relationship.sourcePath);
      }
      if (relationship.kind === "import" && relationship.from) {
        affectedFiles.add(relationship.from);
      }
      if (relationship.kind === "test") {
        tests.add(relationship.sourcePath || relationship.from);
      }
      if (relationship.kind === "route") {
        routes.add(`${relationship.from} -> ${relationship.to}`);
      }
      if (relationship.kind === "read" || relationship.kind === "write") {
        dataAccess.add(`${relationship.kind}: ${relationship.from} -> ${relationship.to}`);
      }
      if (relationship.kind === "reference" || relationship.kind === "call") {
        affectedSymbols.add(`${relationship.from} -> ${relationship.to}`);
      }
    }

    return {
      changedPaths: normalizedPaths,
      affectedFiles: [...affectedFiles].sort(),
      affectedSymbols: [...affectedSymbols].sort(),
      tests: [...tests].sort(),
      routes: [...routes].sort(),
      dataAccess: [...dataAccess].sort(),
      relationships: matches
    };
  }
}