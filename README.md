# MM3 Development Roadmap

## Current Development Stage

**Stage 14 — Billing and Plans**

Status: WALLET CREDITS AND DYNAMIC AGENTS IMPLEMENTED in the extension and backend.

The system now supports a local adaptive reasoning loop in which Gemini can request additional read-only evidence, MM3 validates and executes the tool locally, and the loop continues until a final answer or a hard stop condition is reached.

### Current Pipeline

```text
User Question
     │
     ▼
   Local Agent
     │
     ├── Intent Detection
     ├── Planning
     ├── Tool Selection
     ▼
Project Intelligence
     │
     ├── Project Scanner
     ├── Incremental Index
     ├── Symbol Index
     ├── Dependency Detection
     ├── Search Engine
     ├── Relevance Ranking
     ├── Context Builder
     └── Context Compression
     │
     ▼
Investigation State
     │
     ▼
Backend / Gemini
     │
     ├── FINAL_ANSWER
     │
     └── CONTINUE_INVESTIGATION
            │
            ▼
        Tool Gateway
            │
            ├── read_file
            ├── search
            └── list_files
            │
            ▼
        New Evidence
            │
            ▼
        Repeat until stop
```

### Important Principle

MM3 must **NOT** expose direct filesystem access to Gemini.

Instead:

```text
Gemini
   │
   ▼
Structured tool request
   │
   ▼
MM3 validation + safety checks
   │
   ▼
Local read-only tool execution
   │
   ▼
Evidence returned to Gemini
```

This preserves the local-first, privacy-safe architecture while enabling adaptive investigation.

---

# MM3 Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    MM3 VS CODE EXTENSION                     │
│                  LOCAL-FIRST INVESTIGATION                  │
│                                                             │
│  ┌──────────────── PROJECT INTELLIGENCE ─────────────────┐  │
│  │ File Scanner                                            │  │
│  │ Incremental Index                                       │  │
│  │ Symbol Index                                            │  │
│  │ Dependency Detection                                     │  │
│  │ Search Engine                                           │  │
│  │ Relevance Ranking                                       │  │
│  │ Context Builder                                         │  │
│  │ Context Compression                                     │  │
│  │ Investigation State                                     │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌────────────────── LOCAL AGENT ───────────────────────┐  │
│  │ Intent Detection                                      │  │
│  │ Planning                                              │  │
│  │ Tool Selection                                        │  │
│  │ Adaptive Investigation Loop                           │  │
│  │ Read-only Tool Gateway                                │  │
│  │ Safety Validation                                     │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Read-only Safety Layer                                    │
│  Token & Latency Tracking                                  │
│  Investigation Logs                                       │
│  Stop / Retry / Loop Detection                             │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                       MM3 BACKEND                            │
│                   TRUSTED AI ORCHESTRATOR                  │
│                                                             │
│  ┌──────────────────── AI ENGINE ────────────────────────┐ │
│  │ Gemini reasoning                                        │ │
│  │ Decision protocol                                      │ │
│  │ Structured investigation response                      │ │
│  │ Evidence evaluation                                    │ │
│  │ Confidence scoring                                     │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

# MM3 Development Stages

```text
Stage 1
Foundation
   │
   ▼
Stage 2
Reliable Project Understanding
   │
   ▼
Stage 3
Deep Local Investigation
   │
   ▼
Stage 4
Adaptive AI Reasoning
   │
   ▼
Stage 5
Persistent Project Memory
   │
   ▼
Stage 6
Advanced Coding Agent
   │
   ▼
Stage 7
Safe Code Modification
   │
   ▼
Stage 8
Copilot-Level MM3
```

---

# Stage 1 — Foundation

**Status: COMPLETE**

The local project intelligence pipeline is in place and verified:

- project scanning
- incremental indexing
- symbol discovery
- dependency detection
- search and relevance ranking
- context building
- backend communication
- Gemini integration

---

# Stage 2 — Reliable Project Understanding

**Status: COMPLETE**

The project model and local intelligence pieces are stable enough to support adaptive investigation.

---

# Stage 3 — Deep Local Investigation

**Status: COMPLETE**

The system includes the local investigation and evidence-building groundwork expected before adaptive reasoning.

---

# Stage 4 — Adaptive AI Reasoning

**Status: COMPLETE**

Implemented and verified in the current codebase.

### Included features

```text
InvestigationState
AI structured decision protocol
Tool request protocol
Local read-only tool gateway
Adaptive investigation loop
Multiple AI calls / tool calls
Investigation limits
Loop detection
Evidence tracking
Confidence tracking
Stopping conditions
Token / latency awareness
Detailed investigation logs
Final answer generation
Read-only safety verification
```

### Key architectural rule

```text
Gemini = reasoning engine
MM3 = authority over local access and stopping logic
```

Gemini may request tools, but MM3 validates, executes, and enforces the investigation guardrails.

---

# Stage 5 — Persistent Project Memory

**Status: FOUNDATION IMPLEMENTED**

The project now includes a two-sided persistent project-memory foundation. The extension stores project intelligence in workspace state and sends a memory snapshot with AI requests. The backend accepts that snapshot, includes it in planning and adaptive reasoning, and persists completed-answer history in MongoDB with Redis caching.

### Included features

```text
ProjectMemory
Workspace persistence
Project summary build
Finding capture
Dependency tracking
Convention tracking
Memory snapshot access
Memory included in AI requests
Backend memory-aware planning and reasoning
Backend MongoDB/Redis answer history
```

---

# Current Roadmap Position

```text
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  STAGE 1  ████████████████████  COMPLETE                  │
│                                                             │
│  STAGE 2  ████████████████████  COMPLETE                  │
│                                                             │
│  STAGE 3  ████████████████████  COMPLETE                  │
│                                                             │
│  STAGE 4  ████████████████████  COMPLETE                  │
│                                                             │
│  STAGE 5  FOUNDATION IMPLEMENTED                           │
│                                                             │
│  STAGE 6  IMPLEMENTATION PLANNING FOUNDATION               │
│                                                             │
│  STAGE 7  APPROVAL-GATED FOUNDATION IMPLEMENTED            │
│                                                             │
│  STAGE 8  CONTEXT FOUNDATION IMPLEMENTED                    │
│                                                             │
│  STAGE 9  ASK AND AGENT MODES FOUNDATION IMPLEMENTED       │
│                                                             │
│  STAGE 10 SELECTABLE MULTI-AGENT FOUNDATION IMPLEMENTED    │
│                                                             │
│  STAGE 12 STREAMING, QUALITY, AND EVALUATION COMPLETE     │
│                                                             │
│  STAGE 13 PRODUCTION SAFETY AND RECOVERY COMPLETE          │
│                                                             │
│  STAGE 14 CURRENT: BILLING, WALLET, AND AGENT CATALOG      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Development Rule

At every stage:

```text
Implement
   ↓
Build
   ↓
Test
   ↓
Debug
   ↓
Verify
   ↓
Update roadmap
   ↓
Move to next stage
```

---

# Copilot-Level Product Roadmap

```text
Stage 8
Context Selection and Attachments
   ↓
Stage 9
Ask and Agent Modes
   ↓
Stage 10
Selectable Multi-Agent Workspace
   ↓
Stage 11
Backend Agent Orchestration
   ↓
Stage 12
Streaming, Quality, and Evaluation
   ↓
Stage 13
Production Safety and Recovery
   ↓
Stage 14
Billing and Plans (last)
```

The product should complete Stages 8 through 13 before billing work begins. Each stage must be implemented in the extension and backend where the behavior crosses the API boundary.

# Stage 6 — Advanced Coding Agent

**Status: IMPLEMENTATION PLANNING FOUNDATION IMPLEMENTED**

The first Stage 6 capability is available on both sides. The extension detects implementation requests and investigates owning modules, symbols, dependencies, and validation paths. The backend uses an implementation-specific reasoning mode to produce ordered, evidence-based coding plans while preserving the read-only boundary.

### Included features

```text
Implementation intent detection
Deep implementation investigation plan
Exact file and symbol impact guidance
Validation and test planning
Implementation risks and assumptions
Backend adaptive evidence checks
No write, delete, or command execution access
```

The next Stage 6 increment is richer code review and patch quality analysis.

# Stage 7 — Safe Code Modification

**Status: APPROVAL-GATED FOUNDATION IMPLEMENTED**

MM3 can now apply exact code changes only after explicit user approval. Gemini supplies complete original and updated file contents; the extension validates workspace-relative paths, rejects oversized or stale changes, applies the approved edits atomically, and saves the files. No automatic modification is permitted.

### Included features

```text
Structured old/new file changes
Workspace boundary validation
Stale-file detection
Explicit modal approval
Atomic WorkspaceEdit application
Automatic save after approval
Diff preview before approval
Rollback of the last approved change set
Rollback stale-file protection
```

Richer review tooling and broader modification policies remain future Stage 7 work.

## Stage 8 - Context Selection and Attachments

**Status: FOUNDATION IMPLEMENTED**

**Goal:** Let users control exactly what MM3 sees.

Extension work:

- Attach the active file, selected editor text, selected Explorer files, and multiple pasted or dropped files.
- Show removable attachment chips with path, language, size, and token estimate.
- Send selection ranges and file snapshots as explicit context parts.
- Preserve context per conversation and allow it to be cleared independently.
- Apply sensitive-file filtering before anything leaves the workspace.

Implemented foundation:

- Active editor context is captured automatically for each request.
- A non-empty editor selection is sent as exact selected text with line metadata.
- Multiple files can be attached through the VS Code file picker.
- Pasted text can be attached explicitly to the next question.
- Context parts can be removed individually or cleared with the conversation.
- Attached scope is shown in the chat view.
- Context chips show source kind, path, and estimated tokens.
- Context parts are typed and validated independently by the backend.

Backend work:

- Add typed context parts for files, selections, and attachments.
- Validate limits per part and for the complete request.
- Preserve source metadata so answers cite the exact file and selection.
- Keep secrets and ignored files blocked server-side as a second safety boundary.

Acceptance criteria: users can ask about only highlighted code or selected files, and MM3 never silently expands that context.

Completed Stage 8 follow-up: drag-and-drop files and durable workspace-backed conversation/context history.

## Stage 9 - Ask and Agent Modes

**Status: FOUNDATION IMPLEMENTED**

**Goal:** Make interaction behavior predictable.

Ask mode only answers using supplied context and memory. It cannot investigate, request tools, modify files, execute commands, or perform automatic follow-up actions. It must clearly state when context is insufficient.

Agent mode can investigate with approved read-only tools, produce implementation plans and diffs, and offer changes only through the approval and rollback workflow. The UI must show the active mode, current step, tools used, and stop reason.

Backend work:

- Add a typed mode field and enforce mode permissions on every request.
- Use separate prompts, tool policies, budgets, and response schemas for Ask and Agent.
- Reject Agent-only capabilities in Ask mode.

Acceptance criteria: Ask mode only answers; Agent mode is the only mode allowed to investigate or propose changes.

Implemented foundation:

- The composer provides explicit Ask and Agent modes.
- Ask mode skips local search and investigation and sends only explicit context and memory.
- The backend validates the mode and rejects invalid values.
- The backend rejects adaptive tool requests made during Ask mode.

## Permission-Controlled Tool Foundation

Before multi-agent orchestration, MM3 now has a typed local tool registry shared by the Agent contract and backend policy model.

Implemented tools:

```text
read_file          Existing read-only file access
search             Existing indexed search
list_files         Existing project listing
get_diagnostics    Workspace diagnostics inspection
git_diff           Fixed-argument workspace Git diff
git_status         Workspace Git status
run_task           Allowlisted VS Code task execution
apply_change_set   Reviewed old/new file changes
create_file        Approval-gated file creation
delete_file        Approval-gated file deletion
rename_file        Approval-gated rename
move_file          Approval-gated move
```

Permission rules:

- Ask mode exposes no tools and the backend rejects enabled tools or tool requests.
- Agent mode can inspect files, diagnostics, and Git state.
- Tasks and all mutations require explicit approval.
- Paths are workspace-bound and sensitive paths are rejected.
- Git operations use fixed arguments, a timeout, and bounded output; commit and push are not available.

The registry is the single local execution boundary. Gemini can request capabilities through typed contracts, but it never receives direct filesystem, terminal, or Git process access.

## Stage 10 - Selectable Multi-Agent Workspace

**Status: FOUNDATION IMPLEMENTED**

**Goal:** Let users choose how many specialist agents collaborate.

Agent catalog:

```text
Ask Agent          Direct answer and explanation
Explorer Agent     Files, symbols, and dependency discovery
Bug Agent          Root-cause and regression analysis
Review Agent       Correctness, security, and performance review
Builder Agent      Implementation plan and patch proposal
Test Agent         Test design and failure analysis
Architect Agent    Module boundaries and system design
Memory Agent       Project facts, decisions, and conventions
Coordinator        Selects, schedules, and merges specialist results
```

Extension work:

- Let users choose named agents or use Coordinator selection.
- Show each agent status, evidence, answer, confidence, and failures.
- Support cancel, retry, and partial results.

Backend work:

- Run independent investigations in parallel where safe, then merge through Coordinator.
- Give every agent a role prompt, internally managed context limit, tool policy, timeout, and trace ID.
- Deduplicate overlapping searches and repeated tool requests.

Acceptance criteria: users can choose one or several agents, the Coordinator returns one grounded answer, and a failed specialist does not erase successful results.

Implemented foundation:

- The composer provides specialist profile selection; execution limits remain internal.
- Ask mode is normalized to one Ask agent and cannot enable specialist tools.
- Agent profile and tool policy are sent through the typed client/backend contract.
- The backend owns specialist execution and context limits and adds role-aware instructions to Gemini prompts.

Implemented orchestration foundation:

- Coordinator requests with more than one Agent run bounded specialist calls in parallel.
- Specialist reports are merged into one Coordinator answer.
- Failed specialists are logged and excluded when other specialists succeed.
- Usage totals and project memory are recorded for the complete multi-agent request.

Completed Stage 10 follow-up: internally managed specialist execution and deduplicated specialist evidence.

## Stage 11 - Backend Agent Orchestration

**Status: FOUNDATION IMPLEMENTED**

**Goal:** Make multi-agent behavior reliable across client and server.

- Version request and response schemas.
- Add agent capabilities, model selection, context budgets, and maximum parallelism.
- Propagate cancellation and deadlines from VS Code to Gemini calls.
- Stream structured events for planning, tool requests, agent completion, and final synthesis.
- Keep local filesystem access in the extension; the backend may request tools but never execute them.
- Store resumable task state and compact traces without retaining raw sensitive context unnecessarily.
- Make memory updates explicit and attributable to an agent and request.

Implemented foundation:

- Bounded specialist calls run concurrently for Coordinator requests.
- Specialist failures are returned as structured run telemetry while successful results continue.
- Failed specialists receive one bounded automatic retry unless the request is canceled.
- Coordinator synthesis produces one final answer from available specialist reports.
- Per-agent status and token usage are returned to and rendered by the extension.
- Specialist lifecycle and Coordinator synthesis events are returned as a structured orchestration trace.
- Authenticated SSE streams specialist lifecycle events to the extension while a request is running.
- Request cancellation propagates through the backend context to Gemini calls.

Implemented control foundation:

- The chat UI can cancel an active request.
- Abort signals propagate from the webview to extension fetch and backend Gemini calls.
- The last question and agent configuration can be retried without losing selected context.
- The webview receives live specialist and Coordinator events before the final answer.
- Failed specialists expose direct Retry actions in the chat.
- Retry reuses the retained typed request and selected context without rerunning healthy specialists.
- Multi-agent task status is persisted without storing raw source context.
- Authenticated clients can reload a task by request ID.
- Authenticated clients can retry one failed specialist with the original typed context.
- The Agent reloads persisted task events when the live SSE stream is unavailable.
- Replayed events use the same webview trace as live events.

Completed Stage 11 follow-up: bounded retry history and persisted resumable answer state.

## Stage 12 - Streaming, Quality, and Evaluation

**Status: QUALITY PRODUCTIZATION IMPLEMENTED**

**Goal:** Make MM3 feel fast and measurably intelligent.

Implemented foundation:

- Live agent events stream to the webview while a request is running.
- Token and citation events are surfaced in the chat UI as streaming progress.
- Final answer payloads include citations and quality metrics for groundedness and answer quality.
- The UI renders a summary of citations and quality scores alongside the answer.
- The backend already emits quality and citation events, with compact retention for task history.

Implemented quality productization:

- Exact quoted snippets with 1-based line ranges and citation fallback when a path is missing.
- Expandable, clickable evidence blocks that open the cited file at the attributed range.
- Validation checks, proposed diffs, and confidence shown separately from the final answer.
- Regression coverage for context selection, Ask restrictions, Agent permissions, multi-agent merging, stale-file protection, and citation fallback.
- Evaluation sets for architecture, bug analysis, implementation planning, and selected-code questions, with groundedness, file selection, tool efficiency, answer quality, latency, and model-failure recovery scores.
- Model fallback ordered by task type and capability: fast Ask summaries, reasoning models for architecture/bugs/implementation.

## Stage 13 - Production Safety and Recovery

**Status: PRODUCTION SAFETY FOUNDATION IMPLEMENTED**

**Goal:** Make approved changes trustworthy.

Implemented foundation:

- Complete diff review with per-file approval and optional per-hunk approval for multi-hunk files.
- Named change sets with audit records and rollback history (`ChangeSetStore` + applier).
- File content hashes revalidated immediately before every write and rollback.
- Workspace trust checks, permission prompts, size limits, and shared sensitive-path policies.
- Backend retry isolation locks, request_id idempotency cache, rate protection, and observability counters.
- Explicit local-vs-backend memory conflict resolution (`keep_both` / `keep_local` / `prefer_backend`).

## Stage 14 - Billing and Plans (Last)

**Status: WALLET CREDITS AND DYNAMIC AGENTS IMPLEMENTED**

**Goal:** Sell credits, deduct them from a user wallet on AI usage, and only call models for active catalog agents.

Implemented:

- User chat shows credit balance only. Add-credits / plan purchase stay on backend APIs for later CRM.
- Dynamic agent catalog from `GET /api/v1/agents`. Hardcoded provider categories via `GET /api/v1/agent-categories`: openai, claude, grok, gemini.
- Creating an agent requires a category and model. The backend routes that agent's requests through the matching provider API (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROK_API_KEY`/`XAI_API_KEY`, `GEMINI_API_KEY`).
- Compact Copilot-style composer: attach, mode, agent picker, and one send/stop/retry control.

## Cross-Stage Implementation Rule

For every feature:

```text
Define typed contract
   ↓
Implement extension behavior
   ↓
Implement backend validation and orchestration
   ↓
Add focused tests on both sides
   ↓
Verify safety and failure behavior
   ↓
Update this roadmap
```

**Immediate next implementation:** Razorpay checkout and Copilot-grade polish (see remaining product gaps).

### Verification

```text
Command:
  cd /home/rai/Documents/vscode/m3/m3 && npm run compile

Result:
  exit code 0
  MM3 build complete

Backend verification:
   cd /home/rai/Documents/vscode/m3/m3backend && go test ./...
   exit code 0
```
