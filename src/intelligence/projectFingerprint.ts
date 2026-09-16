import type { ProjectFingerprint, ProjectIndex } from "../models/types";
import { adaptiveLimits } from "../config/adaptiveLimits";

const frameworkHints = [
  "angular", "django", "express", "fastapi", "gin", "nestjs", "next",
  "rails", "react", "spring", "svelte", "vue"
];

function topValues(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function topLevelDirectory(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const separator = normalized.indexOf("/");
  return separator < 0 ? "." : normalized.slice(0, separator);
}

function isTestPath(path: string): boolean {
  return /(^|[\\/])(?:test|tests|__tests__)(?:[\\/]|$)|(?:\.test|\.spec)\./i.test(path);
}

function isConfigPath(path: string): boolean {
  return /(^|[\\/])(?:\.env|config|configs?)(?:[._-]|[\\/]|$)|(?:\.config\.|\.json$|\.ya?ml$|\.toml$)/i.test(path);
}

function isEntryPoint(path: string): boolean {
  return /(^|[\\/])(?:main|index|server|app|cli|cmd)[^\\/]*\.(?:c|cc|cpp|go|java|js|jsx|py|rb|rs|ts|tsx)$/i.test(path);
}

export function buildProjectFingerprint(index: ProjectIndex): ProjectFingerprint {
  const files = [...index.files.values()].map(({ file }) => file);
  const limit = adaptiveLimits.maxFingerprintItems;
  const dependencyNames = index.dependencies
    .map((dependency) => dependency.target.split(/[/:]/)[0].trim().toLowerCase())
    .filter(Boolean);
  const frameworks = frameworkHints.filter((hint) =>
    dependencyNames.some((dependency) => dependency === hint || dependency.includes(hint))
  );

  return {
    file_count: files.length,
    total_bytes: files.reduce((total, file) => total + Math.max(0, file.size), 0),
    symbol_count: index.symbols.length,
    dependency_count: index.dependencies.length,
    test_file_count: files.filter((file) => isTestPath(file.path)).length,
    config_file_count: files.filter((file) => isConfigPath(file.path)).length,
    languages: topValues(files.map((file) => file.language), limit),
    frameworks: frameworks.slice(0, limit),
    top_level_directories: topValues(files.map((file) => topLevelDirectory(file.path)), limit),
    entry_points: files.filter((file) => isEntryPoint(file.path)).map((file) => file.path).slice(0, limit)
  };
}