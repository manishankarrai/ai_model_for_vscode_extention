import * as path from "path";

export interface FileClassification {
  language?: string;

  isTest: boolean;
  isConfig: boolean;
}

export class FileClassifier {
  classify(filePath: string): FileClassification {
    const fileName = path.basename(filePath);
    const extension = path.extname(filePath).toLowerCase();

    return {
      language: this.detectLanguage(extension),
      isTest: this.isTestFile(fileName),
      isConfig: this.isConfigFile(fileName),
    };
  }

  private detectLanguage(extension: string): string | undefined {
    const languages: Record<string, string> = {
      ".go": "go",

      ".ts": "typescript",
      ".tsx": "typescript",

      ".js": "javascript",
      ".jsx": "javascript",

      ".py": "python",

      ".java": "java",

      ".rs": "rust",

      ".cpp": "cpp",
      ".cc": "cpp",
      ".cxx": "cpp",

      ".c": "c",

      ".cs": "csharp",

      ".php": "php",

      ".rb": "ruby",

      ".kt": "kotlin",

      ".swift": "swift",

      ".vue": "vue",

      ".html": "html",

      ".css": "css",
      ".scss": "scss",

      ".json": "json",

      ".yaml": "yaml",
      ".yml": "yaml",

      ".xml": "xml",
    };

    return languages[extension];
  }

  private isTestFile(fileName: string): boolean {
    const lower = fileName.toLowerCase();

    return (
      lower.includes(".test.") ||
      lower.includes(".spec.") ||
      lower.includes("_test.") ||
      lower.endsWith("_test.go")
    );
  }

  private isConfigFile(fileName: string): boolean {
    const configFiles = new Set([
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "go.mod",
      "go.sum",
      "cargo.toml",
      "pom.xml",
      "build.gradle",
      "composer.json",
      "requirements.txt",
      "dockerfile",
      "docker-compose.yml",
      "docker-compose.yaml",
      ".env",
      ".env.example",
      "vite.config.ts",
      "vite.config.js",
      "next.config.js",
      "next.config.ts",
      "angular.json",
      "nest-cli.json",
    ]);

    return configFiles.has(fileName.toLowerCase());
  }
}