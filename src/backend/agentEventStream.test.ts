import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AgentEventStreamHttpError,
  streamAgentEvents
} from "./agentEventStream.ts";
import { normalizeAgentEvent, type AgentEvent } from "../models/types.ts";

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

function event(type: AgentEvent["type"], message: string, latency_ms?: number): AgentEvent {
  return {
    profile: "coordinator",
    type,
    message,
    timestamp: 1,
    ...(latency_ms === undefined ? {} : { latency_ms })
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

    assert.deepEqual(received, [
      { ...started, type: "agent.started" },
      { ...done, type: "response.completed" }
    ]);
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

  it("preserves lifecycle latency fields from SSE events", async () => {
    const token = event("token", "answer", 42);
    const done = event("done", "complete", 100);
    const received: AgentEvent[] = [];

    await streamAgentEvents({
      url: "https://api.mm3ai.com/api/v1/ai/events?request_id=timing",
      accessToken: "token",
      onEvent: (receivedEvent) => received.push(receivedEvent),
      fetchImpl: async () => responseWithReads([
        { done: false, value: encoded(`data: ${JSON.stringify(token)}\n\ndata: ${JSON.stringify(done)}\n\n`) },
        { done: true, value: undefined }
      ])
    });

    assert.equal(received[0]?.latency_ms, 42);
    assert.equal(received[1]?.latency_ms, 100);
  });

  it("normalizes legacy event names without changing canonical events", () => {
    assert.equal(normalizeAgentEvent(event("provider_delta", "chunk")).type, "response.delta");
    assert.equal(normalizeAgentEvent(event("done", "done")).type, "response.completed");
    const canonical = event("tool.completed", "finished");
    assert.strictEqual(normalizeAgentEvent(canonical), canonical);
  });
});
