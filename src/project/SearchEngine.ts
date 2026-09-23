import type { IndexedSymbol } from "./SymbolIndex.ts";
import type { Relationship } from "./RepositoryRetrieval.ts";

export interface SearchDocument {
  path: string;
  content: string;
  symbols: IndexedSymbol[];
}

export interface RankedSearchResult {
  path: string;
  score: number;
  matches: number;
  reason: string;
  matchedSymbols: string[];
  matchedTerms: string[];
  startLine?: number;
  endLine?: number;
  snippet: string;
}

export class SearchEngine {
  search(
    query: string,
    documents: SearchDocument[],
    relationships: Relationship[] = [],
    limit = 50
  ): RankedSearchResult[] {
    const terms = [...new Set(query.toLowerCase().split(/\s+/).map((term) => term.trim()).filter(Boolean))];
    if (terms.length === 0) {
      return [];
    }

    const candidates = documents.flatMap((document) => this.rankDocument(document, terms, relationships));
    const deduplicated = new Map<string, RankedSearchResult>();
    for (const candidate of candidates) {
      const key = `${candidate.path}:${candidate.startLine ?? 0}:${candidate.endLine ?? 0}:${this.contentHash(candidate.snippet)}`;
      const existing = deduplicated.get(key);
      if (!existing || candidate.score > existing.score) {
        deduplicated.set(key, candidate);
      }
    }

    return [...deduplicated.values()]
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || (left.startLine ?? 0) - (right.startLine ?? 0))
      .slice(0, Math.max(0, limit));
  }

  private rankDocument(
    document: SearchDocument,
    terms: string[],
    relationships: Relationship[]
  ): RankedSearchResult[] {
    const lowerPath = document.path.toLowerCase();
    const lowerContent = document.content.toLowerCase();
    const matchedTerms = terms.filter((term) => lowerContent.includes(term) || lowerPath.includes(term));
    if (matchedTerms.length === 0) {
      return [];
    }

    const matchedSymbols = document.symbols
      .filter((item) => terms.some((term) => item.name.toLowerCase() === term || item.qualifiedName.toLowerCase() === term))
      .map((item) => item.qualifiedName);
    const relationshipMatches = relationships.filter((item) =>
      terms.some((term) => item.from.toLowerCase() === term || item.to.toLowerCase() === term)
    );
    const textMatches = matchedTerms.reduce((count, term) => count + this.countOccurrences(lowerContent, term), 0);
    const exactSymbol = matchedSymbols.length > 0;
    const filenameMatch = terms.some((term) => lowerPath.includes(term));
    const score = (exactSymbol ? 100 : 0) +
      (filenameMatch ? 40 : 0) +
      matchedTerms.length * 10 +
      Math.min(textMatches, 20) +
      relationshipMatches.length * 5;
    const reason = [
      exactSymbol ? "exact symbol" : "",
      filenameMatch ? "filename match" : "",
      textMatches > 0 ? `${textMatches} text match(es)` : "",
      relationshipMatches.length > 0 ? "relationship match" : ""
    ].filter(Boolean).join(", ");
    const firstTerm = matchedTerms[0];
    const matchIndex = lowerContent.indexOf(firstTerm);
    const symbol = document.symbols.find((item) => matchedSymbols.includes(item.qualifiedName));
    const snippet = this.snippet(document.content, matchIndex, symbol);

    return [{
      path: document.path,
      score,
      matches: textMatches,
      reason,
      matchedSymbols,
      matchedTerms,
      startLine: symbol?.startLine,
      endLine: symbol?.endLine,
      snippet
    }];
  }

  private snippet(content: string, matchIndex: number, symbol?: IndexedSymbol): string {
    if (symbol) {
      const lines = content.split("\n");
      return lines.slice(symbol.startLine - 1, symbol.endLine).join("\n");
    }
    const safeIndex = Math.max(0, matchIndex);
    const start = Math.max(0, safeIndex - 1_500);
    const end = Math.min(content.length, safeIndex + 1_500);
    return content.slice(start, end);
  }

  private countOccurrences(content: string, term: string): number {
    let count = 0;
    let offset = 0;
    while ((offset = content.indexOf(term, offset)) >= 0) {
      count += 1;
      offset += term.length;
    }
    return count;
  }

  private contentHash(content: string): string {
    let hash = 0;
    for (let index = 0; index < content.length; index += 1) {
      hash = ((hash << 5) - hash + content.charCodeAt(index)) | 0;
    }
    return String(hash);
  }
}