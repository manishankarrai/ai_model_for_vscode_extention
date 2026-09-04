import type { AgentToolName, InteractionMode, ToolPolicy } from "../models/types.ts";

const READ_TOOLS: AgentToolName[] = [
  "read_file",
  "search",
  "list_files",
  "get_diagnostics",
  "git_diff",
  "git_status"
];

const APPROVAL_TOOLS: AgentToolName[] = [
  "run_task",
  "apply_change_set",
  "create_file",
  "delete_file",
  "rename_file",
  "move_file"
];

export function availableTools(mode: InteractionMode): AgentToolName[] {
  if (mode === "ask") {
    return [];
  }

  return [...READ_TOOLS, ...APPROVAL_TOOLS];
}

export function getToolPolicy(mode: InteractionMode): ToolPolicy {
  if (mode === "ask") {
    return {
      allowed: [],
      approval_required: []
    };
  }

  return {
    allowed: availableTools(mode),
    approval_required: [...APPROVAL_TOOLS]
  };
}

export function isToolAllowed(
  mode: InteractionMode,
  tool: AgentToolName
): boolean {
  return availableTools(mode).includes(tool);
}

export function requiresApproval(tool: AgentToolName): boolean {
  return APPROVAL_TOOLS.includes(tool);
}
