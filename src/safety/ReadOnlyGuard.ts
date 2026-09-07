import { flow } from "../utils/flowLog";

export class ReadOnlyGuard {

  private static readonly BLOCKED_OPERATIONS = [
    "write_file",
    "edit_file",
    "delete_file",
    "rename_file",
    "move_file",
    "create_file",
    "apply_patch",
    "execute_command",
    "terminal",
    "shell"
  ];

  static isAllowed(
    operation: string
  ): boolean {
    flow("ReadOnlyGuard.isAllowed", 1, "enter", { operation });

    return !this.BLOCKED_OPERATIONS.includes(
      operation
    );
  }

  static assertAllowed(
    operation: string
  ): void {
    flow("ReadOnlyGuard.assertAllowed", 1, "enter", { operation });

    if (
      !this.isAllowed(operation)
    ) {

      throw new Error(
        `M3 is read-only. Operation '${operation}' is blocked.`
      );
    }
  }
}