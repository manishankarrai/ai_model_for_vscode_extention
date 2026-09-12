import { flow } from "../utils/flowLog.ts";

const ALLOWED_BINARIES = new Set([
  "npm",
  "npx",
  "yarn",
  "pnpm",
  "bun",
  "node",
  "go",
  "python",
  "python3",
  "pytest",
  "pip",
  "pip3",
  "cargo",
  "make",
  "cmake",
  "tsc",
  "eslint",
  "vitest",
  "jest",
  "mocha",
  "php",
  "composer",
  "dotnet",
  "mvn",
  "gradle",
  "rustc",
  "git",
  "rg",
  "grep",
  "cat",
  "ls",
  "head",
  "tail",
  "sed",
  "awk"
]);

const BLOCKED_GIT_ARGS = [
  "push --force",
  "push -f",
  "reset --hard",
  "clean -fd",
  "clean -f",
  "filter-branch",
  "rebase --abort"
];

export interface ParsedCommand {
  binary: string;
  args: string[];
}

export function parseSafeCommand(command: string): ParsedCommand {
  flow("parseSafeCommand", 1, "enter");
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("run_command requires a command.");
  }

  if (/[|;&`$<>\n(){}]/.test(trimmed) || trimmed.includes("$(")) {
    throw new Error("MM3 rejected a command that uses shell metacharacters.");
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  const binary = parts[0].replace(/\\/g, "/").split("/").pop() ?? "";
  const normalizedBinary = binary.replace(/\.exe$/i, "").replace(/\.cmd$/i, "");

  if (!ALLOWED_BINARIES.has(normalizedBinary)) {
    throw new Error(
      `MM3 blocked command binary '${binary}'. Use an allowlisted tool such as npm, go, pytest, or git.`
    );
  }

  if (normalizedBinary === "git") {
    const joined = parts.slice(1).join(" ").toLowerCase();
    if (BLOCKED_GIT_ARGS.some((item) => joined.includes(item))) {
      throw new Error("MM3 blocked a destructive git command.");
    }
  }

  return {
    binary: normalizedBinary,
    args: parts.slice(1)
  };
}
