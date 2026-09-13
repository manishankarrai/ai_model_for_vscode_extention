import { flow } from "../utils/flowLog.ts";

import * as vscode from "vscode";

import {
  DependencyInfo,
  DependencyEvidence,
  ProjectIndex
} from "../models/types.ts";

import {
  readTextFile
} from "../utils/FileUtils.ts";

import { containsExecutableSymbolReference } from "./dependencyReference.ts";

export class DependencyResolver {

  async resolve(
    dependency: DependencyInfo,
    index: ProjectIndex
  ): Promise<string[]> {
    flow("DependencyResolver.resolve", 1, "enter", { target: dependency.target });

    /*
     * ---------------------------------------------------------
     * JavaScript / TypeScript / relative imports
     * ---------------------------------------------------------
     */

    if (
      dependency.target.startsWith(".")
    ) {

      const resolved =
        this.resolveRelativeDependency(
          dependency.source,
          dependency.target,
          index
        );

      return resolved
        ? [resolved]
        : [];
    }

    /*
     * ---------------------------------------------------------
     * Go package imports
     * ---------------------------------------------------------
     */

    if (
      dependency.type === "package" &&
      dependency.source.endsWith(".go")
    ) {

      return this.resolveGoDependency(
        dependency.target,
        index
      );
    }

    if (
      dependency.type === "import" ||
      dependency.type === "require"
    ) {
      const resolved = await this.resolveWorkspaceQualifiedDependency(
        dependency.target,
        index
      );
      return resolved ? [resolved] : [];
    }

    /*
     * ---------------------------------------------------------
     * Other non-relative imports are currently treated
     * as external dependencies.
     * ---------------------------------------------------------
     */

    return [];
  }

  async resolveForFiles(
    filePaths: string[],
    index: ProjectIndex
  ): Promise<string[]> {
    const resolved = new Set<string>();

    for (const filePath of filePaths) {
      const indexed = index.files.get(filePath);
      if (!indexed) {
        continue;
      }

      for (const dependency of indexed.dependencies) {
        for (const dependencyPath of await this.resolve(dependency, index)) {
          if (dependencyPath !== filePath) {
            resolved.add(dependencyPath);
          }
        }
      }
    }

    return [...resolved];
  }

  async resolveForFilesWithEvidence(
    filePaths: string[],
    index: ProjectIndex,
    selectedRanges: Array<{ path: string; startLine?: number; endLine?: number }> = []
  ): Promise<DependencyEvidence[]> {
    const evidence: DependencyEvidence[] = [];

    for (const filePath of filePaths) {
      const indexed = index.files.get(filePath);
      if (!indexed) {
        continue;
      }

      let content: string;
      try {
        content = await readTextFile(vscode.Uri.file(indexed.file.absolutePath));
      } catch {
        continue;
      }

      const range = selectedRanges.find((candidate) => candidate.path === filePath);
      const sourceSymbols = indexed.symbols
        .filter((symbol) => !range || (
          (range.startLine === undefined || symbol.line >= range.startLine) &&
          (range.endLine === undefined || symbol.line <= range.endLine)
        ))
        .map((symbol) => symbol.name);

      for (const dependency of indexed.dependencies) {
        const targetPaths = await this.resolve(dependency, index);
        for (const targetPath of targetPaths) {
          const targetSymbols = (index.files.get(targetPath)?.symbols ?? [])
            .filter((symbol) => containsExecutableSymbolReference(content, symbol.name))
            .map((symbol) => symbol.name);
          if (targetSymbols.length === 0) {
            continue;
          }
          evidence.push({
            sourcePath: filePath,
            sourceSymbols,
            targetPath,
            targetSymbols,
            reason: `Referenced symbols ${targetSymbols.join(", ")} resolve from ${filePath}`
          });
        }
      }
    }

    return evidence;
  }

  private resolveRelativeDependency(
    sourceFile: string,
    dependency: string,
    index: ProjectIndex
  ): string | undefined {
    flow("DependencyResolver.resolveRelativeDependency", 1, "enter");

    const sourceDirectory =
      this.getDirectory(
        sourceFile
      );

    const normalized =
      this.normalizePath(
        sourceDirectory +
        "/" +
        dependency
      );

    const candidates = [
      normalized,

      `${normalized}.go`,
      `${normalized}.ts`,
      `${normalized}.js`,
      `${normalized}.tsx`,
      `${normalized}.jsx`,
      `${normalized}.py`,
      `${normalized}.java`,
      `${normalized}.php`,

      `${normalized}/index.ts`,
      `${normalized}/index.js`,
      `${normalized}/index.go`,
      `${normalized}/index.tsx`,
      `${normalized}/index.jsx`
    ];

    for (
      const candidate of candidates
    ) {

      if (
        index.files.has(
          candidate
        )
      ) {

        return candidate;
      }
    }

    return undefined;
  }

  private async resolveWorkspaceQualifiedDependency(
    dependency: string,
    index: ProjectIndex
  ): Promise<string | undefined> {
    const candidates = new Set<string>();
    const tsConfig = index.files.get("tsconfig.json");

    if (tsConfig) {
      try {
        const parsed = JSON.parse(
          await readTextFile(vscode.Uri.file(tsConfig.file.absolutePath))
        ) as {
          compilerOptions?: {
            baseUrl?: string;
            paths?: Record<string, string[]>;
          };
        };
        const compilerOptions = parsed.compilerOptions ?? {};
        const baseUrl = this.normalizePath(compilerOptions.baseUrl ?? "");
        for (const [pattern, targets] of Object.entries(compilerOptions.paths ?? {})) {
          const wildcard = pattern.indexOf("*");
          if (wildcard === -1 && pattern !== dependency) {
            continue;
          }
          const prefix = wildcard === -1 ? pattern : pattern.slice(0, wildcard);
          const suffix = wildcard === -1 ? "" : pattern.slice(wildcard + 1);
          if (!dependency.startsWith(prefix) || !dependency.endsWith(suffix)) {
            continue;
          }
          const match = dependency.slice(prefix.length, dependency.length - suffix.length || undefined);
          for (const target of targets) {
            candidates.add(this.normalizePath(`${baseUrl}/${target.replace("*", match)}`));
          }
        }
        if (compilerOptions.baseUrl) {
          candidates.add(this.normalizePath(`${baseUrl}/${dependency}`));
        }
      } catch {
        // Invalid compiler configuration should not block other resolution strategies.
      }
    }

    candidates.add(this.normalizePath(dependency));
    for (const candidate of candidates) {
      const resolved = this.resolveFileCandidates(candidate, index);
      if (resolved) {
        return resolved;
      }
    }
    return undefined;
  }

  private resolveFileCandidates(
    normalized: string,
    index: ProjectIndex
  ): string | undefined {
    const candidates = [
      normalized,
      `${normalized}.ts`,
      `${normalized}.tsx`,
      `${normalized}.js`,
      `${normalized}.jsx`,
      `${normalized}.mjs`,
      `${normalized}.cjs`,
      `${normalized}/index.ts`,
      `${normalized}/index.tsx`,
      `${normalized}/index.js`,
      `${normalized}/index.jsx`
    ];
    return candidates.find((candidate) => index.files.has(candidate));
  }

  private goModules: Map<string, { moduleName: string; dir: string }> | undefined;

  private async getGoModules(
    index: ProjectIndex
  ): Promise<Map<string, { moduleName: string; dir: string }>> {
    if (this.goModules) {
      return this.goModules;
    }

    const modules = new Map<string, { moduleName: string; dir: string }>();

    for (const [filePath, indexed] of index.files.entries()) {
      if (filePath === "go.mod" || filePath.endsWith("/go.mod")) {
        try {
          const content = await readTextFile(vscode.Uri.file(indexed.file.absolutePath));
          const match = content.match(/^\s*module\s+([^\s]+)\s*$/m);
          if (match) {
            const moduleName = match[1].trim();
            const dir = this.getDirectory(filePath);
            modules.set(moduleName, { moduleName, dir });
          }
        } catch {
          // Ignore unreadable go.mod
        }
      }
    }

    this.goModules = modules;
    return modules;
  }

  private async resolveGoDependency(
    dependency: string,
    index: ProjectIndex
  ): Promise<string[]> {
    const modules = await this.getGoModules(index);
    if (modules.size === 0) {
      return [];
    }

    let matchedModule: { moduleName: string; dir: string } | undefined;
    for (const mod of modules.values()) {
      if (dependency === mod.moduleName || dependency.startsWith(`${mod.moduleName}/`)) {
        if (!matchedModule || mod.moduleName.length > matchedModule.moduleName.length) {
          matchedModule = mod;
        }
      }
    }

    if (!matchedModule) {
      return [];
    }

    const packageSubPath = dependency === matchedModule.moduleName
      ? ""
      : dependency.slice(matchedModule.moduleName.length + 1);

    const targetDir = this.normalizePath(
      matchedModule.dir ? `${matchedModule.dir}/${packageSubPath}` : packageSubPath
    );

    const matchingFiles: string[] = [];

    for (const filePath of index.files.keys()) {
      if (!filePath.endsWith(".go")) {
        continue;
      }

      const directory = this.getDirectory(filePath);
      if (directory === targetDir) {
        matchingFiles.push(filePath);
      }
    }

    return matchingFiles;
  }

  private getDirectory(
    filePath: string
  ): string {
    flow("DependencyResolver.getDirectory", 1, "enter");

    const index =
      filePath.lastIndexOf("/");

    if (
      index === -1
    ) {
      return "";
    }

    return filePath.slice(
      0,
      index
    );
  }

  private normalizePath(
    filePath: string
  ): string {
    flow("DependencyResolver.normalizePath", 1, "enter");

    const parts =
      filePath.split("/");

    const result: string[] = [];

    for (
      const part of parts
    ) {

      if (
        !part ||
        part === "."
      ) {
        continue;
      }

      if (
        part === ".."
      ) {

        result.pop();

        continue;
      }

      result.push(
        part
      );
    }

    return result.join("/");
  }
}