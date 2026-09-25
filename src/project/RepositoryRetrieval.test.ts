import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import { LocalSemanticIndex, type SemanticDocument } from "./LocalSemanticIndex.ts";
import { RepositoryRetrieval } from "./RepositoryRetrieval.ts";

class MemoryStorage {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  update(key: string, value: unknown): void {
    this.values.set(key, value);
  }
}

class CountingSemanticIndex extends LocalSemanticIndex {
  upsertCount = 0;

  override upsert(document: SemanticDocument): void {
    this.upsertCount += 1;
    super.upsert(document);
  }
}

test("RepositoryRetrieval reads ranges, symbols, summaries, and relationships", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm3-retrieval-"));
  try {
    await fs.writeFile(path.join(workspace, "service.ts"), [
      "export class Service {",
      "  create() {",
      "    return helper();",
      "  }",
      "}",
      "function helper() {",
      "  return 1;",
      "}"
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(workspace, "service.test.ts"), [
      "import { Service } from './service';",
      "test('creates a service', () => {",
      "  new Service().create();",
      "});"
    ].join("\n"), "utf8");

    const retrieval = new RepositoryRetrieval();
    const range = await retrieval.readFileRange(workspace, "service.ts", 2, 4);
    assert.match(range.output, /lines=2-4/);
    assert.match(range.output, /return helper/);

    const symbol = await retrieval.readSymbol(workspace, "Service.create");
    assert.equal(symbol.success, true);
    assert.match(symbol.output, /kind=method/);
    assert.match(symbol.output, /parser=TypeScriptSymbolParser/);
    assert.match(symbol.output, /lines=2-4/);

    const fileSummary = await retrieval.getFileSummary(workspace, "service.ts");
    assert.match(fileSummary.output, /Service.create:method:2-4/);
    assert.match(fileSummary.output, /parser=TypeScriptSymbolParser/);

    const definition = await retrieval.findDefinition(workspace, "helper");
    assert.match(definition.output, /helper kind=function/);
    const callers = await retrieval.findCallers(workspace, "helper");
    assert.match(callers.output, /call Service.create -> helper/);
    assert.match(callers.output, /provenance=symbol-call/);
    assert.match(callers.output, /confidence=0\.90/);
    const callees = await retrieval.findCallees(workspace, "Service.create");
    assert.match(callees.output, /call Service.create -> helper/);
    const tests = await retrieval.findTests(workspace, "Service.create");
    assert.match(tests.output, /test test -> Service\.create source=service\.test\.ts/);
    assert.match(tests.output, /provenance=test-reference/);

    const projectSummary = await retrieval.getProjectSummary(workspace);
    assert.match(projectSummary.output, /indexVersion=1/);
    assert.match(projectSummary.output, /symbols=4/);
    const semanticResults = await retrieval.search(workspace, "helper", 10);
    assert.ok(semanticResults.some((result) => result.path === "service.ts"));
    assert.ok(semanticResults.some((result) => (result.semanticScore ?? 0) > 0));
    const selectedResults = await retrieval.search(workspace, "helper", 10, ["service.ts"]);
    assert.ok(selectedResults.some((result) => (result.selectionScore ?? 0) > 0));
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("RepositoryRetrieval records import edges with provenance", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm3-retrieval-imports-"));
  try {
    await fs.writeFile(path.join(workspace, "service.ts"), [
      "import { helper } from './helper';",
      "export function run() {",
      "  return helper();",
      "}"
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(workspace, "helper.ts"), "export function helper() { return 1; }\n", "utf8");
    await fs.writeFile(path.join(workspace, "tsconfig.json"), JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } }
    }), "utf8");
    await fs.mkdir(path.join(workspace, "src"));
    await fs.writeFile(path.join(workspace, "src", "helper.ts"), "export function aliasedHelper() { return 1; }\n", "utf8");
    await fs.writeFile(path.join(workspace, "alias.ts"), "import { aliasedHelper } from '@/helper';\nexport function runAlias() { return aliasedHelper(); }\n", "utf8");
    await fs.writeFile(path.join(workspace, "go.mod"), "module example.com/acme\n\ngo 1.22\n\nrequire github.com/acme/log v1.2.3\n\nreplace example.com/dep => ./vendor/dep\n", "utf8");
    await fs.mkdir(path.join(workspace, "helper"));
    await fs.writeFile(path.join(workspace, "helper", "helper.go"), "package helper\n\nfunc Help() {}\n", "utf8");
    await fs.writeFile(path.join(workspace, "worker.go"), [
      "package worker",
      "",
      "import (",
      "  \"example.com/acme/helper\"",
      "  \"github.com/acme/log\"",
      ")",
      "",
      "func Run() {}"
    ].join("\n"), "utf8");
    await fs.mkdir(path.join(workspace, "vendor", "dep", "sub"), { recursive: true });
    await fs.writeFile(path.join(workspace, "vendor", "dep", "sub", "dep.go"), "package sub\n", "utf8");
    await fs.writeFile(path.join(workspace, "replacement.go"), "package replacement\n\nimport \"example.com/dep/sub\"\n", "utf8");
    await fs.writeFile(path.join(workspace, "routes.go"), [
      "package worker",
      "",
      "func register(router Router) {",
      "  api := router.Group(\"/api/v1\")",
      "  api.POST(\"/users\", createUser)",
      "  router.GET(\"/health\", health)",
      "}"
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(workspace, "storage.ts"), [
      "import fs from 'node:fs';",
      "export function loadConfig() {",
      "  return fs.readFileSync('./config.json', 'utf8');",
      "}",
      "export function saveConfig(value: string) {",
      "  fs.writeFileSync('./config.json', value);",
      "}"
    ].join("\n"), "utf8");
    await fs.mkdir(path.join(workspace, "pkg"), { recursive: true });
    await fs.writeFile(path.join(workspace, "pkg", "consumer.py"), "from .helpers import helper\n\ndef run():\n    return helper()\n", "utf8");
    await fs.writeFile(path.join(workspace, "pkg", "helpers.py"), "def helper():\n    return 1\n", "utf8");
    await fs.writeFile(path.join(workspace, "pyproject.toml"), "[tool.setuptools]\npackage-dir = {\"\" = \"python_src\"}\n", "utf8");
    await fs.mkdir(path.join(workspace, "python_src"), { recursive: true });
    await fs.writeFile(path.join(workspace, "python_src", "configured.py"), "def configured():\n    return 1\n", "utf8");
    await fs.writeFile(path.join(workspace, "configured_consumer.py"), "import configured\nimport requests\n", "utf8");
    await fs.writeFile(path.join(workspace, "pyproject.toml"), "[project]\ndependencies = [\"requests>=2.31\"]\n\n[tool.setuptools]\npackage-dir = {\"\" = \"python_src\"}\n", "utf8");
    await fs.mkdir(path.join(workspace, "com", "acme"), { recursive: true });
    await fs.writeFile(path.join(workspace, "Consumer.java"), "import com.acme.Helper;\nclass Consumer {}\n", "utf8");
    await fs.writeFile(path.join(workspace, "com", "acme", "Helper.java"), "package com.acme;\npublic class Helper {}\n", "utf8");
    await fs.writeFile(path.join(workspace, "consumer.rs"), "mod utils;\nuse crate::utils;\nuse serde::Serialize;\nfn run() {}\n", "utf8");
    await fs.writeFile(path.join(workspace, "Cargo.toml"), "[package]\nname = \"sample\"\n\n[dependencies]\nserde = \"1.0\"\n\n[lib]\npath = \"source/lib.rs\"\n", "utf8");
    await fs.mkdir(path.join(workspace, "source"), { recursive: true });
    await fs.writeFile(path.join(workspace, "source", "utils.rs"), "pub fn help() {}\n", "utf8");
    await fs.writeFile(path.join(workspace, "external.ts"), "import external from 'external-lib';\nexport const value = external;\n", "utf8");
    await fs.writeFile(path.join(workspace, "package.json"), JSON.stringify({ dependencies: { "external-lib": "1.0.0" } }), "utf8");
    await fs.mkdir(path.join(workspace, "packages", "shared"), { recursive: true });
    await fs.writeFile(path.join(workspace, "packages", "shared", "package.json"), JSON.stringify({
      name: "@acme/shared",
      types: "index.d.ts",
      main: "index.js"
    }), "utf8");
    await fs.writeFile(path.join(workspace, "packages", "shared", "index.d.ts"), "export const shared: string;\n", "utf8");
    await fs.writeFile(path.join(workspace, "package-consumer.ts"), "import { shared } from '@acme/shared';\n", "utf8");
    await fs.mkdir(path.join(workspace, "src"), { recursive: true });
    await fs.writeFile(path.join(workspace, "src", "utils.rs"), "pub fn help() {}\n", "utf8");
    await fs.writeFile(path.join(workspace, "Consumer.kt"), "import com.acme.*\nclass Consumer\n", "utf8");
    await fs.writeFile(path.join(workspace, "com", "acme", "Utility.kt"), "package com.acme\nclass Utility\n", "utf8");
    await fs.writeFile(path.join(workspace, "External.java"), "import org.slf4j.Logger;\nclass External {}\n", "utf8");
    await fs.writeFile(path.join(workspace, "pom.xml"), "<project><dependencies><dependency><groupId>org.slf4j</groupId><artifactId>slf4j-api</artifactId><version>2.0.0</version></dependency></dependencies></project>", "utf8");

    const retrieval = new RepositoryRetrieval();
    await retrieval.refresh(workspace);
    const imports = await retrieval.findReferences(workspace, "./helper");
    assert.match(imports.output, /import service\.ts -> \.\/helper/);
    assert.match(imports.output, /resolved=helper\.ts/);
    const resolvedImports = await retrieval.findReferences(workspace, "helper.ts");
    assert.match(resolvedImports.output, /import service\.ts -> \.\/helper/);
    const aliasImports = await retrieval.findReferences(workspace, "@/helper");
    assert.match(aliasImports.output, /import alias\.ts -> @\/helper/);
    assert.match(aliasImports.output, /resolved=src\/helper\.ts/);
    const goImports = await retrieval.findReferences(workspace, "example.com/acme/helper");
    assert.match(goImports.output, /import worker\.go -> example\.com\/acme\/helper/);
    assert.match(goImports.output, /line=4/);
    assert.match(goImports.output, /resolved=helper/);
    assert.match(goImports.output, /provenance=import-declaration/);
    assert.match(goImports.output, /confidence=0\.95/);
    const resolvedGoImports = await retrieval.findReferences(workspace, "helper");
    assert.match(resolvedGoImports.output, /import worker\.go -> example\.com\/acme\/helper/);
    const replacedGoImports = await retrieval.findReferences(workspace, "example.com/dep/sub");
    assert.match(replacedGoImports.output, /resolved=vendor\/dep\/sub/);
    const packageImports = await retrieval.findReferences(workspace, "@acme/shared");
    assert.match(packageImports.output, /resolved=packages\/shared\/index\.d\.ts/);
    const pythonImports = await retrieval.findReferences(workspace, "helpers");
    assert.match(pythonImports.output, /import pkg\/consumer\.py -> \.helpers/);
    assert.match(pythonImports.output, /resolved=pkg\/helpers\.py/);
    const configuredPythonImports = await retrieval.findReferences(workspace, "configured");
    assert.match(configuredPythonImports.output, /resolved=python_src\/configured\.py/);
    const javaImports = await retrieval.findReferences(workspace, "com.acme.Helper");
    assert.match(javaImports.output, /import Consumer\.java -> com\.acme\.Helper/);
    assert.match(javaImports.output, /resolved=com\/acme\/Helper\.java/);
    const rustImports = await retrieval.findReferences(workspace, "crate::utils");
    assert.match(rustImports.output, /import consumer\.rs -> crate::utils/);
    assert.match(rustImports.output, /resolved=source\/utils\.rs/);
    const externalImports = await retrieval.findReferences(workspace, "external-lib");
    assert.match(externalImports.output, /provenance=external-import/);
    assert.match(externalImports.output, /confidence=0\.70/);
    assert.match(externalImports.output, /dependency=dependency/);
    assert.match(externalImports.output, /manager=npm/);
    assert.match(externalImports.output, /package=external-lib/);
    assert.match(externalImports.output, /version=1\.0\.0/);
    const goExternal = await retrieval.findReferences(workspace, "github.com/acme/log");
    assert.match(goExternal.output, /dependency=dependency manager=go package=github\.com\/acme\/log version=v1\.2\.3/);
    const pythonExternal = await retrieval.findReferences(workspace, "requests");
    assert.match(pythonExternal.output, /dependency=dependency manager=python package=requests/);
    const cargoExternal = await retrieval.findReferences(workspace, "serde::Serialize");
    assert.match(cargoExternal.output, /dependency=dependency manager=cargo package=serde version=1\.0/);
    const jvmExternal = await retrieval.findReferences(workspace, "org.slf4j.Logger");
    assert.match(jvmExternal.output, /dependency=dependency manager=jvm package=org\.slf4j:slf4j-api version=2\.0\.0/);
    const builtinImport = await retrieval.findReferences(workspace, "node:fs");
    assert.match(builtinImport.output, /dependency=builtin manager=npm package=fs/);
    const kotlinImports = await retrieval.findReferences(workspace, "com.acme.*");
    assert.match(kotlinImports.output, /import Consumer\.kt -> com\.acme\.\*/);
    assert.match(kotlinImports.output, /resolved=com\/acme/);
    const routes = await retrieval.findRoutes(workspace, "/api/v1/users");
    assert.match(routes.output, /route routes\.go -> POST \/api\/v1\/users/);
    assert.match(routes.output, /provenance=route-registration/);
    const reads = await retrieval.findReads(workspace, "./config.json");
    assert.match(reads.output, /read loadConfig -> \.\/config\.json/);
    assert.match(reads.output, /provenance=data-access/);
    const writes = await retrieval.findWrites(workspace, "./config.json");
    assert.match(writes.output, /write saveConfig -> \.\/config\.json/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("RepositoryRetrieval rejects unsafe paths", async () => {
  const retrieval = new RepositoryRetrieval();
  await assert.rejects(
    retrieval.readFileRange("/tmp", "../secret.txt"),
    /Unsafe repository path/
  );
});

test("RepositoryRetrieval restores persisted symbols for an unchanged index", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm3-retrieval-persisted-"));
  try {
    await fs.writeFile(path.join(workspace, "service.py"), [
      "class Service:",
      "    def create(self):",
      "        return helper()",
      "",
      "def helper():",
      "    return 1"
    ].join("\n"), "utf8");
    const storage = new MemoryStorage();
    const first = new RepositoryRetrieval(storage);
    await first.refresh(workspace);

    const restored = new RepositoryRetrieval(storage);
    const snapshot = await restored.refresh(workspace);
    assert.equal(snapshot.changedPaths.length, 0);
    const symbol = await restored.readSymbol(workspace, "Service.create");
    assert.equal(symbol.success, true);
    assert.match(symbol.output, /kind=method/);
    const callers = await restored.findCallers(workspace, "helper");
    assert.match(callers.output, /call Service\.create -> helper/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("RepositoryRetrieval incrementally updates and removes semantic chunks", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm3-retrieval-semantic-lifecycle-"));
  try {
    const filePath = path.join(workspace, "service.ts");
    await fs.writeFile(filePath, "export function loadProjectConfig() { return true; }\n", "utf8");
    const semanticIndex = new CountingSemanticIndex();
    const retrieval = new RepositoryRetrieval(undefined, semanticIndex);

    await retrieval.refresh(workspace);
    const initialUpserts = semanticIndex.upsertCount;
    await retrieval.refresh(workspace);
    assert.equal(semanticIndex.upsertCount, initialUpserts);
    assert.equal((await retrieval.search(workspace, "project config")).some((item) => item.path === "service.ts"), true);

    await fs.writeFile(filePath, "export function saveBillingRecord() { return true; }\n", "utf8");
    retrieval.invalidatePath(filePath);
    await retrieval.refresh(workspace);
    assert.equal((await retrieval.search(workspace, "project config")).length, 0);
    const changedResults = await retrieval.search(workspace, "billing record");
    assert.equal(changedResults.some((item) => item.path === "service.ts"), true);
    assert.ok(changedResults.some((item) => (item.recencyScore ?? 0) > 0));

    await fs.rm(filePath);
    retrieval.invalidatePath(filePath);
    await retrieval.refresh(workspace);
    assert.equal((await retrieval.search(workspace, "billing record")).length, 0);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("RepositoryRetrieval creates bounded semantic chunks for unparsed files", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm3-retrieval-file-chunks-"));
  try {
    const lines = Array.from({ length: 95 }, (_, index) => `setting_${index}: value_${index}`);
    lines[90] = "target_configuration: strict";
    await fs.writeFile(path.join(workspace, "settings.yaml"), lines.join("\n"), "utf8");

    const retrieval = new RepositoryRetrieval();
    const results = await retrieval.search(workspace, "target configuration", 10);
    assert.equal(results[0]?.path, "settings.yaml");
    assert.equal(results[0]?.startLine, 81);
    assert.equal(results[0]?.endLine, 95);
    assert.match(results[0]?.snippet ?? "", /target_configuration/);
    assert.ok(retrieval.lastSearchTiming.totalMs >= 0);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("RepositoryRetrieval caches searches by index version and invalidates after changes", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm3-retrieval-search-cache-"));
  try {
    const filePath = path.join(workspace, "service.ts");
    await fs.writeFile(filePath, "export function loadConfig() { return true; }\n", "utf8");
    const retrieval = new RepositoryRetrieval();

    await retrieval.search(workspace, "config", 10);
    assert.equal(retrieval.lastSearchTiming.cacheHit, false);
    await retrieval.search(workspace, "config", 10);
    assert.equal(retrieval.lastSearchTiming.cacheHit, true);

    await fs.writeFile(filePath, "export function saveBilling() { return true; }\n", "utf8");
    retrieval.invalidatePath(filePath);
    await retrieval.search(workspace, "billing", 10);
    assert.equal(retrieval.lastSearchTiming.cacheHit, false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("RepositoryRetrieval restores search results from workspace storage", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm3-retrieval-search-cache-store-"));
  try {
    await fs.writeFile(path.join(workspace, "service.ts"), "export function loadConfig() { return true; }\n", "utf8");
    const storage = new MemoryStorage();
    const first = new RepositoryRetrieval(storage);
    await first.search(workspace, "config", 10);

    const restored = new RepositoryRetrieval(storage);
    await restored.search(workspace, "config", 10);
    assert.equal(restored.lastSearchTiming.cacheHit, true);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("RepositoryRetrieval prefers natural section boundaries for fallback chunks", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm3-retrieval-section-chunks-"));
  try {
    const lines = [
      ...Array.from({ length: 20 }, (_, index) => `intro_${index}: value`),
      "",
      "target_configuration: strict",
      "target_region: us"
    ];
    await fs.writeFile(path.join(workspace, "settings.yaml"), lines.join("\n"), "utf8");

    const retrieval = new RepositoryRetrieval();
    const results = await retrieval.search(workspace, "target configuration", 10);
    assert.equal(results[0]?.startLine, 22);
    assert.equal(results[0]?.endLine, 23);
    assert.match(results[0]?.snippet ?? "", /target_region/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("RepositoryRetrieval uses structural boundaries for unparsed brace languages", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm3-retrieval-structural-chunks-"));
  try {
    await fs.writeFile(path.join(workspace, "styles.css"), [
      "body {",
      "  color: black;",
      "  margin: 0;",
      "}",
      ".panel {",
      "  display: grid;",
      "  gap: 1rem;",
      "  color: blue;",
      "}"
    ].join("\n"), "utf8");

    const retrieval = new RepositoryRetrieval();
    const results = await retrieval.search(workspace, "panel display", 10);
    assert.equal(results[0]?.path, "styles.css");
    assert.equal(results[0]?.startLine, 5);
    assert.equal(results[0]?.endLine, 9);
    assert.match(results[0]?.snippet ?? "", /display: grid/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});