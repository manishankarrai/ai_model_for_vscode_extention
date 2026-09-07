import * as path from "path";
import { ProjectModule } from "./project-model";

import { flow } from "../utils/flowLog";

export class ModuleDetector {
  detect(rootPath: string, files: string[]): ProjectModule[] {
    flow("ModuleDetector.detect", 1, "enter");
    const modules = new Map<string, string[]>();

    for (const file of files) {
      const relative = path.relative(rootPath, file);

      const parts = relative.split(path.sep);

      if (parts.length < 2) {
        continue;
      }

      // Use first directory as the initial module.
      const moduleName = parts[0];

      if (!modules.has(moduleName)) {
        modules.set(moduleName, []);
      }

      modules.get(moduleName)!.push(file);
    }

    return [...modules.entries()].map(([name, moduleFiles]) => ({
      name,
      path: path.join(rootPath, name),
      files: moduleFiles,
    }));
  }
}