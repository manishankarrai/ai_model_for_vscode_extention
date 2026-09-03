export interface ProjectFile {
  path: string;
  relativePath: string;
  extension: string;
  absolutePath: string;

  language?: string;

  isTest: boolean;
  isConfig: boolean;

  size: number;
  hash: string;
  modifiedAt: number;
}

export interface ProjectSymbol {
  name: string;
  kind: string;

  filePath: string;

  startLine?: number;
  endLine?: number;
}

export interface ProjectImport {
  sourceFile: string;
  importedPath: string;

  resolvedPath?: string;
  source: string;
  target: string;
  type: "import" | "require";
}

export interface ProjectDependency {
  name: string;
  version?: string;
  type: "runtime" | "development" | "unknown" | "package" | "reference";
  source: string;
  target: string;
}

export interface ProjectEntryPoint {
  filePath: string;
  type: "application" | "server" | "cli" | "test" | "unknown";
}

export interface ProjectModule {
  name: string;
  path: string;

  files: string[];
}

export interface ProjectModel {
  rootPath: string;

  languages: string[];
  frameworks: string[];

  files: ProjectFile[];
  symbols: ProjectSymbol[];
  imports: ProjectImport[];

  dependencies: ProjectDependency[];

  entryPoints: ProjectEntryPoint[];
  modules: ProjectModule[];

  configFiles: string[];
  testFiles: string[];

  createdAt: number;
  updatedAt: number;
}