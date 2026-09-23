import type { Intent } from "../models/types.ts";

export interface RetrievalPhase {
  name: string;
  tools: string[];
  purpose: string;
}

export interface RetrievalPlan {
  intent: Exclude<Intent, "auto">;
  phases: RetrievalPhase[];
  stopConditions: string[];
}

export function classifyIntent(
  requested: Intent,
  question: string
): Exclude<Intent, "auto"> {
  if (requested !== "auto") {
    return requested;
  }

  const normalized = question.toLowerCase();
  if (/\b(bug|broken|error|exception|fail|failure|regression|crash|why does)\b/.test(normalized)) {
    return "bug_analysis";
  }
  if (/\b(implement|add|change|fix|modify|refactor|build|create)\b/.test(normalized)) {
    return "implementation";
  }
  if (/\b(architect|architecture|design|boundary|dependenc|flow|structure)\b/.test(normalized)) {
    return "architecture";
  }
  if (/\b(analy[sz]e|investigate|review|trace|understand)\b/.test(normalized)) {
    return "analyze";
  }
  return "chat";
}

export function createRetrievalPlan(
  requested: Intent,
  question: string,
  targetPath?: string
): RetrievalPlan {
  const intent = classifyIntent(requested, question);
  const target = targetPath ? ["read_file_range", "read_symbol"] : ["search", "list_files"];
  const plans: Record<Exclude<Intent, "auto">, RetrievalPhase[]> = {
    chat: [
      { name: "explicit", tools: ["read_file_range", "read_symbol", "search"], purpose: "Answer from selected or directly requested context." }
    ],
    analyze: [
      { name: "target", tools: target, purpose: "Locate the requested subject and its direct implementation." },
      { name: "relationships", tools: ["find_definition", "find_references", "find_callers", "find_callees"], purpose: "Trace nearby dependencies and callers." }
    ],
    bug_analysis: [
      { name: "symptoms", tools: ["get_diagnostics", "git_diff", "search"], purpose: "Start from diagnostics, current changes, and reported failure terms." },
      { name: "target", tools: target, purpose: "Read the failing path and relevant symbols." },
      { name: "verification", tools: ["find_callers", "find_callees", "run_tests"], purpose: "Follow dependencies and verify the suspected failure." }
    ],
    architecture: [
      { name: "map", tools: ["get_project_summary", "list_files", "search"], purpose: "Map project boundaries and major modules." },
      { name: "relationships", tools: ["find_definition", "find_references", "find_callers", "find_callees"], purpose: "Trace interfaces and dependency relationships." },
      { name: "evidence", tools: ["read_file_range", "get_file_summary"], purpose: "Read representative files at identified boundaries." }
    ],
    implementation: [
      { name: "target", tools: target, purpose: "Locate target symbols, files, or the configured implementation root." },
      { name: "impact", tools: ["find_definition", "find_references", "find_callers"], purpose: "Identify interfaces, callers, and affected files before editing." },
      { name: "verification", tools: ["read_file_range", "run_tests", "get_diagnostics", "git_diff"], purpose: "Inspect tests and establish a verification path." }
    ]
  };

  return {
    intent,
    phases: plans[intent],
    stopConditions: [
      "Stop when the question has direct evidence and confidence is above the configured threshold.",
      "Respect maximum steps, files, evidence characters, AI calls, and tool calls.",
      "Do not broaden retrieval after verification is sufficient."
    ]
  };
}

export function formatRetrievalPlan(plan: RetrievalPlan): string {
  const phases = plan.phases
    .map((phase, index) => `${index + 1}. ${phase.name}: ${phase.tools.join(", ")} - ${phase.purpose}`)
    .join("\n");
  return [
    "## Progressive Retrieval Strategy",
    `Intent: ${plan.intent}`,
    "Preferred phases:",
    phases,
    "Stop conditions:",
    plan.stopConditions.map((condition) => `- ${condition}`).join("\n")
  ].join("\n");
}