import { adaptiveLimits } from "../config/adaptiveLimits.ts";

export function hasSufficientAdaptiveConfidence(
  confidence: number,
  threshold = adaptiveLimits.minConfidence
): boolean {
  return Number.isFinite(confidence) && confidence > threshold;
}