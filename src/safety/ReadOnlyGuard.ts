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

    return !this.BLOCKED_OPERATIONS.includes(
      operation
    );
  }

  static assertAllowed(
    operation: string
  ): void {

    if (
      !this.isAllowed(operation)
    ) {

      throw new Error(
        `M3 is read-only. Operation '${operation}' is blocked.`
      );
    }
  }
}