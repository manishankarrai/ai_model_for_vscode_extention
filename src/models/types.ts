export type Intent =
  | "chat"
  | "analyze"
  | "bug_analysis"
  | "architecture"
  | "implementation";

export type ToolName =
  | "read_file"
  | "search"
  | "list_files";

export type InteractionMode = "ask" | "agent";

export type AgentProfile =
  | "ask"
  | "explorer"
  | "bug"
  | "review"
  | "builder"
  | "test"
  | "architect"
  | "memory"
  | "coordinator";

export interface AgentSelection {
  profile: AgentProfile;
  count: number;
}

export type AgentToolName =
  | "read_file"
  | "search"
  | "list_files"
  | "apply_change_set"
  | "create_file"
  | "delete_file"
  | "rename_file"
  | "move_file"
  | "get_diagnostics"
  | "run_task"
  | "git_diff"
  | "git_status";

export interface ToolRequest {
  tool: AgentToolName;
  path?: string;
  targetPath?: string;
  taskName?: string;
  changes?: CodeChange[];
}

export interface ToolResult {
  tool: AgentToolName;
  success: boolean;
  output: string;
}

export interface ToolPolicy {
  allowed: AgentToolName[];
  approval_required: AgentToolName[];
}

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
  character: number;
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

  evidence: ContextEvidence[];

  parts?: ContextPart[];

}

export type ContextPartKind =
  | "file"
  | "selection"
  | "attachment";

export interface ContextPart {
  kind: ContextPartKind;
  path: string;
  content: string;
  language: string;
  startLine?: number;
  endLine?: number;
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

  maxSteps: number;

  maxFiles: number;

  maxChars: number;

  maxSearchResults: number;

  depth:
    | "shallow"
    | "medium"
    | "deep";
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
  decision:
    AIReasoningDecision;
  implementation_plan?: ImplementationPlan;
  agents?: AgentRun[];
  events?: AgentEvent[];
}

export interface AgentEvent {
  profile: AgentProfile;
  type: "started" | "completed" | "failed" | "synthesizing";
  message: string;
  timestamp: number;
}

export interface AgentTaskStatus {
  request_id: string;
  status: "running" | "completed" | "failed";
  agents: AgentRun[];
  events: AgentEvent[];
  answer?: string;
}

export interface AgentRun {
  profile: AgentProfile;
  status: "completed" | "failed";
  attempts?: number;
  input_tokens: number;
  output_tokens: number;
  error?: string;
}

export interface ImplementationPlan {
  files: string[];
  steps: string[];
  validation: string[];
  risks: string[];
  changes?: CodeChange[];
}

export interface CodeChange {
  path: string;
  original: string;
  updated: string;
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
  mode: InteractionMode;
  tool_policy?: ToolPolicy;
  agent?: AgentSelection;

  project: ProjectContext;

  context: AIContext;

  memory?: string;

  plan?: string[];
  step?: number;
}
export interface InvestigationStep {
  step: number;

  action:
    | "search"
    | "read_file"
    | "follow_symbol"
    | "follow_dependency";

  target: string;

  reason: string;

  files: string[];

  completed: boolean;
}

export interface InvestigationEvidence {
  path: string;

  score: number;

  reason: string;

  content: string;

  symbols: string[];

  dependencies: string[];

  relatedSymbols?: string[];
}

export interface InvestigationResult {
  question: string;

  steps: InvestigationStep[];

  evidence: InvestigationEvidence[];

  filesInvestigated: string[];

  completed: boolean;

  stoppedReason:
    | "completed"
    | "max_steps"
    | "max_files"
    | "max_chars";
}

/*
 * ============================================================
 * Stage 4 — Adaptive AI Reasoning
 * ============================================================
 */

/**
 * Decision returned by the AI backend after evaluating
 * the currently available evidence.
 */
export type AIReasoningDecision =
  | "FINAL_ANSWER"
  | "CONTINUE_INVESTIGATION";


/**
 * Read-only tools that Gemini is allowed to request.
 *
 * IMPORTANT:
 * Gemini does NOT execute these tools directly.
 *
 * Gemini only requests them.
 *
 * The local M3 extension validates and executes them.
 */
export type InvestigationTool =
  | "read_file"
  | "search"
  | "list_files";


/**
 * Tool request generated by the AI backend.
 */
export interface AIToolRequest {

  tool: InvestigationTool;

  args: {

    filePath?: string;

    query?: string;
  };

  reason: string;
}


/**
 * AI decision for the current reasoning cycle.
 */
export interface AIReasoningResponse {

  decision:
    AIReasoningDecision;

  confidence: number;

  reasoning: string;

  toolRequest?: AIToolRequest;

  answer?: string;
}


/**
 * Evidence produced by a locally executed tool.
 *
 * This is sent back to the backend for the next
 * reasoning cycle.
 */
export interface AIToolEvidence {

  tool: InvestigationTool;

  target: string;

  content: string;

  files: string[];

  reason: string;
}


/**
 * One adaptive reasoning cycle.
 */
export interface AIReasoningCycle {

  cycle: number;

  decision:
    AIReasoningDecision;

  confidence: number;

  toolRequest?: AIToolRequest;

  evidence?: AIToolEvidence;

  completed: boolean;
}