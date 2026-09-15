export const adaptiveLimits = {
  maxSteps: 1000,
  maxFiles: 500,
  maxChars: 5_000_000,
  maxAICalls: 1000,
  maxToolCalls: 5000,
  maxSearchResults: 100,
  maxListFiles: 500,
  maxFileChars: 5_000_000,
  continuationToolCalls: 5000,
  continuationAICalls: 1000,
  maxContinuationToolCalls: 50_000,
  maxContinuationAICalls: 10_000,
  maxToolResultsPerDecision: 100,
  maxToolOutputChars: 100_000
} as const;
