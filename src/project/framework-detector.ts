import * as fs from "fs";
import * as path from "path";
import { ProjectIndex } from "../models/types";
export class FrameworkDetector {
    detect(index: ProjectIndex): string[] {
        const frameworks = new Set<string>();
        const rootPath = index.rootPath;
        const files = [...index.files.values()].map(({ file }) => file);
        const fileNames = new Set(files.map((file) => path.basename(file.path).toLowerCase()));
        if (fileNames.has("go.mod")) {
            const goModPath = path.join(rootPath, "go.mod");
            if (index.files.has("go.mod") && fs.existsSync(goModPath)) {
                const content = fs.readFileSync(goModPath, "utf8");
                if (content.includes("github.com/gin-gonic/gin")) {
                    frameworks.add("Gin");
                }
                if (content.includes("github.com/gofiber/fiber")) {
                    frameworks.add("Fiber");
                }
                if (content.includes("github.com/labstack/echo")) {
                    frameworks.add("Echo");
                }
                if (content.includes("gorm.io/gorm")) {
                    frameworks.add("GORM");
                }
            }
        }
        if (fileNames.has("package.json")) {
            const packagePath = path.join(rootPath, "package.json");
            if (index.files.has("package.json") && fs.existsSync(packagePath)) {
                try {
                    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
                    const dependencies = {
                        ...(pkg.dependencies || {}),
                        ...(pkg.devDependencies || {}),
                    };
                    if (dependencies["@nestjs/core"]) {
                        frameworks.add("NestJS");
                    }
                    if (dependencies["express"]) {
                        frameworks.add("Express");
                    }
                    if (dependencies["@angular/core"]) {
                        frameworks.add("Angular");
                    }
                    if (dependencies["next"]) {
                        frameworks.add("Next.js");
                    }
                    if (dependencies["react"]) {
                        frameworks.add("React");
                    }
                    if (dependencies["vue"]) {
                        frameworks.add("Vue");
                    }
                }
                catch {
                }
            }
        }
        if (fileNames.has("requirements.txt") ||
            fileNames.has("pyproject.toml")) {
            const requirements = files
                .filter((file) => file.path.endsWith("requirements.txt") ||
                file.path.endsWith("pyproject.toml"))
                .map((file) => {
                try {
                    return fs.readFileSync(file.absolutePath, "utf8");
                }
                catch {
                    return "";
                }
            })
                .join("\n");
            if (requirements.includes("django")) {
                frameworks.add("Django");
            }
            if (requirements.includes("fastapi")) {
                frameworks.add("FastAPI");
            }
            if (requirements.includes("flask")) {
                frameworks.add("Flask");
            }
        }
        return [...frameworks];
    }
}
