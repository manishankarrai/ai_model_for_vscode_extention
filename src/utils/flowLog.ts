let seq = 0;

function pad(value: number, size: number): string {
  return String(value).padStart(size, "0");
}

/**
 * Ordered debug log: global sequence, function name, step number.
 * Example: [seq=0042] [Agent.process #03] sending backend request
 */
export function flow(
  fn: string,
  step: number,
  message: string,
  data?: unknown
): void {
  seq += 1;
  const line = `[seq=${pad(seq, 4)}] [${fn} #${pad(step, 2)}] ${message}`;
  if (data === undefined) {
    console.log(line);
    return;
  }
  try {
    console.log(line, JSON.stringify(data));
  } catch {
    console.log(line, "[unserializable]");
  }
}
