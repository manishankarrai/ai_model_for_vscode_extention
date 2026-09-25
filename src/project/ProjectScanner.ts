import { createHash } from "node:crypto";
import { promises as fs, createReadStream } from "node:fs";
import * as path from "node:path";

import { GitignoreRules, loadGitignoreRules } from "../utils/gitignore.ts";
import { hasBinaryFileExtension, isProbablyBinary } from "../utils/textFile.ts";

export interface ProjectFileRecord {
  path: string;
  size: number;
  extension: string;
  language: string;
  lines: number;
  modifiedTimeMs: number;
  hash: string;
}

export interface ProjectIndexSnapshot {
  indexVersion: number;
  scannedAt: number;
  files: ProjectFileRecord[];
  changedPaths: string[];
  removedPaths: string[];
  summary: string;
}

export interface ProjectScannerStorage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): unknown;
}

interface FileFingerprint {
  size: number;
  modifiedTimeMs: number;
}

interface CachedFile extends ProjectFileRecord {
  fingerprint: FileFingerprint;
}

interface PersistedProjectIndex {
  indexVersion: number;
  paths?: string[];
  files?: CachedFile[];
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  ".cache",
  ".turbo",
  ".venv",
  "__pycache__",
  "target",
  "tmp",
  "temp",
  "logs"
]);

const MAX_INDEXABLE_FILE_BYTES = 2 * 1024 * 1024;
const FILE_SCAN_CONCURRENCY = 32;

async function forEachConcurrent<T>(
  items: T[],
  concurrency: number,
  callback: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await callback(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker())
  );
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".go": "Go",
  ".py": "Python",
  ".rs": "Rust",
  ".java": "Java",
  ".cs": "CSharp",
  ".php": "PHP",
  ".kt": "Kotlin",
  ".json": "JSON",
  ".md": "Markdown",
  ".css": "CSS",
  ".scss": "SCSS",
  ".html": "HTML",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".sql": "SQL",
  ".sh": "Shell"
};

export class ProjectScanner {
  private readonly storage?: ProjectScannerStorage;
  private workspacePath?: string;
  private indexVersion = 0;
  private readonly cache = new Map<string, CachedFile>();
  private readonly invalidatedPaths = new Set<string>();
  private readonly pendingInvalidations = new Set<string>();
  private restoredWorkspace?: string;

  constructor(storage?: ProjectScannerStorage) {
    this.storage = storage;
  }

  reset(): void {
    this.workspacePath = undefined;
    this.indexVersion = 0;
    this.cache.clear();
    this.invalidatedPaths.clear();
    this.pendingInvalidations.clear();
    this.restoredWorkspace = undefined;
  }

  invalidatePath(filePath: string): void {
    const absolutePath = path.resolve(filePath);
    if (!this.workspacePath) {
      this.pendingInvalidations.add(absolutePath);
      return;
    }

    const relativePath = this.toRelativePath(this.workspacePath, absolutePath);
    if (relativePath && !relativePath.startsWith("../") && relativePath !== "..") {
      this.invalidatedPaths.add(relativePath);
    }
  }

  async scanManifest(workspacePath: string): Promise<ProjectIndexSnapshot> {
    const resolvedWorkspace = path.resolve(workspacePath);
    const gitignore = await loadGitignoreRules(resolvedWorkspace);
    const filePaths = await this.findFiles(resolvedWorkspace, gitignore);
    const files: ProjectFileRecord[] = [];

    await forEachConcurrent(filePaths, FILE_SCAN_CONCURRENCY, async (absolutePath) => {
      const stats = await fs.stat(absolutePath);
      if (stats.size > MAX_INDEXABLE_FILE_BYTES || await this.isBinaryFile(absolutePath)) {
        return;
      }
      const relativePath = this.toRelativePath(resolvedWorkspace, absolutePath);
      files.push({
        path: relativePath,
        size: stats.size,
        extension: path.extname(relativePath).toLowerCase(),
        language: LANGUAGE_BY_EXTENSION[path.extname(relativePath).toLowerCase()] ?? "Other",
        lines: 0,
        modifiedTimeMs: stats.mtimeMs,
        hash: ""
      });
    });

    files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    return {
      indexVersion: this.indexVersion,
      scannedAt: Date.now(),
      files,
      changedPaths: [],
      removedPaths: [],
      summary: [
        `Discovered ${files.length} files.`,
        "Content indexing is deferred until it is needed."
      ].join("\n")
    };
  }

  async scan(workspacePath: string, forceFresh = false): Promise<ProjectIndexSnapshot> {
    const resolvedWorkspace = path.resolve(workspacePath);
    const gitignore = await loadGitignoreRules(resolvedWorkspace);
    if (forceFresh && this.workspacePath === resolvedWorkspace) {
      this.indexVersion = 0;
      this.cache.clear();
      this.restoredWorkspace = undefined;
    }
    if (this.workspacePath !== resolvedWorkspace) {
      this.workspacePath = resolvedWorkspace;
      this.indexVersion = 0;
      this.cache.clear();
      this.restoredWorkspace = undefined;
    }
    if (this.restoredWorkspace !== resolvedWorkspace) {
      if (!forceFresh) {
        await this.restore(resolvedWorkspace);
      }
      this.restoredWorkspace = resolvedWorkspace;
      for (const absolutePath of this.pendingInvalidations) {
        this.invalidatePath(absolutePath);
      }
      this.pendingInvalidations.clear();
    }

    const filePaths = await this.findFiles(resolvedWorkspace, gitignore);
    const nextCache = new Map<string, CachedFile>();
    const changedPaths: string[] = [];

    await forEachConcurrent(filePaths, FILE_SCAN_CONCURRENCY, async (absolutePath) => {
      const relativePath = this.toRelativePath(resolvedWorkspace, absolutePath);
      const stats = await fs.stat(absolutePath);
      if (stats.size > MAX_INDEXABLE_FILE_BYTES || await this.isBinaryFile(absolutePath)) {
        return;
      }
      const previous = this.cache.get(relativePath);
      const fingerprint = {
        size: stats.size,
        modifiedTimeMs: stats.mtimeMs
      };

      if (
        previous &&
        previous.hash &&
        !this.invalidatedPaths.has(relativePath) &&
        previous.fingerprint.size === fingerprint.size &&
        previous.fingerprint.modifiedTimeMs === fingerprint.modifiedTimeMs
      ) {
        nextCache.set(relativePath, { ...previous, fingerprint });
        return;
      }

      nextCache.set(relativePath, {
        ...(await this.readFileRecord(absolutePath, relativePath, stats.size)),
        modifiedTimeMs: stats.mtimeMs,
        fingerprint
      });
      changedPaths.push(relativePath);
    });

    const removedPaths = [...this.cache.keys()]
      .filter((filePath) => !nextCache.has(filePath))
      .sort();
    if (changedPaths.length > 0 || removedPaths.length > 0 || this.indexVersion === 0) {
      this.indexVersion += 1;
    }

    this.cache.clear();
    for (const [filePath, record] of nextCache) {
      this.cache.set(filePath, record);
    }

    this.invalidatedPaths.clear();
    await this.persist(resolvedWorkspace);

    const files = [...this.cache.values()]
      .map(({ fingerprint: _fingerprint, ...record }) => record)
      .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

    return {
      indexVersion: this.indexVersion,
      scannedAt: Date.now(),
      files,
      changedPaths: changedPaths.sort(),
      removedPaths,
      summary: this.buildSummary(files, changedPaths, removedPaths)
    };
  }

  async updatePath(workspacePath: string, filePath: string): Promise<ProjectIndexSnapshot> {
    const resolvedWorkspace = path.resolve(workspacePath);
    const gitignore = await loadGitignoreRules(resolvedWorkspace);
    if (this.workspacePath !== resolvedWorkspace || this.restoredWorkspace !== resolvedWorkspace) {
      return this.scan(resolvedWorkspace);
    }

    const absolutePath = path.resolve(filePath);
    const relativePath = this.toRelativePath(resolvedWorkspace, absolutePath);
    if (!relativePath || relativePath === ".." || relativePath.startsWith("../") || this.isIgnoredPath(relativePath, gitignore)) {
      return this.snapshot([], []);
    }

    const previous = this.cache.get(relativePath);
    const changedPaths: string[] = [];
    const removedPaths: string[] = [];

    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isFile()) {
        return this.snapshot([], []);
      }

      if (stats.size > MAX_INDEXABLE_FILE_BYTES || this.isIgnoredFile(relativePath, gitignore) || await this.isBinaryFile(absolutePath)) {
        return this.snapshot([], []);
      }

      const record = await this.readFileRecord(absolutePath, relativePath, stats.size);
      const nextRecord: CachedFile = {
        ...record,
        modifiedTimeMs: stats.mtimeMs,
        fingerprint: {
          size: stats.size,
          modifiedTimeMs: stats.mtimeMs
        }
      };
      this.cache.set(relativePath, nextRecord);
      if (!previous || previous.hash !== nextRecord.hash) {
        changedPaths.push(relativePath);
        this.indexVersion += 1;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      if (previous) {
        this.cache.delete(relativePath);
        removedPaths.push(relativePath);
        this.indexVersion += 1;
      }
    }

    this.invalidatedPaths.delete(relativePath);
    await this.persistPath(resolvedWorkspace, relativePath);
    return this.snapshot(changedPaths, removedPaths);
  }

  private storageKey(workspacePath: string): string {
    return `mm3.project-index.v1.${createHash("sha256").update(workspacePath).digest("hex")}`;
  }

  private fileStorageKey(workspacePath: string, filePath: string): string {
    return `mm3.project-file.v1.${createHash("sha256").update(`${workspacePath}\0${filePath}`).digest("hex")}`;
  }

  private async restore(workspacePath: string): Promise<void> {
    const persisted = this.storage?.get<PersistedProjectIndex>(this.storageKey(workspacePath));
    if (!persisted || !Number.isInteger(persisted.indexVersion)) {
      return;
    }

    this.indexVersion = persisted.indexVersion;
    const records = Array.isArray(persisted.files)
      ? persisted.files
      : (persisted.paths ?? []).map((filePath) => this.storage?.get<CachedFile>(this.fileStorageKey(workspacePath, filePath)));
    for (const record of records) {
      if (
        record &&
        typeof record.path === "string" &&
        record.fingerprint &&
        typeof record.fingerprint.size === "number" &&
        typeof record.fingerprint.modifiedTimeMs === "number"
      ) {
        this.cache.set(record.path, record);
      }
    }
  }

  private async persist(workspacePath: string): Promise<void> {
    if (!this.storage) {
      return;
    }

    try {
      await this.storage.update(this.storageKey(workspacePath), {
        indexVersion: this.indexVersion,
        paths: [...this.cache.keys()].sort(),
        files: [...this.cache.values()]
      } satisfies PersistedProjectIndex);
    } catch {
      // A cache write must not prevent local retrieval from working.
    }
  }

  private async persistPath(workspacePath: string, filePath: string): Promise<void> {
    if (!this.storage) {
      return;
    }

    try {
      await this.storage.update(
        this.fileStorageKey(workspacePath, filePath),
        this.cache.get(filePath)
      );
      await this.storage.update(this.storageKey(workspacePath), {
        indexVersion: this.indexVersion,
        paths: [...this.cache.keys()].sort(),
        files: [...this.cache.values()]
      } satisfies PersistedProjectIndex);
    } catch {
      // A cache write must not prevent local retrieval from working.
    }
  }

  private async findFiles(root: string, gitignore: GitignoreRules): Promise<string[]> {
    const files: string[] = [];
    const pending = [root];

    while (pending.length > 0) {
      const batch = pending.splice(0, FILE_SCAN_CONCURRENCY);
      const results = await Promise.all(batch.map(async (directory) => ({
        directory,
        entries: await fs.readdir(directory, { withFileTypes: true })
      })));
      for (const { directory, entries } of results) {
        for (const entry of entries) {
          const entryPath = path.join(directory, entry.name);
          const relativePath = this.toRelativePath(root, entryPath);
          if (entry.isDirectory() && !this.isIgnoredPath(relativePath, gitignore)) {
            pending.push(entryPath);
          } else if (entry.isFile() && !this.isIgnoredFile(relativePath, gitignore)) {
            files.push(entryPath);
          }
        }
      }
    }

    return files.sort();
  }

  private isIgnoredPath(relativePath: string, gitignore?: GitignoreRules): boolean {
    return gitignore?.isIgnored(relativePath) === true || relativePath.split("/").some((segment) => IGNORED_DIRECTORIES.has(segment));
  }

  private isIgnoredFile(relativePath: string, gitignore?: GitignoreRules): boolean {
    return this.isIgnoredPath(relativePath, gitignore) || hasBinaryFileExtension(relativePath);
  }

  private async isBinaryFile(absolutePath: string): Promise<boolean> {
    const handle = await fs.open(absolutePath, "r");
    try {
      const sample = Buffer.alloc(8 * 1024);
      const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
      return isProbablyBinary(sample.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }

  private snapshot(changedPaths: string[], removedPaths: string[]): ProjectIndexSnapshot {
    const files = [...this.cache.values()]
      .map(({ fingerprint: _fingerprint, ...record }) => record)
      .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

    return {
      indexVersion: this.indexVersion,
      scannedAt: Date.now(),
      files,
      changedPaths: changedPaths.sort(),
      removedPaths: removedPaths.sort(),
      summary: this.buildSummary(files, changedPaths, removedPaths)
    };
  }

  private async readFileRecord(
    absolutePath: string,
    relativePath: string,
    size: number
  ): Promise<ProjectFileRecord> {
    const hash = createHash("sha256");
    let lines = 0;
    let hasBytes = false;
    let lastByte = 0;

    for await (const chunk of createReadStream(absolutePath)) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(bytes);
      hasBytes = hasBytes || bytes.length > 0;
      for (const byte of bytes) {
        if (byte === 10) {
          lines += 1;
        }
        lastByte = byte;
      }
    }

    return {
      path: relativePath,
      size,
      extension: path.extname(relativePath).toLowerCase(),
      language: LANGUAGE_BY_EXTENSION[path.extname(relativePath).toLowerCase()] ?? "Other",
      lines: hasBytes ? lines + (lastByte === 10 ? 0 : 1) : 0,
      modifiedTimeMs: 0,
      hash: hash.digest("hex")
    };
  }

  private toRelativePath(root: string, absolutePath: string): string {
    return path.relative(root, absolutePath).split(path.sep).join("/");
  }

  private buildSummary(
    files: ProjectFileRecord[],
    changedPaths: string[],
    removedPaths: string[]
  ): string {
    const languageCounts = new Map<string, number>();
    for (const file of files) {
      languageCounts.set(file.language, (languageCounts.get(file.language) ?? 0) + 1);
    }
    const languages = [...languageCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([language, count]) => `${language}=${count}`)
      .join(", ");
    const changes = changedPaths.slice(0, 20);
    const removals = removedPaths.slice(0, 20);

    return [
      `Indexed ${files.length} files.`,
      `Languages: ${languages || "none"}.`,
      `Changed: ${changedPaths.length}; removed: ${removedPaths.length}.`,
      changes.length > 0 ? `Changed paths: ${changes.join(", ")}${changedPaths.length > changes.length ? ", ..." : ""}.` : "",
      removals.length > 0 ? `Removed paths: ${removals.join(", ")}${removedPaths.length > removals.length ? ", ..." : ""}.` : ""
    ].filter(Boolean).join("\n");
  }
}