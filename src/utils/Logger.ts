import * as vscode from "vscode";

export class Logger {
  private readonly output =
    vscode.window.createOutputChannel("MM3 AI Agent");

  info(message: string, data?: unknown): void {
    this.write("INFO", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.write("WARN", message, data);
  }

  error(message: string, error?: unknown): void {
    this.write("ERROR", message, error);
  }

  flow(fn: string, step: number, message: string, data?: unknown): void {
    this.write("FLOW", `${fn}#${step} ${message}`, data);
  }

  show(): void {
    this.output.show(true);
  }

  dispose(): void {
    this.output.dispose();
  }

  private write(level: string, message: string, data?: unknown): void {
    const suffix = data === undefined ? "" : ` ${this.stringify(data)}`;
    this.output.appendLine(
      `${new Date().toISOString()} [${level}] ${message}${suffix}`
    );
  }

  private stringify(value: unknown): string {
    if (value instanceof Error) {
      return value.stack || value.message;
    }

    if (typeof value === "string") {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}