export type Intent =
  | "auto"
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

export type ToolApprovalDecision =
  | "approve"
  | "always_approve"
  | "skip";

export type ToolApprovalStatus =
  | ToolApprovalDecision
  | "always_approved";

export type AgentProfile = string;

export interface AgentSelection {
  profile: AgentProfile;
  count: number;
}

export type AgentToolName =
  | "read_file"
  | "read_file_range"
  | "read_symbol"
  | "search"
  | "search_symbols"
  | "list_files"
  | "find_definition"
  | "find_references"
  | "find_callers"
  | "find_callees"
  | "find_tests"
  | "find_routes"
  | "find_reads"
  | "find_writes"
  | "get_file_summary"
  | "get_project_summary"
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
  offset?: number;
  startLine?: number;
  endLine?: number;
  targetPath?: string;
  query?: string;
  symbol?: string;
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
  duration_ms?: number;
  approval?: ToolApprovalStatus;
  path?: string;
  reason?: string;
  error?: string;
}

export interface ToolPolicy {
  allowed: AgentToolName[];
  approval_required: AgentToolName[];
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
  chunkIndex?: number;
  chunkCount?: number;
  byteStart?: number;
  byteEnd?: number;
  totalBytes?: number;
  hasMore?: boolean;
  startLine?: number;
  endLine?: number;
  totalLines?: number;
  remainingLines?: number;
  compressed?: boolean;
}
export interface ContextEvidence {

  path: string;

  score: number;

  reason: string;

  matchedSymbols: string[];

  matchedTerms: string[];

}

export interface ContextManifest {
  version: 1;
  estimatedTokens: number;
  availableTokens: number;
  reservedTokens: number;
  entries: Array<{
    path: string;
    kind: "file" | "part";
    status: "included" | "omitted" | "deduplicated" | "compressed";
    estimatedTokens: number;
    reason: string;
  }>;
  cacheHit?: boolean;
}


export interface AIContext {

  files: ContextFile[];

  indexSummary: string;

  evidence: ContextEvidence[];

  orchestration?: RetrievalOrchestration;

  taskMemory?: TaskMemory;

  parts?: ContextPart[];

  manifest?: ContextManifest;

  runtimeMetrics?: RuntimeMetricSnapshot;

}

export interface RuntimeMetricSnapshot {
  counters: Record<string, number>;
  durations: Record<string, number>;
  gauges?: Record<string, number>;
}

export interface RetrievalOrchestration {
  version: 1;
  intent: Exclude<Intent, "auto">;
  phases: Array<{
    name: string;
    tools: string[];
    purpose: string;
  }>;
  stopConditions: string[];
  branches?: RetrievalBranch[];
}

export interface RetrievalBranch {
  id: string;
  phase: string;
  tools: string[];
  purpose: string;
  parallelizable: boolean;
}

export interface TaskMemory {
  findings: string[];
  openQuestions: string[];
  verification: {
    required: boolean;
    completed: boolean;
    lastResult?: string;
  };
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
  chunkIndex?: number;
  chunkCount?: number;
  byteStart?: number;
  byteEnd?: number;
  totalBytes?: number;
  hasMore?: boolean;
}

export interface ProjectContext {
  id: string;
  name: string;
  indexVersion: number;
  targetPath?: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export const MAX_CONVERSATION_HISTORY = 30;


export interface InvestigationPlan {
  steps: string[];

  tools: AgentToolName[];

  maxSteps: number;

  maxFiles: number;

  maxChars: number;

  maxSearchResults: number;

  maxAICalls: number;

  maxToolCalls: number;

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

  findings: string[];

  openQuestions: string[];
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
    intent?: Exclude<Intent, "auto">;
    action: AIReasoningDecision;
    answer?: string;
    confidence: number;
    reason?: string;
    tool?: ToolRequest;
    tools?: ToolRequest[];
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
  type:
    | "agent.started"
    | "agent.completed"
    | "agent.failed"
    | "agent.synthesizing"
    | "agent.progress"
    | "change.applied"
    | "tool.started"
    | "tool.completed"
    | "tool.failed"
    | "response.delta"
    | "response.completed"
    | "citation.created"
    | "quality.recorded"
    | "started"
    | "completed"
    | "failed"
    | "synthesizing"
    | "progress"
    | "change"
    | "token"
    | "provider_delta"
    | "citation"
    | "quality"
    | "done";
  request_id?: string;
  message: string;
  timestamp: number;
  latency_ms?: number;
  duration_ms?: number;
  tool?: string;
  success?: boolean;
  delta?: string;
  path?: string;
  quote?: string;
  start_line?: number;
  end_line?: number;
  confidence?: number;
}

export function normalizeAgentEvent(event: AgentEvent): AgentEvent {
  const typeMap: Record<string, AgentEvent["type"]> = {
    started: "agent.started",
    completed: "agent.completed",
    failed: "agent.failed",
    synthesizing: "agent.synthesizing",
    progress: "agent.progress",
    change: "change.applied",
    token: "response.delta",
    provider_delta: "response.delta",
    citation: "citation.created",
    quality: "quality.recorded",
    done: "response.completed"
  };
  const normalizedType = typeMap[event.type] ?? event.type;
  return normalizedType === event.type ? event : { ...event, type: normalizedType };
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
  input_cache_hit_tokens?: number;
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

export interface CheapestBillingAgent {
  id: string;
  name: string;
  model: string;
  category: string;
  input_cost_per_1m: number;
  output_cost_per_1m: number;
  combined_cost_per_1m: number;
  peak: boolean;
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

  memory?: string;

  conversation_history?: ConversationMessage[];

  plan?: string[];
  step?: number;
  tool_results?: ToolResult[];
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