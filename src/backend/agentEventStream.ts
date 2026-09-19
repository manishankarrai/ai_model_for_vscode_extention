import type { AgentEvent } from "../models/types.ts";

export class AgentEventStreamHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Agent event stream returned HTTP ${status}.`);
    this.name = "AgentEventStreamHttpError";
    this.status = status;
  }
}

export interface AgentEventStreamOptions {
  url: string;
  accessToken: string;
  onEvent: (event: AgentEvent) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  maxReconnects?: number;
  reconnectDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

const defaultMaxReconnects = 3;
const defaultReconnectDelayMs = 500;

export async function streamAgentEvents(
  options: AgentEventStreamOptions
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxReconnects = options.maxReconnects ?? defaultMaxReconnects;
  const reconnectDelayMs = options.reconnectDelayMs ?? defaultReconnectDelayMs;
  const sleep = options.sleep ?? wait;
  const seenEvents = new Set<string>();
  let reconnects = 0;

  while (true) {
    if (options.signal?.aborted) {
      return;
    }

    try {
      const response = await fetchImpl(
        options.url,
        {
          headers: { Authorization: `Bearer ${options.accessToken}` },
          signal: options.signal
        }
      );

      if (!response.ok) {
        throw new AgentEventStreamHttpError(response.status);
      }
      if (!response.body) {
        throw new Error("Agent event stream did not include a response body.");
      }

      const completed = await consumeEventStream(
        response.body,
        options.onEvent,
        seenEvents,
        options.signal
      );
      if (completed || options.signal?.aborted) {
        return;
      }

      throw new Error("Agent event stream ended before completion.");
    } catch (error) {
      if (options.signal?.aborted) {
        return;
      }
      if (error instanceof AgentEventStreamHttpError || reconnects >= maxReconnects) {
        throw error;
      }

      reconnects += 1;
      await sleep(reconnectDelayMs * 2 ** (reconnects - 1));
    }
  }
}

async function consumeEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AgentEvent) => void,
  seenEvents: Set<string>,
  signal?: AbortSignal
): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        return false;
      }

      buffer += decoder.decode(chunk.value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (!data) {
          continue;
        }

        const event = JSON.parse(data.slice(6)) as AgentEvent;
        const key = eventKey(event);
        if (seenEvents.has(key)) {
          continue;
        }
        seenEvents.add(key);
        onEvent(event);
        if (event.type === "done") {
          return true;
        }
      }

      if (signal?.aborted) {
        return true;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function eventKey(event: AgentEvent): string {
  return JSON.stringify([
    event.profile,
    event.type,
    event.message,
    event.timestamp,
    event.delta,
    event.path,
    event.quote,
    event.start_line,
    event.end_line,
    event.confidence
  ]);
}

async function wait(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
