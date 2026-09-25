import type { SemanticIndex, SemanticSearchMatch } from "./SearchEngine.ts";

const CODE_STOPWORDS = new Set([
  "and", "async", "await", "boolean", "class", "const", "default", "else", "export", "extends",
  "false", "for", "from", "function", "if", "import", "interface", "let", "new", "null", "number",
  "private", "protected", "public", "return", "static", "string", "this", "true", "type", "undefined",
  "var", "void", "while"
]);

const TOKEN_ALIASES: Record<string, string[]> = {
  auth: ["authentication", "authorization"],
  authentication: ["auth", "authorization"],
  authorization: ["auth", "authentication"],
  config: ["configuration", "settings"],
  configuration: ["config", "settings"],
  database: ["db", "storage"],
  db: ["database", "storage"],
  implementation: ["impl"],
  impl: ["implementation"],
  repository: ["repo"],
  repo: ["repository"],
  request: ["req"],
  req: ["request"],
  response: ["res"],
  res: ["response"],
  service: ["svc"],
  svc: ["service"],
  logging: ["logger", "telemetry"],
  logger: ["logging", "telemetry"],
  observability: ["telemetry", "metrics", "tracing"],
  telemetry: ["observability", "metrics", "tracing"],
  tracing: ["trace", "telemetry"]
};

export interface SemanticDocument {
  path: string;
  content: string;
  startLine?: number;
  endLine?: number;
}

export interface EmbeddingProvider {
  embed(content: string): Map<string, number>;
}

export class LexicalEmbeddingProvider implements EmbeddingProvider {
  embed(content: string): Map<string, number> {
    const vector = new Map<string, number>();
    const normalized = content
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/[_-]+/g, " ");
    for (const token of normalized.toLowerCase().match(/[a-z][a-z0-9_]{1,}/g) ?? []) {
      if (CODE_STOPWORDS.has(token)) {
        continue;
      }
      for (const expandedToken of [token, ...(TOKEN_ALIASES[token] ?? [])]) {
        vector.set(expandedToken, (vector.get(expandedToken) ?? 0) + 1);
      }
      if (token.length >= 4) {
        const padded = `^${token}$`;
        for (let index = 0; index <= padded.length - 4; index += 1) {
          const ngram = `ngram:${padded.slice(index, index + 4)}`;
          vector.set(ngram, (vector.get(ngram) ?? 0) + 0.2);
        }
      }
    }
    return vector;
  }
}

export class LocalSemanticIndex implements SemanticIndex {
  private static readonly minimumScore = 0.01;
  private readonly documents = new Map<string, SemanticDocument>();
  private readonly embeddingCache = new Map<string, Map<string, number>>();
  private readonly embeddingProvider: EmbeddingProvider;

  constructor(embeddingProvider: EmbeddingProvider = new LexicalEmbeddingProvider()) {
    this.embeddingProvider = embeddingProvider;
  }

  upsert(document: SemanticDocument): void {
    this.documents.set(this.key(document), { ...document });
  }

  remove(path: string, startLine?: number, endLine?: number): void {
    this.documents.delete(this.key({ path, startLine, endLine }));
  }

  removeFile(path: string): void {
    for (const [key, document] of this.documents) {
      if (document.path === path) {
        this.documents.delete(key);
      }
    }
  }

  clear(): void {
    this.documents.clear();
    this.embeddingCache.clear();
  }

  async search(query: string, limit: number, signal?: AbortSignal): Promise<SemanticSearchMatch[]> {
    if (signal?.aborted) {
      throw new Error("Semantic search cancelled");
    }
    const documents = [...this.documents.values()];
    const documentVectors = documents.map((document) => this.cachedEmbedding(document.content));
    const documentFrequency = new Map<string, number>();
    for (const vector of documentVectors) {
      for (const token of vector.keys()) {
        documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
      }
    }
    const inverseDocumentFrequency = new Map<string, number>();
    for (const [token, frequency] of documentFrequency) {
      inverseDocumentFrequency.set(token, Math.log((documents.length + 1) / (frequency + 1)) + 1);
    }
    const queryVector = this.weighted(this.embeddingProvider.embed(query), inverseDocumentFrequency);
    if (queryVector.size === 0) {
      return [];
    }
    const matches: SemanticSearchMatch[] = [];
    for (let index = 0; index < documents.length; index += 1) {
      if (signal?.aborted) {
        throw new Error("Semantic search cancelled");
      }
      const document = documents[index];
      const score = this.cosine(queryVector, this.weighted(documentVectors[index], inverseDocumentFrequency));
      if (score >= LocalSemanticIndex.minimumScore) {
        matches.push({
          path: document.path,
          startLine: document.startLine,
          endLine: document.endLine,
          score
        });
      }
    }
    return matches
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || (left.startLine ?? 0) - (right.startLine ?? 0))
      .slice(0, Math.max(0, limit));
  }

  private key(document: Pick<SemanticDocument, "path" | "startLine" | "endLine">): string {
    return `${document.path}:${document.startLine ?? 0}:${document.endLine ?? 0}`;
  }

  private cachedEmbedding(content: string): Map<string, number> {
    const fingerprint = this.contentFingerprint(content);
    const cached = this.embeddingCache.get(fingerprint);
    if (cached) {
      return cached;
    }
    const embedding = this.embeddingProvider.embed(content);
    this.embeddingCache.set(fingerprint, embedding);
    return embedding;
  }

  private contentFingerprint(content: string): string {
    let first = 2166136261;
    let second = 16777619;
    for (let index = 0; index < content.length; index += 1) {
      const code = content.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ (code + index), 2246822519);
    }
    return `${content.length}:${first >>> 0}:${second >>> 0}`;
  }

  private weighted(vector: Map<string, number>, weights: Map<string, number>): Map<string, number> {
    return new Map([...vector].map(([token, value]) => [token, value * (weights.get(token) ?? 1)]));
  }

  private cosine(left: Map<string, number>, right: Map<string, number>): number {
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (const [token, value] of left) {
      dot += value * (right.get(token) ?? 0);
      leftNorm += value * value;
    }
    for (const value of right.values()) {
      rightNorm += value * value;
    }
    return leftNorm === 0 || rightNorm === 0 ? 0 : dot / Math.sqrt(leftNorm * rightNorm);
  }
}