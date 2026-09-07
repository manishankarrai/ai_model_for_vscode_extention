import { ProjectDependency } from "./project-model";

import { flow } from "../utils/flowLog";

export class DependencyDetector {
  detect(): ProjectDependency[] {
    flow("DependencyDetector.detect", 1, "enter");
    return [];
  }
}