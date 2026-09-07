import { flow } from "../utils/flowLog";

import {
  DependencyInfo
} from "../models/types";

export class DependencyDetector {

  detect(
    filePath: string,
    content: string
  ): DependencyInfo[] {
    flow("DependencyDetector.detect", 1, "enter", { filePath });

    const dependencies: DependencyInfo[] = [];

    // --------------------------------------------------------
    // JavaScript / TypeScript imports
    // --------------------------------------------------------

    const importRegex =
      /import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

    let match: RegExpExecArray | null;

    while (
      (match = importRegex.exec(content)) !== null
    ) {

      dependencies.push({
        source: filePath,

        target: match[1],

        type: "import"
      });
    }

    // --------------------------------------------------------
    // require()
    // --------------------------------------------------------

    const requireRegex =
      /require\(["']([^"']+)["']\)/g;

    while (
      (match = requireRegex.exec(content)) !== null
    ) {

      dependencies.push({
        source: filePath,

        target: match[1],

        type: "require"
      });
    }

    // --------------------------------------------------------
    // Go imports
    // --------------------------------------------------------

    const goImportRegex =
      /["']([^"']+)["']/g;

    if (filePath.endsWith(".go")) {

      const importSection =
        content.match(
          /import\s*(?:\(([\s\S]*?)\)|["']([^"']+)["'])/
        );

      if (importSection) {

        const section =
          importSection[1] ??
          importSection[2] ??
          "";

        while (
          (match =
            goImportRegex.exec(section)) !== null
        ) {

          dependencies.push({
            source: filePath,

            target: match[1],

            type: "package"
          });
        }
      }
    }

    // --------------------------------------------------------
    // Python imports
    // --------------------------------------------------------

    const pythonImportRegex =
      /(?:from|import)\s+([a-zA-Z0-9_.]+)/g;

    if (filePath.endsWith(".py")) {

      while (
        (match =
          pythonImportRegex.exec(content)) !== null
      ) {

        dependencies.push({
          source: filePath,

          target: match[1],

          type: "import"
        });
      }
    }

    return dependencies;
  }
}