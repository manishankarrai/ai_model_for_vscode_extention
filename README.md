# M3 Development Roadmap

## Current Development Stage

**Stage 4 — Adaptive AI Reasoning**

Status: COMPLETE and verified in the current codebase.

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

**Status: PLANNED**

This is the next milestone after Stage 4.

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
│  STAGE 5  ░░░░░░░░░░░░░░░░░░░░  NEXT                       │
│                                                             │
│  STAGE 6  ░░░░░░░░░░░░░░░░░░░░  PLANNED                   │
│                                                             │
│  STAGE 7  ░░░░░░░░░░░░░░░░░░░░  PLANNED                   │
│                                                             │
│  STAGE 8  ░░░░░░░░░░░░░░░░░░░░  GOAL                       │
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

# Current Immediate Goal

```text
Stage 4
   ↓
Verify adaptive reasoning pipeline
   ↓
Confirm read-only safety enforcement
   ↓
Keep Stage 1-4 working together cleanly
   ↓
Move to Stage 5 memory layer
```

**Stage 4 is complete and the project is currently aligned with the adaptive reasoning architecture.**

### Verification

```text
Command:
  cd /home/rai/Documents/vscode/m3/m3 && npm run compile

Result:
  exit code 0
  M3 build complete
```
