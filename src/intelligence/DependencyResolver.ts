import { flow } from "../utils/flowLog";

import * as vscode from "vscode";

import {
  DependencyInfo,
  ProjectIndex
} from "../models/types";

import {
  readTextFile
} from "../utils/FileUtils";

export class DependencyResolver {

  private moduleName:
    string | undefined;

  private moduleLoaded = false;

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

    /*
     * ---------------------------------------------------------
     * Other non-relative imports are currently treated
     * as external dependencies.
     * ---------------------------------------------------------
     */

    return [];
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

  private async resolveGoDependency(
    dependency: string,
    index: ProjectIndex
  ): Promise<string[]> {

    const moduleName =
      await this.getGoModuleName(
        index
      );

    if (!moduleName) {
      return [];
    }

    /*
     * External Go package.
     *
     * Example:
     *
     * github.com/golang-jwt/jwt/v5
     *
     * does not belong to:
     *
     * module uber-backend
     */

    if (
      dependency !== moduleName &&
      !dependency.startsWith(
        `${moduleName}/`
      )
    ) {

      return [];
    }

    /*
     * Convert:
     *
     * uber-backend/services
     *
     * into:
     *
     * services
     */

    const packagePath =
      dependency === moduleName
        ? ""
        : dependency.slice(
            moduleName.length + 1
          );

    const normalizedPackage =
      this.normalizePath(
        packagePath
      );

    /*
     * A Go package can contain multiple .go files.
     *
     * Example:
     *
     * services/
     *   jwt_service.go
     *   fare_service.go
     *   otp_service.go
     *
     * We return all files belonging to that package.
     */

    const matchingFiles: string[] = [];

    for (
      const filePath of index.files.keys()
    ) {

      if (
        !filePath.endsWith(".go")
      ) {
        continue;
      }

      const directory =
        this.getDirectory(
          filePath
        );

      if (
        directory === normalizedPackage
      ) {

        matchingFiles.push(
          filePath
        );
      }
    }

    return matchingFiles;
  }

  private async getGoModuleName(
    index: ProjectIndex
  ): Promise<string | undefined> {

    if (
      this.moduleLoaded
    ) {
      return this.moduleName;
    }

    this.moduleLoaded = true;

    /*
     * Find go.mod inside the existing ProjectIndex.
     *
     * We do NOT scan the filesystem here.
     */

    const goMod =
      index.files.get(
        "go.mod"
      );

    if (!goMod) {
      return undefined;
    }

    try {

      const content =
        await readTextFile(
          vscode.Uri.file(
            goMod.file.absolutePath
          )
        );

      const match =
        content.match(
          /^\s*module\s+([^\s]+)\s*$/m
        );

      if (!match) {
        return undefined;
      }

      this.moduleName =
        match[1].trim();

      return this.moduleName;

    } catch {

      return undefined;
    }
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