import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import { ProjectScanner } from "./ProjectScanner.ts";

class MemoryStorage {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  update(key: string, value: unknown): void {
    this.values.set(key, value);
  }
}

test("ProjectScanner builds a local snapshot and reuses unchanged files", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm3-project-scanner-"));
  try {
    await fs.mkdir(path.join(workspace, "node_modules"));
    await fs.writeFile(path.join(workspace, "main.ts"), "const answer = 42;\n", "utf8");
    await fs.writeFile(path.join(workspace, "README.md"), "# MM3\n", "utf8");
    await fs.writeFile(path.join(workspace, "node_modules", "ignored.ts"), "ignored\n", "utf8");

    const scanner = new ProjectScanner();
    const first = await scanner.scan(workspace);

    assert.equal(first.indexVersion, 1);
    assert.deepEqual(first.changedPaths, ["README.md", "main.ts"]);
    assert.deepEqual(first.removedPaths, []);
    assert.deepEqual(first.files.map((file) => file.path), ["README.md", "main.ts"]);
    assert.equal(first.files.find((file) => file.path === "main.ts")?.language, "TypeScript");
    assert.equal(first.files.find((file) => file.path === "main.ts")?.lines, 1);
    assert.match(first.summary, /Indexed 2 files/);

    const second = await scanner.scan(workspace);
    assert.equal(second.indexVersion, first.indexVersion);
    assert.deepEqual(second.changedPaths, []);
    assert.deepEqual(second.removedPaths, []);
    assert.equal(second.files.find((file) => file.path === "main.ts")?.hash, first.files.find((file) => file.path === "main.ts")?.hash);

    await fs.writeFile(path.join(workspace, "main.ts"), "const answer = 43;\n", "utf8");
    await fs.rm(path.join(workspace, "README.md"));
    const third = await scanner.scan(workspace);

    assert.equal(third.indexVersion, first.indexVersion + 1);
    assert.deepEqual(third.changedPaths, ["main.ts"]);
    assert.deepEqual(third.removedPaths, ["README.md"]);
    assert.notEqual(third.files.find((file) => file.path === "main.ts")?.hash, first.files.find((file) => file.path === "main.ts")?.hash);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("ProjectScanner restores persisted metadata and honors path invalidation", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm3-project-scanner-persisted-"));
  try {
    const filePath = path.join(workspace, "main.ts");
    await fs.writeFile(filePath, "const answer = 42;\n", "utf8");
    const storage = new MemoryStorage();
    const firstScanner = new ProjectScanner(storage);
    const first = await firstScanner.scan(workspace);

    await fs.writeFile(filePath, "const answer = 43;\n", "utf8");
    const restoredScanner = new ProjectScanner(storage);
    const restored = await restoredScanner.scan(workspace);
    assert.equal(restored.indexVersion, first.indexVersion + 1);
    assert.deepEqual(restored.changedPaths, ["main.ts"]);

    const currentHash = restored.files[0]?.hash;
    await fs.writeFile(filePath, "const answer = 44;\n", "utf8");
    const invalidatedScanner = new ProjectScanner(storage);
    invalidatedScanner.invalidatePath(filePath);
    const invalidated = await invalidatedScanner.scan(workspace);
    assert.deepEqual(invalidated.changedPaths, ["main.ts"]);
    assert.notEqual(invalidated.files[0]?.hash, currentHash);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("ProjectScanner updates only the changed path", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm3-project-scanner-incremental-"));
  try {
    const firstPath = path.join(workspace, "first.ts");
    const secondPath = path.join(workspace, "second.ts");
    await fs.writeFile(firstPath, "const first = 1;\n", "utf8");
    await fs.writeFile(secondPath, "const second = 2;\n", "utf8");

    const scanner = new ProjectScanner();
    const initial = await scanner.scan(workspace);
    await fs.writeFile(firstPath, "const first = 3;\n", "utf8");

    const updated = await scanner.updatePath(workspace, firstPath);

    assert.equal(updated.indexVersion, initial.indexVersion + 1);
    assert.deepEqual(updated.changedPaths, ["first.ts"]);
    assert.deepEqual(updated.removedPaths, []);
    assert.equal(updated.files.find((file) => file.path === "second.ts")?.hash, initial.files.find((file) => file.path === "second.ts")?.hash);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});