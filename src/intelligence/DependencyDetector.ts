import { flow } from "../utils/flowLog.ts";

import type {
  DependencyInfo
} from "../models/types.ts";

export class DependencyDetector {

  detect(
    filePath: string,
    content: string
  ): DependencyInfo[] {
    flow("DependencyDetector.detect", 1, "enter", { filePath });

    const dependencies: DependencyInfo[] = [];

    // --------------------------------------------------------
    // JavaScript / TypeScript imports & exports
    // --------------------------------------------------------

    const importRegex =
      /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

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

    // Dynamic import('...')
    const dynamicImportRegex =
      /import\s*\(\s*["']([^"']+)["']\s*\)/g;

    while (
      (match = dynamicImportRegex.exec(content)) !== null
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

    if (filePath.endsWith(".go")) {

      const goImportBlockRegex = /import\s*\(([\s\S]*?)\)/g;
      const goSingleImportRegex = /import\s+(?:[a-zA-Z0-9_]+\s+)?["']([^"']+)["']/g;
      const stringLiteralRegex = /["']([^"']+)["']/g;

      // Grouped imports: import ( "fmt" "os" )
      while ((match = goImportBlockRegex.exec(content)) !== null) {
        const blockContent = match[1];
        let pathMatch: RegExpExecArray | null;
        while ((pathMatch = stringLiteralRegex.exec(blockContent)) !== null) {
          dependencies.push({
            source: filePath,
            target: pathMatch[1],
            type: "package"
          });
        }
      }

      // Single line imports: import "fmt" or import alias "pkg"
      while ((match = goSingleImportRegex.exec(content)) !== null) {
        dependencies.push({
          source: filePath,
          target: match[1],
          type: "package"
        });
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