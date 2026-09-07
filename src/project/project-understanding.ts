import { ProjectIndex } from "../models/types";
import { ProjectModel } from "./project-model";
import { ProjectModelBuilder } from "./project-model-builder";

import { flow } from "../utils/flowLog";

export class ProjectUnderstanding {
  private readonly builder =
    new ProjectModelBuilder();

  private model?: ProjectModel;

  initialize(index: ProjectIndex): ProjectModel {
    flow("ProjectUnderstanding.initialize", 1, "enter");
    this.model = this.builder.build(index);

    return this.model;
  }

  getModel(): ProjectModel | undefined {
    flow("ProjectUnderstanding.getModel", 1, "enter");
    return this.model;
  }

  getLanguages(): string[] {
    flow("ProjectUnderstanding.getLanguages", 1, "enter");
    return this.model?.languages ?? [];
  }

  getFrameworks(): string[] {
    flow("ProjectUnderstanding.getFrameworks", 1, "enter");
    return this.model?.frameworks ?? [];
  }

  getEntryPoints() {
    flow("ProjectUnderstanding.getEntryPoints", 1, "enter");
    return this.model?.entryPoints ?? [];
  }

  getModules() {
    flow("ProjectUnderstanding.getModules", 1, "enter");
    return this.model?.modules ?? [];
  }

  getFiles() {
    flow("ProjectUnderstanding.getFiles", 1, "enter");
    return this.model?.files ?? [];
  }

  getTests() {
    flow("ProjectUnderstanding.getTests", 1, "enter");
    return this.model?.testFiles ?? [];
  }

  getConfigFiles() {
    flow("ProjectUnderstanding.getConfigFiles", 1, "enter");
    return this.model?.configFiles ?? [];
  }
}