import {
  Intent
} from "../models/types";

export class IntentDetector {

  detect(question: string): Intent {

    const q =
      question
        .toLowerCase()
        .trim();

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

  private containsAny(
    value: string,
    terms: string[]
  ): boolean {

    return terms.some(
      term => value.includes(term)
    );
  }
}