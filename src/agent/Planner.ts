import type { Intent } from "../models/types.ts";
import {
  createRetrievalPlan,
  formatRetrievalPlan,
  type RetrievalPlan
} from "../intelligence/progressiveRetrieval.ts";

export class Planner {
  create(requested: Intent, question: string, targetPath?: string): RetrievalPlan {
    return createRetrievalPlan(requested, question, targetPath);
  }

  format(plan: RetrievalPlan): string {
    return formatRetrievalPlan(plan);
  }
}