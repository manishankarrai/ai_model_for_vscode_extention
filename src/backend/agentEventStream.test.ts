import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AgentEventStreamHttpError,
  streamAgentEvents
} from "./agentEventStream.ts";
import type { AgentEvent } from "../models/types.ts";

function responseWithReads(
  reads: Array<IteratorResult<Uint8Array> | Error>
): Response {
  let index = 0;
  const reader = {
    read: async (): Promise<IteratorResult<Uint8Array>> => {
      const next = reads[index++];
      if (next instanceof Error) {
        throw next;
      }
      return next ?? { done: true, value: undefined } as IteratorResult<Uint8Array>;
    },
    releaseLock: () => undefined
  } as ReadableStreamDefaultReader<Uint8Array>;

  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => reader
    }
  } as unknown as Response;
}

function encoded(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function event(type: AgentEvent["type"], message: string): AgentEvent {
  return {
    profile: "coordinator",
    type,
    message,
    timestamp: 1
  };
}

describe("agent event stream", () => {
  it("reconnects after termination and suppresses replayed events", async () => {
    const started = event("started", "Started.");
    const done = event("done", "Done.");
    const responses = [
      responseWithReads([
        { done: false, value: encoded(`data: ${JSON.stringify(started)}\n\n`) },
        new TypeError("terminated")
      ]),
      responseWithReads([
        { done: false, value: encoded(`data: ${JSON.stringify(started)}\n\ndata: ${JSON.stringify(done)}\n\n`) },
        { done: true, value: undefined }
      ])
    ];
    const received: AgentEvent[] = [];
    const delays: number[] = [];
    let fetchCalls = 0;

    await streamAgentEvents({
      url: "https://api.mm3ai.com/api/v1/ai/events?request_id=test",
      accessToken: "token",
      onEvent: (receivedEvent) => received.push(receivedEvent),
      fetchImpl: async () => {
        fetchCalls += 1;
        return responses.shift() as Response;
      },
      sleep: async (delayMs) => delays.push(delayMs)
    });

    assert.deepEqual(received, [started, done]);
    assert.equal(fetchCalls, 2);
    assert.deepEqual(delays, [500]);
  });

  it("does not open or retry an already-aborted stream", async () => {
    const controller = new AbortController();
    controller.abort();
    let fetchCalls = 0;

    await streamAgentEvents({
      url: "https://api.mm3ai.com/api/v1/ai/events?request_id=test",
      accessToken: "token",
      onEvent: () => undefined,
      signal: controller.signal,
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new TypeError("terminated");
      }
    });

    assert.equal(fetchCalls, 0);
  });

  it("does not retry an HTTP error", async () => {
    let fetchCalls = 0;

    await assert.rejects(
      streamAgentEvents({
        url: "https://api.mm3ai.com/api/v1/ai/events?request_id=test",
        accessToken: "token",
        onEvent: () => undefined,
        fetchImpl: async () => {
          fetchCalls += 1;
          return { ok: false, status: 401 } as Response;
        }
      }),
      AgentEventStreamHttpError
    );

    assert.equal(fetchCalls, 1);
  });
});
