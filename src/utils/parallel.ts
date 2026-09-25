export async function runBoundedParallel<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  signal?: AbortSignal
): Promise<T[]> {
  if (signal?.aborted) {
    throw new Error("Operation cancelled");
  }

  const results = new Array<T>(tasks.length);
  const workerCount = Math.min(Math.max(1, concurrency), tasks.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      if (signal?.aborted) {
        throw new Error("Operation cancelled");
      }
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) {
        return;
      }
      results[index] = await tasks[index]();
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
