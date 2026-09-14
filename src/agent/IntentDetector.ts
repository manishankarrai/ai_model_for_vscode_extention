import { flow } from "../utils/flowLog";

import {
  Intent
} from "../models/types";

export class IntentDetector {

  resolve(question: string): IntentResolution {
    flow("IntentDetector.resolve", 1, "enter");

    const normalizedQuestion = question.toLowerCase().trim();

    if (this.isGreeting(normalizedQuestion)) {
      return {
        intent: "chat",
        kind: "greeting",
        confidence: 1,
        reason: "greeting"
      };
    }

    if (this.isUnclear(normalizedQuestion)) {
      return {
        intent: "chat",
        kind: "clarification",
        confidence: 0,
        reason: "insufficient task details"
      };
    }

    return {
      intent: this.detectIntent(normalizedQuestion),
      kind: "task",
      confidence: 0.75,
      reason: "matched task language"
    };
  }

  detect(question: string): Intent {
    flow("IntentDetector.detect", 1, "enter");

    return this.detectIntent(question.toLowerCase().trim());
  }

  private detectIntent(q: string): Intent {
    if (
      this.containsAny(
        q,
        [
          "implement",
          "add feature",
          "build",
          "create",
          "refactor",
          "change the code",
          "write code"
        ]
      )
    ) {
      return "implementation";
    }

    if (
      this.containsAny(
        q,
        [
          "bug",
          "error",
          "broken",
          "not working",
          "issue",
          "fix",
          "crash",
          "exception",
          "why does"
        ]
      )
    ) {
      return "bug_analysis";
    }

    if (
      this.containsAny(
        q,
        [
          "architecture",
          "design",
          "structure",
          "dependency",
          "system design"
        ]
      )
    ) {
      return "architecture";
    }

    if (
      this.containsAny(
        q,
        [
          "analyze",
          "review",
          "review my code",
          "code quality",
          "performance",
          "security"
        ]
      )
    ) {
      return "analyze";
    }

    return "chat";
  }

  private isGreeting(question: string): boolean {
    return /^(hi|hello|hey|hiya|good morning|good afternoon|good evening)( there| everyone)?[.!?, ]*$/.test(question);
  }

  private isUnclear(question: string): boolean {
    return [
      "help",
      "help me",
      "can you help",
      "please help",
      "assist me",
      "fix it",
      "do it",
      "make it better",
      "what can you do"
    ].includes(question);
  }

  private containsAny(
    value: string,
    terms: string[]
  ): boolean {

    return terms.some(
      term => value.includes(term)
    );
  }
}

export interface IntentResolution {
  intent: Intent;
  kind: "greeting" | "clarification" | "task";
  confidence: number;
  reason: string;
}