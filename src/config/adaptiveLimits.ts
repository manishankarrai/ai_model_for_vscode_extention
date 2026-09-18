export const adaptiveLimits = {
  minConfidence: 0.70,
  maxSteps: 96,
  maxFiles: 80,
  maxChars: 600_000,
  maxAICalls: 64,
  maxToolCalls: 320,
  maxSearchResults: 40,
  maxListFiles: 250,
  maxFileChars: 24_000,
  limitExpansionFactor: 2,
  maxToolResultsPerDecision: 20,
  maxToolOutputChars: 24_000,
  maxCommandChars: 4_000,
  maxCommandArgs: 64
} as const;
