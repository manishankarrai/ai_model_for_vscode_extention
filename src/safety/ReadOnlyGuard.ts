import { flow } from "../utils/flowLog";
import type { InteractionMode } from "../models/types";

/**
 * Ask mode stays read-only.
 * Agent mode may run mutating and terminal tools through WorkspaceToolRegistry
 * after local validation and user approval.
 */
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

  static isAllowed(
    operation: string,
    mode: InteractionMode = "ask"
  ): boolean {
    flow("ReadOnlyGuard.isAllowed", 1, "enter", { operation, mode });
    if (mode === "agent") {
      return true;
    }

    return !this.BLOCKED_OPERATIONS.includes(
      operation
    );
  }

  static assertAllowed(
    operation: string,
    mode: InteractionMode = "ask"
  ): void {
    flow("ReadOnlyGuard.assertAllowed", 1, "enter", { operation, mode });

    if (
      !this.isAllowed(operation, mode)
    ) {

      throw new Error(
        `M3 Ask mode is read-only. Operation '${operation}' is blocked.`
      );
    }
  }
}
