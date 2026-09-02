import * as vscode from "vscode";

export class Logger {
  private readonly output: vscode.OutputChannel;

  constructor() {
    this.output = vscode.window.createOutputChannel("M3 AI Agent");
  }

  info(message: string, data?: unknown): void {
    this.write("INFO", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.write("WARN", message, data);
  }

  error(message: string, error?: unknown): void {
    this.write("ERROR", message, error);
  }

  show(): void {
    this.output.show(true);
  }

  dispose(): void {
    this.output.dispose();
  }

  private write(
    level: string,
    message: string,
    data?: unknown
  ): void {
    const timestamp = new Date().toISOString();

    let line = `[${timestamp}] [${level}] ${message}`;

    if (data !== undefined) {
      try {
        line += ` ${JSON.stringify(data)}`;
      } catch {
        line += " [unserializable]";
      }
    }

    this.output.appendLine(line);
  }
}