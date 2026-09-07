import { flow } from "./flowLog";

export class TokenEstimator {

  estimateText(
    text: string
  ): number {
    flow("TokenEstimator.estimateText", 1, "enter");

    if (!text) {
      return 0;
    }

    // Rough approximation.
    // Backend/Gemini usage remains authoritative.
    return Math.ceil(
      text.length / 4
    );
  }

  estimateFiles(
    files: Array<{
      content: string;
    }>
  ): number {
    flow("TokenEstimator.estimateFiles", 1, "enter", { count: files.length });

    return files.reduce(
      (total, file) =>
        total +
        this.estimateText(
          file.content
        ),
      0
    );
  }
}