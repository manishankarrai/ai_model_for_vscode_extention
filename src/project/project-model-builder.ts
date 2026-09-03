import * as path from "path";

import {
  DependencyInfo,
  ProjectIndex
} from "../models/types";

import {
  ProjectFile,
  ProjectModel,
  ProjectSymbol,
  ProjectImport,
  ProjectDependency,
} from "./project-model";

import { FileClassifier } from "./file-classifier";
import { EntryPointDetector } from "./entry-point-detector";
import { FrameworkDetector } from "./framework-detector";
import { ModuleDetector } from "./module-detector";

export class ProjectModelBuilder {
  private readonly classifier = new FileClassifier();
  private readonly entryPointDetector = new EntryPointDetector();
  private readonly frameworkDetector = new FrameworkDetector();
  private readonly moduleDetector = new ModuleDetector();

  build(index: ProjectIndex): ProjectModel {
    const indexedFiles = [...index.files.values()];
    const projectFiles: ProjectFile[] = indexedFiles.map(({ file }) => {
      const classification = this.classifier.classify(file.path);

      return {
        path: file.path,
        relativePath: file.path,
        absolutePath: file.absolutePath,
        extension: path.extname(file.path),
        language: file.language || classification.language,
        isTest: classification.isTest,
        isConfig: classification.isConfig,
        size: file.size,
        hash: file.hash,
        modifiedAt: file.modifiedAt,
      };
    });

    const projectFilePaths = indexedFiles.map(
      ({ file }) => file.absolutePath
    );

    const languages = [
      ...new Set(
        projectFiles
          .map((file) => file.language)
          .filter(
            (language): language is string => Boolean(language)
          )
      ),
    ];

    const symbols: ProjectSymbol[] = index.symbols.map((symbol) => ({
      name: symbol.name,
      kind: symbol.kind,
      filePath: symbol.filePath,
      startLine: symbol.line,
    }));

    const imports: ProjectImport[] = index.dependencies
      .filter(
        (dependency): dependency is DependencyInfo & {
          type: "import" | "require";
        } => dependency.type === "import" || dependency.type === "require"
      )
      .map((dependency) => ({
        sourceFile: dependency.source,
        importedPath: dependency.target,
        source: dependency.source,
        target: dependency.target,
        type: dependency.type,
      }));

    const dependencies: ProjectDependency[] = index.dependencies
      .filter(
        (dependency): dependency is DependencyInfo & {
          type: "package" | "reference";
        } => dependency.type === "package" || dependency.type === "reference"
      )
      .map((dependency) => ({
        name: dependency.target,
        type: dependency.type,
        source: dependency.source,
        target: dependency.target,
      }));

    const frameworks = this.frameworkDetector.detect(index);
    const entryPoints = this.entryPointDetector.detect(projectFilePaths);
    const modules = this.moduleDetector.detect(index.rootPath, projectFilePaths);
    const configFiles = projectFiles
      .filter((file) => file.isConfig)
      .map((file) => file.path);
    const testFiles = projectFiles
      .filter((file) => file.isTest)
      .map((file) => file.path);

    return {
      rootPath: index.rootPath,
      languages,
      frameworks,
      files: projectFiles,
      symbols,
      imports,
      dependencies,
      entryPoints,
      modules,
      configFiles,
      testFiles,
      createdAt: index.createdAt,
      updatedAt: index.updatedAt,
    };
  }
}