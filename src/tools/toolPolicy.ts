import type { AgentToolName, InteractionMode, ToolPolicy } from "../models/types.ts";

import { flow } from "../utils/flowLog.ts";

const READ_TOOLS: AgentToolName[] = [
  "read_file",
  "read_file_range",
  "read_symbol",
  "search",
  "search_symbols",
  "list_files",
  "find_definition",
  "find_references",
  "find_callers",
  "find_callees",
  "find_tests",
  "find_routes",
  "find_reads",
  "find_writes",
  "get_file_summary",
  "get_project_summary",
  "get_diagnostics",
  "git_diff",
  "git_status"
];

/** File mutations apply automatically during agent runs; only shell work needs approval. */
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

const TERMINAL_APPROVAL_TOOLS: AgentToolName[] = [
  "run_task",
  "run_command",
  "run_tests"
];

export function availableTools(mode: InteractionMode): AgentToolName[] {
  flow("availableTools", 1, "enter");
  if (mode === "ask") {
    return [...READ_TOOLS];
  }

  return [...READ_TOOLS, ...FILE_MUTATION_TOOLS, ...TERMINAL_APPROVAL_TOOLS];
}

export function getToolPolicy(mode: InteractionMode): ToolPolicy {
  flow("getToolPolicy", 1, "enter");
  if (mode === "ask") {
    return {
      allowed: [...READ_TOOLS],
      approval_required: []
    };
  }

  return {
    allowed: availableTools(mode),
    approval_required: [...TERMINAL_APPROVAL_TOOLS]
  };
}

export function isToolAllowed(
  mode: InteractionMode,
  tool: AgentToolName
): boolean {
  return availableTools(mode).includes(tool);
}

export function requiresApproval(tool: AgentToolName): boolean {
  flow("requiresApproval", 1, "enter");
  return TERMINAL_APPROVAL_TOOLS.includes(tool);
}

export function isReadOnlyTool(tool: AgentToolName): boolean {
  return READ_TOOLS.includes(tool);
}

export function isFileMutationTool(tool: AgentToolName): boolean {
  return FILE_MUTATION_TOOLS.includes(tool);
}
