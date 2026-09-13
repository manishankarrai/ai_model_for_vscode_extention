export class Logger {
  constructor() {}

  info(message: string, data?: unknown): void {
    void message;
    void data;
  }

  warn(message: string, data?: unknown): void {
    void message;
    void data;
  }

  error(message: string, error?: unknown): void {
    void message;
    void error;
  }

  flow(fn: string, step: number, message: string, data?: unknown): void {
    void fn;
    void step;
    void message;
    void data;
  }

  show(): void {
  }

  dispose(): void {
  }
}