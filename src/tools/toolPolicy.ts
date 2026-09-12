import type { AgentToolName, InteractionMode, ToolPolicy } from "../models/types.ts";
const READ_TOOLS: AgentToolName[] = [
    "read_file",
    "search",
    "list_files",
    "get_diagnostics",
    "git_diff",
    "git_status"
];
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
    if (mode === "ask") {
        return [];
    }
    return [...READ_TOOLS, ...FILE_MUTATION_TOOLS, ...TERMINAL_APPROVAL_TOOLS];
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
        approval_required: [...TERMINAL_APPROVAL_TOOLS]
    };
}
export function isToolAllowed(mode: InteractionMode, tool: AgentToolName): boolean {
    return availableTools(mode).includes(tool);
}
export function requiresApproval(tool: AgentToolName): boolean {
    return TERMINAL_APPROVAL_TOOLS.includes(tool);
}
export function isReadOnlyTool(tool: AgentToolName): boolean {
    return READ_TOOLS.includes(tool);
}
export function isFileMutationTool(tool: AgentToolName): boolean {
    return FILE_MUTATION_TOOLS.includes(tool);
}
