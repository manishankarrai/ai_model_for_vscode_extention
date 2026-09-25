import type { TaskMemory } from "../models/types.ts";

export interface VerificationOutcome {
  tool: string;
  success: boolean;
}

export interface VerificationResult {
  completed: boolean;
  passed: string[];
  failed: string[];
  retryable: boolean;
  summary: string;
}

export class VerificationManager {
  evaluate(outcomes: VerificationOutcome[]): VerificationResult {
    const validation = outcomes.filter((outcome) =>
      outcome.tool === "run_tests" || outcome.tool === "get_diagnostics" || outcome.tool === "run_command"
    );
    const passed = validation.filter((outcome) => outcome.success).map((outcome) => outcome.tool);
    const failed = validation.filter((outcome) => !outcome.success).map((outcome) => outcome.tool);
    return {
      completed: validation.length > 0 && failed.length === 0,
      passed,
      failed,
      retryable: failed.length > 0,
      summary: validation.length === 0
        ? "No verification checks were executed."
        : `Verification ${failed.length === 0 ? "passed" : "requires attention"}: ${validation.map((item) => `${item.tool}:${item.success ? "passed" : "failed"}`).join(", ")}`
    };
  }

  updateMemory(
    memory: TaskMemory | undefined,
    outcomes: VerificationOutcome[]
  ): TaskMemory | undefined {
    if (!memory) {
      return undefined;
    }
    const validation = outcomes.filter((outcome) =>
      outcome.tool === "run_tests" || outcome.tool === "get_diagnostics" || outcome.tool === "run_command"
    );
    if (validation.length === 0) {
      return memory;
    }
    const result = this.evaluate(validation);
    return {
      ...memory,
      verification: {
        ...memory.verification,
        completed: result.completed,
        lastResult: result.summary
      }
    };
  }
}