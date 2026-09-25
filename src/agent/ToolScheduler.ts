import { runBoundedParallel } from "../utils/parallel.ts";

export class ToolScheduler {
  async run<T>(
    parallel: Array<() => Promise<T>>,
    ordered: Array<() => Promise<T>>,
    concurrency: number,
    signal?: AbortSignal
  ): Promise<T[]> {
    const parallelResults = await runBoundedParallel(parallel, concurrency, signal);
    const orderedResults: T[] = [];
    for (const execute of ordered) {
      if (signal?.aborted) {
        throw new Error("Adaptive investigation cancelled");
      }
      orderedResults.push(await execute());
    }
    return [...parallelResults, ...orderedResults];
  }
}