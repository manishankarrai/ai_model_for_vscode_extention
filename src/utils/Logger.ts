import * as vscode from "vscode";

import { flow } from "./flowLog";

export class Logger {
  private readonly output: vscode.OutputChannel;

  constructor() {
    flow("Logger.constructor", 1, "create output channel");
    this.output = vscode.window.createOutputChannel("MM3 AI Agent");
  }

  info(message: string, data?: unknown): void {
    flow("Logger.info", 1, message, data);
    this.write("INFO", message, data);
  }

  warn(message: string, data?: unknown): void {
    flow("Logger.warn", 1, message, data);
    this.write("WARN", message, data);
  }

  error(message: string, error?: unknown): void {
    flow("Logger.error", 1, message, error);
    this.write("ERROR", message, error);
  }

  flow(fn: string, step: number, message: string, data?: unknown): void {
    flow(fn, step, message, data);
    this.write("FLOW", `[${fn} #${String(step).padStart(2, "0")}] ${message}`, data);
  }

  show(): void {
    flow("Logger.show", 1, "show output channel");
    this.output.show(true);
  }

  dispose(): void {
    flow("Logger.dispose", 1, "dispose output channel");
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
        if (data instanceof Error) {
          line += ` ${JSON.stringify({
            name: data.name,
            message: data.message
          })}`;
        } else {
          line += ` ${JSON.stringify(data)}`;
        }
      } catch {
        line += " [unserializable]";
      }
    }
    this.output.appendLine(line);
  }
}