import { flow } from "../utils/flowLog.ts";
import { adaptiveLimits } from "../config/adaptiveLimits.ts";

export interface ParsedCommand {
  binary: string;
  args: string[];
}

function tokenizeCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;

  for (let index = 0; index < command.length; index++) {
    const character = command[index];

    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === "\\" && quote !== "'") {
      const next = command[index + 1];
      if (next === "\\" || next === '"' || /\s/.test(next ?? "")) {
        escaping = true;
        continue;
      }
    }

    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaping || quote) {
    throw new Error("MM3 rejected a command with an unfinished quote or escape.");
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

export function parseSafeCommand(command: string): ParsedCommand {
  flow("parseSafeCommand", 1, "enter");
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("run_command requires a command.");
  }

  if (trimmed.length > adaptiveLimits.maxCommandChars) {
    throw new Error(`MM3 rejected a command longer than ${adaptiveLimits.maxCommandChars} characters.`);
  }

  if (trimmed.includes("\0")) {
    throw new Error("MM3 rejected a command containing a null byte.");
  }

  const parts = tokenizeCommand(trimmed);
  const binary = parts[0] ?? "";
  const binaryName = binary.replace(/\\/g, "/").split("/").pop() ?? binary;
  if (!/^[a-zA-Z0-9._+:-]+(?:\.exe|\.cmd|\.bat)?$/i.test(binaryName)) {
    throw new Error("MM3 rejected an invalid command executable.");
  }

  if (parts.length - 1 > adaptiveLimits.maxCommandArgs) {
    throw new Error(`MM3 rejected a command with more than ${adaptiveLimits.maxCommandArgs} arguments.`);
  }

  return {
    binary,
    args: parts.slice(1)
  };
}
