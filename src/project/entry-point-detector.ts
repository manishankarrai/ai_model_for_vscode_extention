import * as path from "path";
import { ProjectEntryPoint } from "./project-model";

export class EntryPointDetector {
  detect(files: string[]): ProjectEntryPoint[] {
    const results: ProjectEntryPoint[] = [];

    for (const file of files) {
      const normalized = file.replace(/\\/g, "/");
      const name = path.basename(normalized).toLowerCase();

      // Go
      if (name === "main.go") {
        results.push({
          filePath: file,
          type: "application",
        });

        continue;
      }

      // Node / TypeScript
      if (
        name === "main.ts" ||
        name === "main.js" ||
        name === "server.ts" ||
        name === "server.js"
      ) {
        results.push({
          filePath: file,
          type: "server",
        });

        continue;
      }

      // Python
      if (name === "__main__.py") {
        results.push({
          filePath: file,
          type: "application",
        });

        continue;
      }

      // Java
      if (name.endsWith(".java")) {
        // Actual main() detection should eventually use AST/symbol information.
        if (
          normalized.includes("/src/main/") ||
          normalized.includes("\\src\\main\\")
        ) {
          results.push({
            filePath: file,
            type: "application",
          });
        }
      }
    }

    return results;
  }
}