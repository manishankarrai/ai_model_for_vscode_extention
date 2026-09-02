import * as vscode from "vscode";

import {
  ProjectIndex,
  SearchResult
} from "../models/types";

import {
  readTextFile
} from "../utils/FileUtils";

export class SearchEngine {

  async search(
    query: string,
    index: ProjectIndex,
    maxResults = 30
  ): Promise<SearchResult[]> {

    const normalizedQuery =
      query.toLowerCase().trim();

    if (!normalizedQuery) {
      return [];
    }

    const terms =
      normalizedQuery
        .split(/\s+/)
        .filter(Boolean);

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

        for (const term of terms) {

          let position = 0;

          while (
            (position =
              lower.indexOf(
                term,
                position
              )) !== -1
          ) {

            matches++;

            position += term.length;
          }
        }

        if (matches === 0) {
          continue;
        }

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
              : "query found in content"
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