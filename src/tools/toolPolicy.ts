import type { AgentToolName, InteractionMode, ToolPolicy } from "../models/types.ts";

import { flow } from "../utils/flowLog.ts";

const READ_TOOLS: AgentToolName[] = [
  "read_file",
  "search",
  "list_files",
  "get_diagnostics",
  "git_diff",
  "git_status"
];

/** File mutations are queued for explicit review; shell work also requires approval. */
const FILE_MUTATION_TOOLS: AgentToolName[] = [
  "apply_change_set",
  "apply_patch",
  "create_file",
  "write_file",
  "edit_file",
  "delete_file",
  "rename_file",
  "move_file"
];

const TERMINAL_TOOLS: AgentToolName[] = [
  "run_task",
  "run_command",
  "run_tests"
];

export function availableTools(mode: InteractionMode): AgentToolName[] {
  flow("availableTools", 1, "enter");
  if (mode === "ask") {
    return [];
  }

  return [...READ_TOOLS, ...FILE_MUTATION_TOOLS, ...TERMINAL_TOOLS];
}

export function getToolPolicy(mode: InteractionMode): ToolPolicy {
  flow("getToolPolicy", 1, "enter");
  if (mode === "ask") {
    return {
      allowed: [],
      approval_required: []
    };
  }

  return {
    allowed: availableTools(mode),
    // All allowed tools, including terminal commands, run automatically.
    approval_required: []
  };
}

export function isToolAllowed(
  mode: InteractionMode,
  tool: AgentToolName
): boolean {
  return availableTools(mode).includes(tool);
}

export function requiresApproval(_tool: AgentToolName): boolean {
  flow("requiresApproval", 1, "enter");
  return false;
}

export function isReadOnlyTool(tool: AgentToolName): boolean {
  return READ_TOOLS.includes(tool);
}

export function isTerminalTool(tool: AgentToolName): boolean {
  return TERMINAL_TOOLS.includes(tool);
}

export function isFileMutationTool(tool: AgentToolName): boolean {
  return FILE_MUTATION_TOOLS.includes(tool);
}
