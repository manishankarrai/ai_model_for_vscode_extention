export type Intent =
  | "chat"
  | "analyze"
  | "bug_analysis"
  | "architecture";

export type ToolName =
  | "read_file"
  | "search"
  | "list_files";

export interface ProjectFile {
  path: string;
  absolutePath: string;
  size: number;
  language: string;
  hash: string;
  modifiedAt: number;
}

export interface SymbolInfo {
  name: string;
  kind: string;
  filePath: string;
  line: number;
}

export interface DependencyInfo {
  source: string;
  target: string;
  type: "import" | "require" | "package" | "reference";
}

export interface IndexedFile {
  file: ProjectFile;
  symbols: SymbolInfo[];
  dependencies: DependencyInfo[];
}

export interface ProjectIndex {
  rootPath: string;
  version: number;

  files: Map<string, IndexedFile>;

  symbols: SymbolInfo[];

  dependencies: DependencyInfo[];

  createdAt: number;
  updatedAt: number;
}

export interface SearchResult {

  path: string;

  score: number;

  matches: number;

  reason: string;

  matchedSymbols?: string[];

  matchedTerms?: string[];

}

export interface ContextFile {
  path: string;
  content: string;
}
export interface ContextEvidence {

  path: string;

  score: number;

  reason: string;

  matchedSymbols: string[];

  matchedTerms: string[];

}

export interface AIContext {
  files: ContextFile[];
  indexSummary: string;
}
export interface AIContext {

  files: ContextFile[];

  indexSummary: string;

  evidence: ContextEvidence[];

}

export interface ProjectContext {
  id: string;
  name: string;
  indexVersion: number;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface InvestigationPlan {
  steps: string[];
  tools: ToolName[];
}

export interface TaskState {
  requestId: string;
  question: string;
  intent: Intent;
  status:
    | "idle"
    | "planning"
    | "investigating"
    | "sending"
    | "completed"
    | "failed";

  startedAt: number;
  completedAt?: number;

  filesUsed: string[];

  aiCalls: number;
}


export interface AIResponse {
  request_id: string;
  action: Intent;
  answer: string;
  model: string;
  usage: AIUsage;
}

export interface AIUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  ai_api_calls: number;
  estimated_cost: number;
}

export interface AIRequest {
  action: Intent;
  request_id: string;
  question: string;

  project: ProjectContext;

  context: AIContext;

  plan?: string[];
}