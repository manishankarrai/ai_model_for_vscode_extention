import type { IndexedSymbol } from "./SymbolIndex.ts";
import type { Relationship } from "./RepositoryRetrieval.ts";

export interface SemanticSearchMatch {
  path: string;
  startLine?: number;
  endLine?: number;
  score: number;
}

export interface SemanticIndex {
  search(query: string, limit: number, signal?: AbortSignal): Promise<SemanticSearchMatch[]>;
}

export interface SearchDocument {
  path: string;
  content: string;
  symbols: IndexedSymbol[];
  explicit?: boolean;
  recentChange?: boolean;
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
  lexicalScore?: number;
  graphScore?: number;
  semanticScore?: number;
  selectionScore?: number;
  recencyScore?: number;
}

export class SearchEngine {
  search(
    query: string,
    documents: SearchDocument[],
    relationships: Relationship[] = [],
    limit = 50,
    semanticMatches: SemanticSearchMatch[] = []
  ): RankedSearchResult[] {
    const terms = [...new Set(query.toLowerCase().split(/\s+/).map((term) => term.trim()).filter(Boolean))];
    if (terms.length === 0) {
      return [];
    }

    const averageLength = documents.length === 0
      ? 0
      : documents.reduce((sum, document) => sum + document.content.length, 0) / documents.length;
    const candidates = documents.flatMap((document) => this.rankDocument(document, terms, relationships, documents.length, averageLength, semanticMatches));
    const deduplicated = new Map<string, RankedSearchResult>();
    for (const candidate of candidates) {
      const key = `${candidate.path}:${candidate.startLine ?? 0}:${candidate.endLine ?? 0}:${this.contentHash(candidate.snippet)}`;
      const existing = deduplicated.get(key);
      if (!existing || candidate.score > existing.score) {
        deduplicated.set(key, candidate);
      }
    }

    return this.fuseScores([...deduplicated.values()])
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || (left.startLine ?? 0) - (right.startLine ?? 0))
      .slice(0, Math.max(0, limit));
  }

  private fuseScores(results: RankedSearchResult[]): RankedSearchResult[] {
    const maximums = {
      lexical: Math.max(0, ...results.map((result) => result.lexicalScore ?? 0)),
      graph: Math.max(0, ...results.map((result) => result.graphScore ?? 0)),
      semantic: Math.max(0, ...results.map((result) => result.semanticScore ?? 0)),
      selection: Math.max(0, ...results.map((result) => result.selectionScore ?? 0)),
      recency: Math.max(0, ...results.map((result) => result.recencyScore ?? 0))
    };
    const normalize = (value: number | undefined, maximum: number): number => maximum > 0 ? (value ?? 0) / maximum : 0;

    return results.map((result) => {
      const fusionScore =
        normalize(result.lexicalScore, maximums.lexical) * 0.30 +
        normalize(result.graphScore, maximums.graph) * 0.10 +
        normalize(result.semanticScore, maximums.semantic) * 0.45 +
        normalize(result.selectionScore, maximums.selection) * 0.10 +
        normalize(result.recencyScore, maximums.recency) * 0.05;
      return {
        ...result,
        score: Number((fusionScore * 100).toFixed(4)),
        reason: `${result.reason}, fusion=${(fusionScore * 100).toFixed(2)}`
      };
    });
  }

  private rankDocument(
    document: SearchDocument,
    terms: string[],
    relationships: Relationship[],
    documentCount: number,
    averageLength: number,
    semanticMatches: SemanticSearchMatch[]
  ): RankedSearchResult[] {
    const lowerPath = document.path.toLowerCase();
    const lowerContent = document.content.toLowerCase();
    const matchedTerms = terms.filter((term) => lowerContent.includes(term) || lowerPath.includes(term));
    const matchedSymbols = document.symbols
      .filter((item) => terms.some((term) => item.name.toLowerCase() === term || item.qualifiedName.toLowerCase() === term))
      .map((item) => item.qualifiedName);
    const relationshipMatches = relationships.filter((item) =>
      terms.some((term) => [item.from, item.to, item.resolvedPath, item.sourcePath]
        .filter((value): value is string => value !== undefined)
        .some((value) => value.toLowerCase() === term || value.toLowerCase().includes(term)))
    );
    const graphScore = relationshipMatches.reduce((score, item) => score + 5 * (item.confidence ?? 0.5), 0);
    const documentSemanticMatches = semanticMatches
      .filter((match) => match.path === document.path);
    const bestSemanticChunk = [...documentSemanticMatches]
      .sort((left, right) => right.score - left.score || (left.startLine ?? 0) - (right.startLine ?? 0))[0];
    const documentSemanticScore = documentSemanticMatches
      .reduce((score, match) => Math.max(score, match.score * 100), 0);
    if (matchedTerms.length === 0 && relationshipMatches.length === 0 && documentSemanticScore === 0) {
      return [];
    }
    const textMatches = matchedTerms.reduce((count, term) => count + this.countOccurrences(lowerContent, term), 0);
    const exactSymbol = matchedSymbols.length > 0;
    const filenameMatch = terms.some((term) => lowerPath.includes(term));
    const selectionScore = document.explicit ? 80 : 0;
    const recencyScore = document.recentChange ? 15 : 0;
    const lexicalScore = (exactSymbol ? 100 : 0) + (filenameMatch ? 40 : 0) +
      matchedTerms.reduce((score, term) => score + this.bm25(lowerContent, term, documentCount, averageLength), 0);
    const score = lexicalScore + graphScore + documentSemanticScore + selectionScore + recencyScore;
    const reason = [
      exactSymbol ? "exact symbol" : "",
      filenameMatch ? "filename match" : "",
      textMatches > 0 ? `${textMatches} text match(es)` : "",
      relationshipMatches.length > 0 ? `graph evidence (${relationshipMatches.length})` : "",
      `lexical=${lexicalScore.toFixed(2)}`,
      graphScore > 0 ? `graph=${graphScore.toFixed(2)}` : "",
      documentSemanticScore > 0 ? `semantic=${documentSemanticScore.toFixed(2)}` : "",
      selectionScore > 0 ? `selected=${selectionScore.toFixed(2)}` : "",
      recencyScore > 0 ? `recent=${recencyScore.toFixed(2)}` : ""
    ].filter(Boolean).join(", ");
    const firstTerm = matchedTerms[0] ?? terms[0];
    const matchIndex = lowerContent.indexOf(firstTerm);
    const matchingSymbols = document.symbols.filter((item) => matchedSymbols.includes(item.qualifiedName));
    const semanticSymbols = document.symbols.filter((symbol) => documentSemanticMatches.some((match) =>
      match.startLine === symbol.startLine && match.endLine === symbol.endLine
    ));
    const chunks: Array<IndexedSymbol | undefined> = [
      ...new Map([...matchingSymbols, ...semanticSymbols].map((symbol) => [symbol.id, symbol])).values()
    ];
    if (chunks.length === 0) {
      chunks.push(undefined);
    }
    return chunks.map((symbol) => {
      const semanticScore = symbol
        ? documentSemanticMatches
          .filter((match) => match.startLine === symbol.startLine && match.endLine === symbol.endLine)
          .reduce((score, match) => Math.max(score, match.score * 100), 0)
        : documentSemanticScore;
      const chunkReason = [
        symbol ? `${reason}, code chunk` : reason,
        symbol && semanticScore !== documentSemanticScore && semanticScore > 0 ? `semantic=${semanticScore.toFixed(2)}` : ""
      ].filter(Boolean).join(", ");
      return {
        path: document.path,
        score: lexicalScore + graphScore + semanticScore + selectionScore + recencyScore + (symbol ? 10 : 0),
        matches: textMatches,
        reason: chunkReason,
        matchedSymbols: symbol ? [symbol.qualifiedName] : matchedSymbols,
        matchedTerms,
        startLine: symbol?.startLine ?? bestSemanticChunk?.startLine,
        endLine: symbol?.endLine ?? bestSemanticChunk?.endLine,
        snippet: this.snippet(document.content, matchIndex, symbol, bestSemanticChunk),
        lexicalScore,
        graphScore,
        semanticScore,
        selectionScore,
        recencyScore
      };
    });
  }

  private snippet(
    content: string,
    matchIndex: number,
    symbol?: IndexedSymbol,
    semanticChunk?: SemanticSearchMatch
  ): string {
    if (symbol) {
      const lines = content.split("\n");
      return lines.slice(symbol.startLine - 1, symbol.endLine).join("\n");
    }
    if (semanticChunk?.startLine !== undefined && semanticChunk.endLine !== undefined) {
      const lines = content.split("\n");
      return lines.slice(semanticChunk.startLine - 1, semanticChunk.endLine).join("\n");
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

  private bm25(content: string, term: string, documentCount: number, averageLength: number): number {
    const frequency = this.countOccurrences(content, term);
    if (frequency === 0) {
      return 0;
    }
    const documentLength = content.length;
    const documentFrequency = Math.max(1, Math.ceil(documentCount / 2));
    const idf = Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
    const normalization = averageLength > 0 ? 1 - 0.75 + 0.75 * documentLength / averageLength : 1;
    return idf * (frequency * 2.2) / (frequency + 1.2 * normalization);
  }

  private contentHash(content: string): string {
    let hash = 0;
    for (let index = 0; index < content.length; index += 1) {
      hash = ((hash << 5) - hash + content.charCodeAt(index)) | 0;
    }
    return String(hash);
  }
}