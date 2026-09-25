
MM3 CURRENT TASK STATUS
=======================

Last reviewed: 2026-09-25
Source of truth: ../plan_and_track.text

## Current Task

The active MM3 path is a local-first coding agent inside VS Code. It indexes the
workspace, retrieves relevant context, runs bounded tools, calls the backend,
streams canonical lifecycle events, applies approved changes, and verifies the
result.

## Completed And In Use

- `MM3ViewProvider.handleMessage` receives webview commands.
- `MM3ViewProvider.handleQuestion` creates and owns a user task.
- `Agent.process` coordinates local context, planning, adaptive investigation,
  approvals, cancellation, and final response handling.
- `AgentRuntime` owns investigation state, context preparation, branch
  scheduling, specialist policy resolution, metrics, and verification helpers.
- `BackendClient` calls the active backend task, decision, evidence, usage, and
  event endpoints.
- `agentEventStream` consumes SSE, reconnects, deduplicates, and normalizes old
  event names.
- `MM3ViewProvider` renders progress, tool lifecycle, changes, deltas, errors,
  approvals, and final responses.

## Compatibility Paths

- WebSocket event transport is implemented but SSE is the default.
- Older persisted event names remain accepted through normalization.
- Backend `ProcessMultiAgent` remains available as a legacy compatibility path.

## Remaining Work

See the P0, P1, and P2 backlog in `../plan_and_track.text`. The next engineering
priority is authentication and idempotency, followed by Redis restart tests,
cancellation coverage, retrieval benchmarks, and explainable UI state.

## Completion Standard

Do not mark a capability complete until it has an active caller, bounded failure
behavior, redacted metrics, focused tests, and an integration or restart test
when it crosses process, provider, Redis, or persistence boundaries.
    