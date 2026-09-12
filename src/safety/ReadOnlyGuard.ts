import type { InteractionMode } from "../models/types";
export class ReadOnlyGuard {
    private static readonly BLOCKED_OPERATIONS = [
        "write_file",
        "edit_file",
        "delete_file",
        "rename_file",
        "move_file",
        "create_file",
        "apply_patch",
        "apply_change_set",
        "execute_command",
        "run_command",
        "run_tests",
        "run_task",
        "terminal",
        "shell"
    ];
    static isMutating(operation: string): boolean {
        return this.BLOCKED_OPERATIONS.includes(operation);
    }
    static isAllowed(operation: string, mode: InteractionMode = "ask"): boolean {
        if (mode === "agent") {
            return true;
        }
        return !this.BLOCKED_OPERATIONS.includes(operation);
    }
    static assertAllowed(operation: string, mode: InteractionMode = "ask"): void {
        if (!this.isAllowed(operation, mode)) {
            throw new Error(`MM3 Ask mode is read-only. Operation '${operation}' is blocked.`);
        }
    }
}
