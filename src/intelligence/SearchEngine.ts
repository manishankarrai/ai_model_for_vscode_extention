import { flow } from "../utils/flowLog.ts";

import * as vscode from "vscode";

import {
  ProjectIndex,
  SearchResult
} from "../models/types.ts";

import {
  readTextFile
} from "../utils/FileUtils.ts";

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "where",
  "what",
  "which",
  "who",
  "how",
  "why",
  "when",
  "does",
  "do",
  "did",
  "this",
  "that",
  "these",
  "those",
  "in",
  "on",
  "at",
  "to",
  "of",
  "for",
  "from",
  "with",
  "and",
  "or",
  "my",
  "me",
  "it",
  "be",
  "code",
  "file",
  "files",
  "work"
]);

export class SearchEngine {

  private extractTerms(query: string): string[] {
    return query
      .toLowerCase()
      .replace(/[^\w\s-]/g, " ")
      .split(/\s+/)
      .filter((term) => term.length >= 2 && !STOP_WORDS.has(term));
  }

  async search(
    query: string,
    index: ProjectIndex,
    maxResults = 30
  ): Promise<SearchResult[]> {
    flow("SearchEngine.search", 1, "enter", { query, maxResults });

    const normalizedQuery =
      query.toLowerCase().trim();

    if (!normalizedQuery) {
      return [];
    }

    const terms = this.extractTerms(normalizedQuery);
    if (terms.length === 0) {
      // Fallback if query only contained stop words or symbols
      terms.push(...normalizedQuery.split(/\s+/).filter(Boolean));
    }

    const results: SearchResult[] = [];

    for (
      const indexed of index.files.values()
    ) {

      try {

        const content =
          await readTextFile(
            vscode.Uri.file(
              indexed.file.absolutePath
            )
          );

        const lower =
          content.toLowerCase();

        let matches = 0;

        const matchedTerms: string[] = [];

        for (const term of terms) {

          let position = 0;
          let termMatches = 0;

          while (
            (position =
              lower.indexOf(
                term,
                position
              )) !== -1
          ) {

            matches++;
            termMatches++;

            position += term.length;
          }

          if (termMatches > 0) {
            matchedTerms.push(term);
          }
        }

        if (matches === 0) {
          continue;
        }

        const matchedSymbols =
          indexed.symbols
            .filter(symbol =>
              terms.some(term =>
                symbol.name
                  .toLowerCase()
                  .includes(term)
              )
            )
            .map(symbol => symbol.name);

        const uniqueMatchedSymbols =
          [...new Set(matchedSymbols)];

        const pathScore =
          indexed.file.path
            .toLowerCase()
            .includes(normalizedQuery)
            ? 10
            : 0;

        const score =
          matches + pathScore;

        results.push({
          path: indexed.file.path,

          score,

          matches,

          reason:
            pathScore > 0
              ? "query found in file path and content"
              : "query found in content",

          matchedTerms,

          matchedSymbols:
            uniqueMatchedSymbols
        });

      } catch {
        continue;
      }
    }

    return results
      .sort(
        (a, b) =>
          b.score - a.score
      )
      .slice(0, maxResults);
  }
}