import assert from "node:assert/strict";
import test from "node:test";

import { runBoundedParallel } from "./parallel.ts";

test("runBoundedParallel preserves task order and respects concurrency", async () => {
  let active = 0;
  let maximumActive = 0;
  const results = await runBoundedParallel(
    Array.from({ length: 6 }, (_, index) => async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return index;
    }),
    2
  );

  assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
  assert.equal(maximumActive <= 2, true);
});

test("runBoundedParallel stops queued work after cancellation", async () => {
  const controller = new AbortController();
  const executed: number[] = [];

  await assert.rejects(
    runBoundedParallel([
      async () => {
        executed.push(1);
        controller.abort();
        return 1;
      },
      async () => {
        executed.push(2);
        return 2;
      }
    ], 1, controller.signal),
    /cancelled/
  );

  assert.deepEqual(executed, [1]);
});
