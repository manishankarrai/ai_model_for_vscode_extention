import { promises as fs } from "node:fs";
import * as path from "node:path";

interface IgnoreRule {
  negated: boolean;
  expression: RegExp;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(value: string): string {
  let expression = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "*" && value[index + 1] === "*") {
      index += 1;
      if (value[index + 1] === "/") {
        index += 1;
        expression += "(?:.*/)?";
      } else {
        expression += ".*";
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += escapeRegExp(character);
    }
  }
  return expression;
}

function createRule(line: string): IgnoreRule | undefined {
  let pattern = line.trim();
  if (!pattern || pattern.startsWith("#")) {
    return undefined;
  }

  if (pattern.startsWith("\\#") || pattern.startsWith("\\!")) {
    pattern = pattern.slice(1);
  }

  let negated = false;
  if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1);
  }

  const anchored = pattern.startsWith("/");
  const directoryOnly = pattern.endsWith("/");
  pattern = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!pattern) {
    return undefined;
  }

  const hasSlash = pattern.includes("/");
  const expression = globToRegExp(pattern);
  const prefix = hasSlash || anchored ? "^" : "^(?:.*/)?";
  const suffix = directoryOnly ? "(?:/.*)?$" : "$";
  return {
    negated,
    expression: new RegExp(`${prefix}${expression}${suffix}`)
  };
}

export class GitignoreRules {
  private readonly rules: IgnoreRule[];

  private constructor(rules: IgnoreRule[]) {
    this.rules = rules;
  }

  static fromText(text: string): GitignoreRules {
    return new GitignoreRules(
      text.split(/\r?\n/).map(createRule).filter((rule): rule is IgnoreRule => rule !== undefined)
    );
  }

  isIgnored(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.expression.test(normalized)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }
}

export async function loadGitignoreRules(workspacePath: string): Promise<GitignoreRules> {
  try {
    const content = await fs.readFile(path.join(workspacePath, ".gitignore"), "utf8");
    return GitignoreRules.fromText(content);
  } catch {
    return GitignoreRules.fromText("");
  }
}