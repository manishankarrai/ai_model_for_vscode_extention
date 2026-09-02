export class TokenEstimator {

  estimateText(
    text: string
  ): number {

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