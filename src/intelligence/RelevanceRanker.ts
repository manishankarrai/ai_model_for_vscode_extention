import {
  ProjectIndex,
  SearchResult
} from "../models/types";

import {
  ProjectModel
} from "../project/project-model";

export class RelevanceRanker {

  rank(
    question: string,
    index: ProjectIndex,
    searchResults: SearchResult[],
    projectModel?: ProjectModel
  ): SearchResult[] {

    const questionTerms =
      this.extractTerms(question);

    const resultMap =
      new Map<string, SearchResult>();

    for (const result of searchResults) {

      resultMap.set(
        result.path,
        {
          ...result
        }
      );
    }

    // --------------------------------------------------------
    // Symbol relevance
    // --------------------------------------------------------

    for (const symbol of index.symbols) {

      const symbolName =
        symbol.name.toLowerCase();

      const matchedTerms =
        questionTerms.filter(
          term =>
            symbolName.includes(term)
        );

      if (matchedTerms.length === 0) {
        continue;
      }

      const score =
        matchedTerms.length * 15;

      const existing =
        resultMap.get(
          symbol.filePath
        );

      if (existing) {

        existing.score += score;

        existing.matches +=
          matchedTerms.length;

        existing.reason +=
          "; relevant symbol";

      } else {

        resultMap.set(
          symbol.filePath,
          {
            path: symbol.filePath,
            score,
            matches: matchedTerms.length,
            reason: "relevant symbol"
          }
        );
      }
    }

    // --------------------------------------------------------
    // File-name relevance
    // --------------------------------------------------------

    for (
      const file of index.files.values()
    ) {

      const lower =
        file.file.path.toLowerCase();

      let score = 0;
      let matches = 0;

      for (const term of questionTerms) {

        if (lower.includes(term)) {

          score += 8;
          matches++;
        }
      }

      if (score === 0) {
        continue;
      }

      const existing =
        resultMap.get(
          file.file.path
        );

      if (existing) {

        existing.score += score;
        existing.matches += matches;

        existing.reason +=
          "; relevant filename";

      } else {

        resultMap.set(
          file.file.path,
          {
            path: file.file.path,
            score,
            matches,
            reason: "relevant filename"
          }
        );
      }
    }

    // --------------------------------------------------------
    // ProjectModel relevance
    // --------------------------------------------------------

    if (projectModel) {

      this.applyModuleRelevance(
        questionTerms,
        projectModel,
        resultMap
      );

      this.applyFrameworkRelevance(
        questionTerms,
        projectModel,
        resultMap
      );

      this.applyDependencyRelevance(
        questionTerms,
        projectModel,
        resultMap
      );

      this.applyEntryPointRelevance(
        questionTerms,
        projectModel,
        resultMap
      );

      this.applyFileTypeRelevance(
        questionTerms,
        projectModel,
        resultMap
      );
    }

    return Array.from(
      resultMap.values()
    ).sort(
      (a, b) =>
        b.score - a.score
    );
  }

  // ----------------------------------------------------------
  // Question term extraction
  // ----------------------------------------------------------

  private extractTerms(
    question: string
  ): string[] {

    const stopWords =
      new Set([
        "a",
        "an",
        "the",
        "is",
        "are",
        "was",
        "were",
        "where",
        "what",
        "which",
        "who",
        "how",
        "why",
        "when",
        "does",
        "do",
        "did",
        "this",
        "that",
        "these",
        "those",
        "in",
        "on",
        "at",
        "to",
        "of",
        "for",
        "from",
        "with",
        "and",
        "or",
        "my",
        "me",
        "it",
        "be",
        "handled",
        "handle"
      ]);

    return question
      .toLowerCase()
      .replace(
        /[^a-z0-9_./-]+/g,
        " "
      )
      .split(/\s+/)
      .filter(
        term =>
          term.length >= 2 &&
          !stopWords.has(term)
      );
  }

  // ----------------------------------------------------------
  // Module relevance
  // ----------------------------------------------------------

  private applyModuleRelevance(
    questionTerms: string[],
    projectModel: ProjectModel,
    resultMap: Map<string, SearchResult>
  ): void {

    for (
      const module of projectModel.modules
    ) {

      const moduleName =
        module.name.toLowerCase();

      const modulePath =
        module.path.toLowerCase();

      const matched =
        questionTerms.some(
          term =>
            moduleName.includes(term) ||
            modulePath.includes(term)
        );

      if (!matched) {
        continue;
      }

      for (
        const filePath of module.files
      ) {

        this.addScore(
          resultMap,
          filePath,
          12,
          "relevant module"
        );
      }
    }
  }

  // ----------------------------------------------------------
  // Framework relevance
  // ----------------------------------------------------------

  private applyFrameworkRelevance(
    questionTerms: string[],
    projectModel: ProjectModel,
    resultMap: Map<string, SearchResult>
  ): void {

    const frameworks =
      projectModel.frameworks.map(
        framework =>
          framework.toLowerCase()
      );

    for (
      const framework of frameworks
    ) {

      const frameworkTerms =
        this.frameworkTerms(
          framework
        );

      const questionMatches =
        frameworkTerms.some(
          frameworkTerm =>
            questionTerms.includes(
              frameworkTerm
            )
        );

      if (!questionMatches) {
        continue;
      }

      for (
        const file of projectModel.files
      ) {

        if (
          file.language &&
          this.isLikelyFrameworkFile(
            file.path,
            framework
          )
        ) {

          this.addScore(
            resultMap,
            file.path,
            10,
            "framework relevance"
          );
        }
      }
    }
  }

  // ----------------------------------------------------------
  // Dependency relevance
  // ----------------------------------------------------------

  private applyDependencyRelevance(
    questionTerms: string[],
    projectModel: ProjectModel,
    resultMap: Map<string, SearchResult>
  ): void {

    for (
      const dependency of projectModel.dependencies
    ) {

      const target =
        dependency.target.toLowerCase();

      const name =
        dependency.name.toLowerCase();

      const matched =
        questionTerms.some(
          term =>
            target.includes(term) ||
            name.includes(term)
        );

      if (!matched) {
        continue;
      }

      this.addScore(
        resultMap,
        dependency.source,
        10,
        "relevant dependency"
      );
    }
  }

  // ----------------------------------------------------------
  // Entry point relevance
  // ----------------------------------------------------------

  private applyEntryPointRelevance(
    questionTerms: string[],
    projectModel: ProjectModel,
    resultMap: Map<string, SearchResult>
  ): void {

    const entryPointTerms =
      [
        "main",
        "start",
        "startup",
        "server",
        "entry",
        "entrypoint",
        "run",
        "application",
        "cli"
      ];

    const questionMatches =
      questionTerms.some(
        term =>
          entryPointTerms.includes(term)
      );

    if (!questionMatches) {
      return;
    }

    for (
      const entryPoint of
      projectModel.entryPoints
    ) {

      this.addScore(
        resultMap,
        entryPoint.filePath,
        20,
        "entry point relevance"
      );
    }
  }

  // ----------------------------------------------------------
  // Config / test awareness
  // ----------------------------------------------------------

  private applyFileTypeRelevance(
    questionTerms: string[],
    projectModel: ProjectModel,
    resultMap: Map<string, SearchResult>
  ): void {

    const configTerms =
      [
        "config",
        "configuration",
        "environment",
        "env",
        "database",
        "db"
      ];

    const testTerms =
      [
        "test",
        "testing",
        "tests"
      ];

    const wantsConfig =
      questionTerms.some(
        term =>
          configTerms.includes(term)
      );

    const wantsTests =
      questionTerms.some(
        term =>
          testTerms.includes(term)
      );

    for (
      const file of projectModel.files
    ) {

      if (
        file.isConfig &&
        wantsConfig
      ) {

        this.addScore(
          resultMap,
          file.path,
          15,
          "configuration relevance"
        );
      }

      if (
        file.isTest &&
        wantsTests
      ) {

        this.addScore(
          resultMap,
          file.path,
          15,
          "test relevance"
        );
      }

      // Don't prioritize tests for normal questions.
      if (
        file.isTest &&
        !wantsTests
      ) {

        this.addScore(
          resultMap,
          file.path,
          -3,
          "test penalty"
        );
      }
    }
  }

  // ----------------------------------------------------------
  // Framework keywords
  // ----------------------------------------------------------

  private frameworkTerms(
    framework: string
  ): string[] {

    if (framework.includes("gin")) {
      return [
        "gin",
        "route",
        "router",
        "middleware",
        "handler",
        "api"
      ];
    }

    if (framework.includes("gorm")) {
      return [
        "gorm",
        "database",
        "db",
        "repository",
        "model",
        "migration"
      ];
    }

    if (framework.includes("express")) {
      return [
        "express",
        "route",
        "router",
        "middleware",
        "handler",
        "api"
      ];
    }

    if (framework.includes("nestjs")) {
      return [
        "nestjs",
        "controller",
        "service",
        "module",
        "guard",
        "middleware"
      ];
    }

    if (framework.includes("angular")) {
      return [
        "angular",
        "component",
        "service",
        "module",
        "directive",
        "guard"
      ];
    }

    return [
      framework
    ];
  }

  // ----------------------------------------------------------
  // Framework file heuristic
  // ----------------------------------------------------------

  private isLikelyFrameworkFile(
    filePath: string,
    framework: string
  ): boolean {

    const path =
      filePath.toLowerCase();

    if (framework.includes("gin")) {

      return (
        path.includes("route") ||
        path.includes("router") ||
        path.includes("handler") ||
        path.includes("middleware") ||
        path.includes("controller") ||
        path.endsWith("main.go")
      );
    }

    if (framework.includes("gorm")) {

      return (
        path.includes("model") ||
        path.includes("repository") ||
        path.includes("database") ||
        path.includes("db") ||
        path.includes("migration")
      );
    }

    if (framework.includes("express")) {

      return (
        path.includes("route") ||
        path.includes("router") ||
        path.includes("middleware") ||
        path.includes("controller") ||
        path.includes("server")
      );
    }

    if (framework.includes("nestjs")) {

      return (
        path.includes("controller") ||
        path.includes("service") ||
        path.includes("module") ||
        path.includes("guard") ||
        path.includes("middleware")
      );
    }

    return false;
  }

  // ----------------------------------------------------------
  // Score helper
  // ----------------------------------------------------------

  private addScore(
    resultMap: Map<string, SearchResult>,
    filePath: string,
    score: number,
    reason: string
  ): void {

    const existing =
      resultMap.get(filePath);

    if (existing) {

      existing.score += score;

      existing.reason +=
        `; ${reason}`;

      return;
    }

    resultMap.set(
      filePath,
      {
        path: filePath,
        score,
        matches: 0,
        reason
      }
    );
  }
}