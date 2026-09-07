import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";

import { flow } from "./flowLog";

export const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".angular",
  "coverage",
  ".idea",
  ".vscode"
]);

export const IGNORED_FILES = new Set([
  ".DS_Store",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "composer.lock",
  "go.sum"
]);

export function isIgnoredPath(filePath: string): boolean {
  flow("isIgnoredPath", 1, "enter");
  const normalized = filePath.split(path.sep);

  for (const part of normalized) {
    if (IGNORED_DIRECTORIES.has(part)) {
      return true;
    }
  }

  return IGNORED_FILES.has(path.basename(filePath));
}

export function getLanguage(filePath: string): string {
  flow("getLanguage", 1, "enter");
  const extension = path.extname(filePath).toLowerCase();

  const languages: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".go": "go",
    ".py": "python",
    ".java": "java",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".rs": "rust",
    ".php": "php",
    ".rb": "ruby",
    ".cs": "csharp",
    ".swift": "swift",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".xml": "xml",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".sql": "sql",
    ".md": "markdown"
  };

  return languages[extension] ?? "plaintext";
}

export async function hashContent(
  content: string
): Promise<string> {
  flow("hashContent", 1, "enter", { bytes: content.length });
  return crypto
    .createHash("sha1")
    .update(content)
    .digest("hex");
}

export async function readTextFile(
  uri: vscode.Uri
): Promise<string> {
  flow("readTextFile", 1, "enter", { path: uri.fsPath });
  const bytes = await vscode.workspace.fs.readFile(uri);

  return Buffer.from(bytes).toString("utf8");
}

export function relativePath(
  root: string,
  filePath: string
): string {
  flow("relativePath", 1, "enter");
  return path.relative(root, filePath);
}

export function normalizePath(filePath: string): string {
  flow("normalizePath", 1, "enter");
  return filePath.split(path.sep).join("/");
}