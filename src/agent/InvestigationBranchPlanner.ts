import type { RetrievalBranch } from "../models/types.ts";
import type { RetrievalPlan } from "../intelligence/progressiveRetrieval.ts";

const PARALLEL_TOOLS = new Set([
  "read_file", "read_file_range", "read_symbol", "search", "search_symbols",
  "list_files", "find_definition", "find_references", "find_callers",
  "find_callees", "find_tests", "find_routes", "find_reads", "find_writes",
  "get_file_summary", "get_project_summary", "get_diagnostics", "git_status", "git_diff"
]);

export class InvestigationBranchPlanner {
  create(plan: RetrievalPlan): RetrievalBranch[] {
    return plan.phases.map((phase, index) => ({
      id: `${index + 1}-${phase.name}`,
      phase: phase.name,
      tools: [...phase.tools],
      purpose: phase.purpose,
      parallelizable: phase.tools.every((tool) => PARALLEL_TOOLS.has(tool))
    }));
  }
}