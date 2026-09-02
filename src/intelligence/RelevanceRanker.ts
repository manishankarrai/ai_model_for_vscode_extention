import {
  ProjectIndex,
  SearchResult
} from "../models/types";

export class RelevanceRanker {

  rank(
    question: string,
    index: ProjectIndex,
    searchResults: SearchResult[]
  ): SearchResult[] {

    const questionTerms =
      question
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);

    const resultMap =
      new Map<string, SearchResult>();

    for (const result of searchResults) {
      resultMap.set(
        result.path,
        {
          ...result
        }
      );
    }

    // --------------------------------------------------------
    // Symbol relevance
    // --------------------------------------------------------

    for (const symbol of index.symbols) {

      const symbolName =
        symbol.name.toLowerCase();

      const matches =
        questionTerms.some(
          term =>
            symbolName.includes(term)
        );

      if (!matches) {
        continue;
      }

      const existing =
        resultMap.get(
          symbol.filePath
        );

      if (existing) {

        existing.score += 15;

        existing.reason +=
          "; relevant symbol";

      } else {

        resultMap.set(
          symbol.filePath,
          {
            path: symbol.filePath,

            score: 15,

            matches: 1,

            reason:
              "relevant symbol"
          }
        );
      }
    }

    // --------------------------------------------------------
    // File-name relevance
    // --------------------------------------------------------

    for (
      const file of index.files.values()
    ) {

      const lower =
        file.file.path.toLowerCase();

      let score = 0;

      for (const term of questionTerms) {

        if (lower.includes(term)) {
          score += 8;
        }
      }

      if (score === 0) {
        continue;
      }

      const existing =
        resultMap.get(
          file.file.path
        );

      if (existing) {

        existing.score += score;

      } else {

        resultMap.set(
          file.file.path,
          {
            path: file.file.path,

            score,

            matches: 0,

            reason:
              "relevant filename"
          }
        );
      }
    }

    return Array.from(
      resultMap.values()
    ).sort(
      (a, b) =>
        b.score - a.score
    );
  }
}