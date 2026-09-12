import { ProjectIndex } from "../models/types";
import { ProjectModel } from "./project-model";
import { ProjectModelBuilder } from "./project-model-builder";
export class ProjectUnderstanding {
    private readonly builder = new ProjectModelBuilder();
    private model?: ProjectModel;
    initialize(index: ProjectIndex): ProjectModel {
        this.model = this.builder.build(index);
        return this.model;
    }
    getModel(): ProjectModel | undefined {
        return this.model;
    }
    getLanguages(): string[] {
        return this.model?.languages ?? [];
    }
    getFrameworks(): string[] {
        return this.model?.frameworks ?? [];
    }
    getEntryPoints() {
        return this.model?.entryPoints ?? [];
    }
    getModules() {
        return this.model?.modules ?? [];
    }
    getFiles() {
        return this.model?.files ?? [];
    }
    getTests() {
        return this.model?.testFiles ?? [];
    }
    getConfigFiles() {
        return this.model?.configFiles ?? [];
    }
}
