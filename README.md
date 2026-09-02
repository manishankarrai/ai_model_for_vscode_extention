# M3 Development Roadmap

## Current Development Stage

**Stage 1 — Foundation / Primary Pipeline**

M3 is currently in the foundation and testing phase.

The immediate goal is to make the existing local project intelligence pipeline reliable before implementing advanced autonomous investigation.

### Current Pipeline

```text
User Question
     │
     ▼
   Chat UI
     │
     ▼
   Local Agent
     │
     ├── Intent Detection
     │
     ├── Planning
     │
     ├── Tool Selection
     │
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
Relevant Project Context
     │
     ▼
 Backend Client
     │
     │ HTTPS
     ▼
 M3 Go Backend
     │
     ▼
   Gemini
     │
     ▼
 AI Response
```

### Important Principle

M3 must **NOT** send the entire project to Gemini.

Instead:

```text
Project
   │
   ▼
Local Project Intelligence
   │
   ▼
Search
   │
   ▼
Relevant Files
   │
   ▼
Relevance Ranking
   │
   ▼
Context Builder
   │
   ▼
Only Useful Context
   │
   ▼
M3 Backend
   │
   ▼
Gemini
```

This keeps the system faster, cheaper, more private, and scalable.

---

# M3 Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    M3 VS CODE EXTENSION                     │
│                  FAST LOCAL INTELLIGENCE                    │
│                                                             │
│  ┌──────────────── PROJECT INTELLIGENCE ─────────────────┐  │
│  │                                                       │  │
│  │ File Scanner                                          │  │
│  │ Smart Incremental Index                               │  │
│  │ Symbol Index                                          │  │
│  │ Lightweight Dependency Detection                      │  │
│  │ Keyword / Semantic Search                             │  │
│  │ Local File Relevance Ranking                          │  │
│  │ Context Builder                                       │  │
│  │ Context Compression                                   │  │
│  │ Changed-File Detection                                │  │
│  │                                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌────────────────── LOCAL AGENT ───────────────────────┐  │
│  │                                                       │  │
│  │ Intent Detection                                      │  │
│  │ Lightweight Planning                                  │  │
│  │ Tool Selection                                        │  │
│  │ Read-only Tool Execution                              │  │
│  │ Local Investigation                                   │  │
│  │                                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────── LOCAL STATE ─────────────────────┐  │
│  │                                                       │  │
│  │ Short-term Conversation                               │  │
│  │ Index Cache                                           │  │
│  │ Current Task State                                    │  │
│  │ Project Metadata                                      │  │
│  │                                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Read-only Safety Layer                                    │
│  UI / Chat                                                 │
│  Local Token & Latency Tracking                            │
│                                                             │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                       M3 BACKEND                            │
│                 TRUSTED AI ORCHESTRATOR                     │
│                                                             │
│  ┌──────────────────── IDENTITY ─────────────────────────┐ │
│  │ Authentication                                        │ │
│  │ Authorization                                         │ │
│  │ Subscription / Entitlements                           │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────── AI ENGINE ────────────────────────┐ │
│  │                                                       │ │
│  │ Deep Planner                                          │ │
│  │ Investigation Orchestrator                            │ │
│  │ Context Strategy                                      │ │
│  │ Multi-step Reasoning                                  │ │
│  │ Model Routing                                         │ │
│  │ Result Verification                                   │ │
│  │                                                       │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────── MEMORY ───────────────────────────┐ │
│  │                                                       │ │
│  │ Long-term Project Memory                              │ │
│  │ Conversation Summaries                                │ │
│  │ Important Decisions                                   │ │
│  │ Known Bugs / Findings                                 │ │
│  │ Project Architecture Knowledge                        │ │
│  │                                                       │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────── SECURITY ─────────────────────────┐ │
│  │                                                       │ │
│  │ Request Validation                                    │ │
│  │ Rate Limiting                                         │ │
│  │ Quota Management                                      │ │
│  │ Abuse Protection                                      │ │
│  │                                                       │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────── BILLING ──────────────────────────┐ │
│  │                                                       │ │
│  │ Token Usage                                           │ │
│  │ AI Request Usage                                      │ │
│  │ Cost Calculation                                      │ │
│  │ Billing                                               │ │
│  │ Usage Analytics                                       │ │
│  │                                                       │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  Gemini API Key                                             │
│  AI Gateway                                                 │
│                                                             │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               │ AI API
                               ▼
                    ┌─────────────────────┐
                    │       Gemini        │
                    │                     │
                    │ Reasoning           │
                    │ Code Analysis       │
                    │ Bug Detection       │
                    │ Code Understanding  │
                    └─────────────────────┘
```

---

# M3 Development Stages

M3 will be developed progressively instead of implementing the complete Copilot-like system at once.

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

**Status: CURRENT**

The goal is to build and test the primary M3 pipeline.

### Components

```text
Project Scanner
       ↓
Incremental Index
       ↓
Symbol Index
       ↓
Dependency Detection
       ↓
Search Engine
       ↓
Relevance Ranking
       ↓
Context Builder
       ↓
Context Compression
       ↓
Backend
       ↓
Gemini
```

### Local Agent

```text
Intent Detector
Planner
Tool Selector
Read-only Tools
```

### Local State

```text
Conversation
Index Cache
Current Task
Project Metadata
```

### Safety

M3 is currently **read-only**.

M3 must not:

```text
write_file
edit_file
delete_file
rename_file
```

### Current Testing

```text
Scanning files...
       ↓
Building index...
       ↓
Finding symbols...
       ↓
Detecting dependencies...
       ↓
Index ready
```

The first priority is to make this pipeline stable and reliable.

**Do not implement the advanced investigation loop until Stage 1 is properly tested.**

---

# Stage 2 — Reliable Project Understanding

**Status: PLANNED**

Improve the local project model.

M3 should understand:

```text
Files
Symbols
Imports
Dependencies
Entry Points
Modules
Frameworks
Configuration
Tests
Project Metadata
```

The objective is to make M3 understand the structure of a project before asking Gemini for reasoning.

---

# Stage 3 — Deep Local Investigation

**Status: PLANNED / POSTPONED**

This is the next major intelligence layer.

Example:

```text
User
 │
 ▼
Find bug in my project
 │
 ▼
Intent Detector
 │
 ▼
Investigation Plan
 │
 ▼
Search Project
 │
 ▼
Find Relevant Files
 │
 ▼
Read File A
 │
 ▼
Find Symbol
 │
 ▼
Find Dependency
 │
 ▼
Read File B
 │
 ▼
Follow Dependency
 │
 ▼
Build Evidence Graph
 │
 ▼
Evidence Ranking
 │
 ▼
Backend
 │
 ▼
Gemini
 │
 ▼
Root Cause Analysis
```

M3 should investigate locally before sending evidence to Gemini.

This stage is intentionally postponed until the primary Stage 1 pipeline is tested.

---

# Stage 4 — Adaptive AI Reasoning

**Status: PLANNED**

M3 and Gemini will work together when deeper investigation is required.

Example:

```text
M3 Investigation
       ↓
Gemini
       ↓
Needs auth/token.go
       ↓
M3 reads token.go
       ↓
Gemini
       ↓
Needs middleware.go
       ↓
M3 reads middleware.go
       ↓
Gemini
       ↓
Root Cause
```

The system will require:

```text
Token limits
Tool-call limits
Investigation limits
Loop detection
Confidence scoring
Stopping conditions
Evidence requirements
```

Simple questions should remain cheap.

Complex questions can use multiple AI calls.

---

# Stage 5 — Persistent Project Memory

**Status: PLANNED**

M3 will remember useful project knowledge across conversations.

Possible stored knowledge:

```text
Project Architecture
Conversation Summaries
Important Decisions
Known Bugs
Previous Findings
Project Conventions
Important Dependencies
```

The goal is to avoid rediscovering the same project information repeatedly.

Source code should primarily remain on the user's machine. Long-term backend memory should focus on useful knowledge, summaries, findings, and decisions rather than unnecessarily storing entire source files.

---

# Stage 6 — Advanced Coding Agent

**Status: PLANNED**

M3 should handle more complex developer requests.

Examples:

```text
Find the race condition.

Why is this API slow?

Explain this service.

Where does this request originate?

Why is this database query failing?

Find possible memory leaks.

Review this authentication system.

Explain the architecture.

Find all usages of this function.

Find the root cause of this error.
```

M3 should automatically decide which local tools and project information are required.

---

# Stage 7 — Safe Code Modification

**Status: PLANNED**

Only after M3 has strong project understanding and investigation capabilities should code modification be introduced.

The workflow should be:

```text
User
 ↓
Investigate
 ↓
Understand
 ↓
Find Root Cause
 ↓
Generate Patch
 ↓
Show Patch
 ↓
User Approves
 ↓
Apply Patch
```

M3 should not silently modify source code.

The user should remain in control.

---

# Stage 8 — Copilot-Level M3

**Status: LONG-TERM GOAL**

The final goal is a complete AI coding assistant with:

```text
Project Understanding
        +
Context Awareness
        +
Cross-file Reasoning
        +
Symbol Understanding
        +
Dependency Reasoning
        +
Deep Bug Investigation
        +
Adaptive AI Reasoning
        +
Project Memory
        +
Conversation Memory
        +
Code Generation
        +
Patch Generation
        +
Patch Verification
        +
Test Understanding
        +
Git / Change Awareness
        +
Multi-step Reasoning
        +
Model Routing
        +
Token / Cost Optimization
        +
Safe Code Modification
```

The goal is not to copy one specific implementation of GitHub Copilot.

The goal is to build an M3 architecture that provides a similar level of intelligent developer assistance while keeping project intelligence primarily local and using the backend as the trusted AI/service layer.

---

# Current Roadmap Position

```text
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  STAGE 1  ████████████████████  CURRENT                     │
│                                                             │
│  STAGE 2  ░░░░░░░░░░░░░░░░░░░░  NEXT                       │
│                                                             │
│  STAGE 3  ░░░░░░░░░░░░░░░░░░░░  PLANNED                   │
│                                                             │
│  STAGE 4  ░░░░░░░░░░░░░░░░░░░░  PLANNED                   │
│                                                             │
│  STAGE 5  ░░░░░░░░░░░░░░░░░░░░  PLANNED                   │
│                                                             │
│  STAGE 6  ░░░░░░░░░░░░░░░░░░░░  PLANNED                   │
│                                                             │
│  STAGE 7  ░░░░░░░░░░░░░░░░░░░░  PLANNED                   │
│                                                             │
│  STAGE 8  ░░░░░░░░░░░░░░░░░░░░  COPILOT-LEVEL GOAL        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Development Rule

**Do not skip stages unnecessarily.**

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
Update README
   ↓
Move to next stage
```

When returning to M3 development after a break, first identify the current stage from this README before implementing new architecture.

---

# Current Immediate Goal

```text
Stage 1
   ↓
Test existing primary code
   ↓
Fix errors
   ↓
Verify scanner
   ↓
Verify index
   ↓
Verify symbols
   ↓
Verify dependencies
   ↓
Verify search
   ↓
Verify ranking
   ↓
Verify context builder
   ↓
Verify backend communication
   ↓
Verify Gemini response
   ↓
Stage 1 complete
```

**Advanced local investigation, evidence graphs, and adaptive investigation loops are intentionally postponed.**
