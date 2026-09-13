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

export type AgentProfile = string;

export interface AgentSelection {
  profile: AgentProfile;
}

export type AgentToolName =
  | "read_file"
  | "search"
  | "list_files"
  | "apply_change_set"
  | "apply_patch"
  | "create_file"
  | "write_file"
  | "edit_file"
  | "delete_file"
  | "rename_file"
  | "move_file"
  | "get_diagnostics"
  | "run_task"
  | "run_command"
  | "run_tests"
  | "git_diff"
  | "git_status";

export interface ToolRequest {
  tool: AgentToolName;
  path?: string;
  targetPath?: string;
  query?: string;
  command?: string;
  content?: string;
  original?: string;
  updated?: string;
  taskName?: string;
  reason?: string;
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

export type DependencyEditPolicy =
  | "selected-only"
  | "selected-plus-required-dependencies";

export type SelectionScope =
  | "workspace"
  | "selection"
  | "full-file";

export interface TaskContract {
  requestId: string;
  intent: Intent;
  selectedPaths: string[];
  selectedRanges: Array<{
    path: string;
    startLine?: number;
    endLine?: number;
  }>;
  selectionScope: SelectionScope;
  requiredDependencyPaths: string[];
  dependencyEvidence: DependencyEvidence[];
  allowedEditPaths: string[];
  dependencyEditPolicy: DependencyEditPolicy;
  acceptanceCriteria: string[];
  validationCommands: string[];
}

export interface DependencyEvidence {
  sourcePath: string;
  sourceSymbols: string[];
  targetPath: string;
  targetSymbols: string[];
  reason: string;
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

  tools: AgentToolName[];

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
  mode: InteractionMode;
  agentProfile: AgentProfile;
  status:
    | "idle"
    | "planning"
    | "investigating"
    | "sending"
    | "completed"
    | "failed"
    | "cancelled";

  startedAt: number;
  completedAt?: number;

  filesUsed: string[];

  aiCalls: number;

  lastStep?: number;

  checkpointContext?: ContextFile[];

  checkpoints?: InvestigationCheckpoint[];

  contract?: TaskContract;

  validation: string[];

  lastError?: string;
}

export interface InvestigationCheckpoint {
  step: number;
  kind: "decision" | "tool" | "validation";
  action?: string;
  tool?: string;
  path?: string;
  success?: boolean;
  summary?: string;
}


export interface Citation {
  path: string;
  quote?: string;
  reason?: string;
  start_line?: number;
  end_line?: number;
}

export interface QualityMetrics {
  groundedness: number;
  file_selection: number;
  tool_efficiency: number;
  answer_quality: number;
  latency_ms: number;
  fallback_used: boolean;
  fallback_model?: string;
  cited_files: number;
  context_files: number;
  recovery_score?: number;
}

export interface AIResponse {
  request_id: string;
  action: Intent;
  answer: string;
  model: string;
  usage: AIUsage;
  decision?: {
    action: AIReasoningDecision;
    answer?: string;
    confidence: number;
    reason?: string;
    citations?: Citation[];
  };
  implementation_plan?: ImplementationPlan;
  agents?: AgentRun[];
  events?: AgentEvent[];
  citations?: Citation[];
  quality?: QualityMetrics;
}

export interface AgentEvent {
  profile: AgentProfile;
  type: "started" | "completed" | "failed" | "synthesizing" | "progress" | "token" | "citation" | "quality" | "done";
  message: string;
  timestamp: number;
  delta?: string;
  path?: string;
  quote?: string;
  start_line?: number;
  end_line?: number;
  confidence?: number;
}

export interface AgentTaskStatus {
  request_id: string;
  status: "running" | "completed" | "failed";
  agents: AgentRun[];
  events: AgentEvent[];
  answer?: string;
  feedback?: TaskFeedback[];
  evaluation?: TaskEvaluation;
}

export interface TaskFeedback {
  rating: number;
  category?: string;
  comment?: string;
  created_at?: string;
}

export interface TaskEvaluation {
  feedback_count: number;
  average_rating: number;
  positive_count: number;
  positive_rate: number;
  updated_at?: string;
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
  charged_credits?: number;
  wallet_balance?: number;
  agent_id?: string;
}

export interface BillingAgent {
  id: string;
  name: string;
  description?: string;
  category?: string;
  model?: string;
  active: boolean;
  input_cost_per_1m: number;
  output_cost_per_1m: number;
}

export interface CreditPlan {
  id: string;
  name: string;
  credits: number;
  price: number;
  currency: string;
  active: boolean;
}

export interface WalletSummary {
  balance: number;
  unit: string;
  ledger?: Array<{
    type: string;
    amount: number;
    balance_after: number;
    note?: string;
  }>;
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

  task_contract?: TaskContract;

  memory?: string;

  plan?: string[];

  validation?: string[];

  checkpoints?: InvestigationCheckpoint[];
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


export type InvestigationTool = AgentToolName;

/**
 * Tool request generated by the AI backend.
 * The extension validates and executes it locally.
 */
export interface AIToolRequest {
  tool: InvestigationTool;
  path?: string;
  targetPath?: string;
  target_path?: string;
  query?: string;
  command?: string;
  content?: string;
  original?: string;
  updated?: string;
  taskName?: string;
  task_name?: string;
  reason?: string;
  changes?: CodeChange[];
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