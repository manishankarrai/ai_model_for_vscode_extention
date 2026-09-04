# M3 Development Roadmap

## Current Development Stage

**Stage 7 — Safe Code Modification**

Status: APPROVAL-GATED FOUNDATION IMPLEMENTED and verified in the current codebase.

The system now supports a local adaptive reasoning loop in which Gemini can request additional read-only evidence, M3 validates and executes the tool locally, and the loop continues until a final answer or a hard stop condition is reached.

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

M3 must **NOT** expose direct filesystem access to Gemini.

Instead:

```text
Gemini
   │
   ▼
Structured tool request
   │
   ▼
M3 validation + safety checks
   │
   ▼
Local read-only tool execution
   │
   ▼
Evidence returned to Gemini
```

This preserves the local-first, privacy-safe architecture while enabling adaptive investigation.

---

# M3 Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    M3 VS CODE EXTENSION                     │
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
│                       M3 BACKEND                            │
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

# M3 Development Stages

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
Copilot-Level M3
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
M3 = authority over local access and stopping logic
```

Gemini may request tools, but M3 validates, executes, and enforces the investigation guardrails.

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
│  STAGE 8  NEXT: CONTEXT SELECTION                           │
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

M3 can now apply exact code changes only after explicit user approval. Gemini supplies complete original and updated file contents; the extension validates workspace-relative paths, rejects oversized or stale changes, applies the approved edits atomically, and saves the files. No automatic modification is permitted.

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

**Goal:** Let users control exactly what M3 sees.

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
- Attached scope is shown in the chat view.
- Context parts are typed and validated independently by the backend.

Backend work:

- Add typed context parts for files, selections, and attachments.
- Validate limits per part and for the complete request.
- Preserve source metadata so answers cite the exact file and selection.
- Keep secrets and ignored files blocked server-side as a second safety boundary.

Acceptance criteria: users can ask about only highlighted code or selected files, and M3 never silently expands that context.

Remaining Stage 8 work: removable attachment chips, drag-and-drop and pasted files, per-conversation context management, token estimates, and richer source citations.

## Stage 9 - Ask and Agent Modes

**Goal:** Make interaction behavior predictable.

Ask mode only answers using supplied context and memory. It cannot investigate, request tools, modify files, execute commands, or perform automatic follow-up actions. It must clearly state when context is insufficient.

Agent mode can investigate with approved read-only tools, produce implementation plans and diffs, and offer changes only through the approval and rollback workflow. The UI must show the active mode, current step, tools used, and stop reason.

Backend work:

- Add a typed mode field and enforce mode permissions on every request.
- Use separate prompts, tool policies, budgets, and response schemas for Ask and Agent.
- Reject Agent-only capabilities in Ask mode.

Acceptance criteria: Ask mode only answers; Agent mode is the only mode allowed to investigate or propose changes.

## Stage 10 - Selectable Multi-Agent Workspace

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

- Add an Agent mode selector and bounded agent-count control.
- Let users choose named agents or use Coordinator selection.
- Show each agent status, evidence, answer, confidence, and failures.
- Support cancel, retry, and partial results.

Backend work:

- Add selected agent IDs and maximum agent count to the request contract.
- Run independent investigations in parallel where safe, then merge through Coordinator.
- Give every agent a role prompt, context budget, tool policy, timeout, and trace ID.
- Deduplicate overlapping searches and repeated tool requests.

Acceptance criteria: users can choose one or several agents, the Coordinator returns one grounded answer, and a failed specialist does not erase successful results.

## Stage 11 - Backend Agent Orchestration

**Goal:** Make multi-agent behavior reliable across client and server.

- Version request and response schemas.
- Add agent capabilities, model selection, context budgets, and maximum parallelism.
- Propagate cancellation and deadlines from VS Code to Gemini calls.
- Stream structured events for planning, tool requests, agent completion, and final synthesis.
- Keep local filesystem access in the extension; the backend may request tools but never execute them.
- Store resumable task state and compact traces without retaining raw sensitive context unnecessarily.
- Make memory updates explicit and attributable to an agent and request.

## Stage 12 - Streaming, Quality, and Evaluation

**Goal:** Make M3 feel fast and measurably intelligent.

- Stream progress and final answer tokens to the webview.
- Render citations, expandable evidence, diffs, confidence, and validation results.
- Add regression tests for context selection, Ask restrictions, Agent permissions, multi-agent merging, and stale-file protection.
- Build evaluation sets for bug analysis, implementation planning, architecture, and selected-code questions.
- Measure groundedness, useful file selection, tool efficiency, answer quality, latency, and model-failure recovery.
- Choose model fallback by capability and task type, not only a static model list.

## Stage 13 - Production Safety and Recovery

**Goal:** Make approved changes trustworthy.

- Add complete diff review with per-file and per-hunk approval.
- Add named change sets, audit records, and reliable rollback history.
- Revalidate file hashes immediately before every write.
- Add workspace trust checks, permission prompts, size limits, and sensitive-path policies.
- Add retry isolation, idempotency keys, rate protection, and backend observability.
- Make memory conflict resolution explicit when local and backend facts disagree.

## Stage 14 - Billing and Plans (Last)

Billing begins only after the core product is reliable. It should cover plan limits, usage metering, subscriptions, invoices, entitlements, and upgrade flows without changing the safety or reasoning contracts established earlier.

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

**Immediate next implementation:** Complete Stage 8 context UX with removable attachment chips, pasted and dropped files, token estimates, and source citations.

### Verification

```text
Command:
  cd /home/rai/Documents/vscode/m3/m3 && npm run compile

Result:
  exit code 0
  M3 build complete

Backend verification:
   cd /home/rai/Documents/vscode/m3/m3backend && go test ./...
   exit code 0
```
