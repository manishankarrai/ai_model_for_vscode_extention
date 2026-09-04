import * as vscode from "vscode";

import { ProjectModel } from "../project/project-model";

export type ProjectMemoryEntryType =
  | "architecture"
  | "finding"
  | "dependency"
  | "convention"
  | "decision";

export interface ProjectMemoryEntry {
  id: string;
  type: ProjectMemoryEntryType;
  content: string;
  source?: string;
  createdAt: number;
}

export interface ProjectMemorySnapshot {
  rootPath: string;
  projectSummary: string;
  languages: string[];
  frameworks: string[];
  files: string[];
  findings: string[];
  dependencies: string[];
  conventions: string[];
  architectureNotes: string[];
  decisions: string[];
  updatedAt: number;
}

interface ProjectMemoryData {
  rootPath: string;
  projectSummary: string;
  languages: string[];
  frameworks: string[];
  files: string[];
  findings: string[];
  dependencies: string[];
  conventions: string[];
  architectureNotes: string[];
  decisions: string[];
  updatedAt: number;
}

export class ProjectMemory {
  private readonly key = "m3.project.memory.v1";

  private memory: ProjectMemoryData;

  constructor(
    private readonly storage: vscode.Memento
  ) {
    const saved = this.storage.get<ProjectMemoryData>(this.key, {
      rootPath: "",
      projectSummary: "",
      languages: [],
      frameworks: [],
      files: [],
      findings: [],
      dependencies: [],
      conventions: [],
      architectureNotes: [],
      decisions: [],
      updatedAt: Date.now()
    });

    this.memory = saved;
  }

  initializeFromProjectModel(
    model: ProjectModel | undefined
  ): void {
    if (!model) {
      return;
    }

    this.memory = {
      rootPath: model.rootPath,
      projectSummary: this.buildProjectSummary(model),
      languages: [...new Set(model.languages)],
      frameworks: [...new Set(model.frameworks)],
      files: model.files.map((file) => file.path),
      findings: [...this.memory.findings],
      dependencies: [...this.memory.dependencies],
      conventions: [...this.memory.conventions],
      architectureNotes: this.memory.architectureNotes.length > 0
        ? [...this.memory.architectureNotes]
        : this.buildArchitectureNotes(model),
      decisions: [...this.memory.decisions],
      updatedAt: Date.now()
    };
  }

  async save(): Promise<void> {
    await this.storage.update(this.key, this.memory);
  }

  recordFinding(
    finding: string,
    source?: string
  ): void {
    const next = this.normalizeEntry(finding);

    if (!next) {
      return;
    }

    this.memory.findings = this.addUniqueValue(
      this.memory.findings,
      next
    );

    if (source) {
      this.memory.architectureNotes = this.addUniqueValue(
        this.memory.architectureNotes,
        `Source: ${source}`
      );
    }

    this.touch();
  }

  recordArchitectureNote(
    note: string,
    source?: string
  ): void {
    const next = this.normalizeEntry(note);

    if (!next) {
      return;
    }

    this.memory.architectureNotes = this.addUniqueValue(
      this.memory.architectureNotes,
      source
        ? `${source}: ${next}`
        : next
    );

    this.touch();
  }

  recordDecision(
    decision: string
  ): void {
    const next = this.normalizeEntry(decision);

    if (!next) {
      return;
    }

    this.memory.decisions = this.addUniqueValue(
      this.memory.decisions,
      next
    );

    this.touch();
  }

  addImportantDependency(
    dependency: string
  ): void {
    const next = this.normalizeEntry(dependency);

    if (!next) {
      return;
    }

    this.memory.dependencies = this.addUniqueValue(
      this.memory.dependencies,
      next
    );

    this.touch();
  }

  addProjectConvention(
    convention: string
  ): void {
    const next = this.normalizeEntry(convention);

    if (!next) {
      return;
    }

    this.memory.conventions = this.addUniqueValue(
      this.memory.conventions,
      next
    );

    this.touch();
  }

  addInvestigationArtifacts(
    artifacts: {
      findings?: string[];
      dependencies?: string[];
      conventions?: string[];
      architectureNotes?: string[];
      decisions?: string[];
    }
  ): void {
    for (const finding of artifacts.findings ?? []) {
      this.recordFinding(finding);
    }

    for (const dependency of artifacts.dependencies ?? []) {
      this.addImportantDependency(dependency);
    }

    for (const convention of artifacts.conventions ?? []) {
      this.addProjectConvention(convention);
    }

    for (const note of artifacts.architectureNotes ?? []) {
      this.recordArchitectureNote(note);
    }

    for (const decision of artifacts.decisions ?? []) {
      this.recordDecision(decision);
    }
  }

  getSnapshot(): ProjectMemorySnapshot {
    return {
      rootPath: this.memory.rootPath,
      projectSummary: this.memory.projectSummary,
      languages: [...this.memory.languages],
      frameworks: [...this.memory.frameworks],
      files: [...this.memory.files],
      findings: [...this.memory.findings],
      dependencies: [...this.memory.dependencies],
      conventions: [...this.memory.conventions],
      architectureNotes: [...this.memory.architectureNotes],
      decisions: [...this.memory.decisions],
      updatedAt: this.memory.updatedAt
    };
  }

  getContextForAI(): string {
    const snapshot = this.getSnapshot();

    return [
      snapshot.projectSummary,
      snapshot.architectureNotes.length > 0
        ? `Architecture notes: ${snapshot.architectureNotes.join("; ")}`
        : "Architecture notes: none",
      snapshot.findings.length > 0
        ? `Findings: ${snapshot.findings.join("; ")}`
        : "Findings: none",
      snapshot.dependencies.length > 0
        ? `Important dependencies: ${snapshot.dependencies.join(", ")}`
        : "Important dependencies: none",
      snapshot.conventions.length > 0
        ? `Conventions: ${snapshot.conventions.join("; ")}`
        : "Conventions: none"
    ].join("\n");
  }

  async clear(): Promise<void> {
    this.memory = {
      rootPath: "",
      projectSummary: "",
      languages: [],
      frameworks: [],
      files: [],
      findings: [],
      dependencies: [],
      conventions: [],
      architectureNotes: [],
      decisions: [],
      updatedAt: Date.now()
    };

    await this.storage.update(this.key, undefined);
  }

  private buildProjectSummary(
    model: ProjectModel
  ): string {
    const languageSummary =
      model.languages.length > 0
        ? model.languages.join(", ")
        : "Unknown";

    const frameworkSummary =
      model.frameworks.length > 0
        ? model.frameworks.join(", ")
        : "None detected";

    return [
      `Project root: ${model.rootPath}`,
      `Languages: ${languageSummary}`,
      `Frameworks: ${frameworkSummary}`,
      `Files: ${model.files.length}`,
      `Entry points: ${model.entryPoints.length}`,
      `Modules: ${model.modules.length}`,
      `Tests: ${model.testFiles.length}`
    ].join(" | ");
  }

  private buildArchitectureNotes(
    model: ProjectModel
  ): string[] {
    const notes: string[] = [];

    if (model.frameworks.length > 0) {
      notes.push(
        `Detected frameworks: ${model.frameworks.join(", ")}`
      );
    }

    if (model.entryPoints.length > 0) {
      notes.push(
        `Entry points: ${model.entryPoints.map((entry) => entry.filePath).join(", ")}`
      );
    }

    if (model.modules.length > 0) {
      notes.push(
        `Modules: ${model.modules.map((module) => module.name).join(", ")}`
      );
    }

    if (model.configFiles.length > 0) {
      notes.push(
        `Config files: ${model.configFiles.join(", ")}`
      );
    }

    return notes;
  }

  private normalizeEntry(
    value: string
  ): string | undefined {
    const trimmed = value.trim();

    if (!trimmed) {
      return undefined;
    }

    return trimmed.slice(0, 500);
  }

  private addUniqueValue(
    list: string[],
    value: string
  ): string[] {
    const next = [...list];

    if (!next.includes(value)) {
      next.push(value);
    }

    return next.slice(-50);
  }

  private touch(): void {
    this.memory.updatedAt = Date.now();
  }
}
