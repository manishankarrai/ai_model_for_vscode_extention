import * as path from "path";
import { ProjectEntryPoint } from "./project-model";
export class EntryPointDetector {
    detect(files: string[]): ProjectEntryPoint[] {
        const results: ProjectEntryPoint[] = [];
        for (const file of files) {
            const normalized = file.replace(/\\/g, "/");
            const name = path.basename(normalized).toLowerCase();
            if (name === "main.go") {
                results.push({
                    filePath: file,
                    type: "application",
                });
                continue;
            }
            if (name === "main.ts" ||
                name === "main.js" ||
                name === "server.ts" ||
                name === "server.js") {
                results.push({
                    filePath: file,
                    type: "server",
                });
                continue;
            }
            if (name === "__main__.py") {
                results.push({
                    filePath: file,
                    type: "application",
                });
                continue;
            }
            if (name.endsWith(".java")) {
                if (normalized.includes("/src/main/") ||
                    normalized.includes("\\src\\main\\")) {
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
