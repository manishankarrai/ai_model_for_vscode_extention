export const adaptiveLimits = {
  minConfidence: 0.70,
  maxSteps: 2_000,
  maxFiles: 2_000,
  maxChars: 600_000,
  maxAICalls: 250,
  maxToolCalls: 2_000,
  maxSearchResults: 400,
  maxListFiles: 2_000,
  maxFileChars: 48_000,
  limitExpansionFactor: 2,
  maxToolResultsPerDecision: 100,
  maxToolOutputChars: 48_000,
  maxCommandChars: 16_000,
  maxCommandArgs: 200
} as const;
