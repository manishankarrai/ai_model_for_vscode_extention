export const adaptiveLimits = {
  maxSteps: 48,
  maxFiles: 80,
  maxChars: 600_000,
  maxAICalls: 32,
  maxToolCalls: 160,
  maxSearchResults: 40,
  maxListFiles: 250,
  maxFileChars: 24_000,
  continuationToolCalls: 16,
  continuationAICalls: 8,
  maxContinuationToolCalls: 240,
  maxContinuationAICalls: 40,
  maxToolResultsPerDecision: 20,
  maxToolOutputChars: 24_000,
  maxCommandChars: 4_000,
  maxCommandArgs: 64
} as const;
