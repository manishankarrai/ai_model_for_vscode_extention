Stage 3 is where **M3 moves from “project-aware AI” to a real local investigation agent**.

You have already built the foundation:

```text
Stage 1 → Basic AI coding assistant
Stage 2 → Understand the project + select relevant context
Stage 3 → Deeply investigate the project before asking Gemini
```

## 🚀 Stage 3 — Deep Local Investigation

The main goal is:

> **M3 should investigate the codebase step-by-step instead of simply searching for matching files and sending them to Gemini.**

### Stage 3 architecture

```text
User Question
      ↓
Agent
      ↓
IntentDetector
      ↓
Planner
      ↓
Investigation Engine          ← NEW
      ↓
┌─────────────────────────────┐
│ Search                      │
│ Read File                   │
│ Find Symbol                 │
│ Follow Dependency           │
│ Follow Call Chain           │
│ Inspect Related Files       │
└─────────────────────────────┘
      ↓
Evidence Collector            ← NEW
      ↓
Focused Investigation Context
      ↓
ContextBuilder
      ↓
Go Backend
      ↓
Gemini
```

---

# Stage 3.1 — Investigation Engine

Currently your flow is approximately:

```text
question
   ↓
search
   ↓
rank
   ↓
context
   ↓
Gemini
```

In Stage 3:

```text
question
   ↓
plan investigation
   ↓
search
   ↓
inspect result
   ↓
discover related files
   ↓
follow dependencies/symbols
   ↓
collect evidence
   ↓
build final context
   ↓
Gemini
```

For example, user asks:

```text
Why is JWT authentication failing?
```

M3 shouldn't just search `"JWT authentication failing"`.

It should investigate:

```text
Search JWT
   ↓
services/jwt_service.go
   ↓
Find GenerateToken()
   ↓
Find JwtSecret
   ↓
Find middleware/auth.go
   ↓
Find token validation
   ↓
Find routes using middleware
   ↓
Find login handler
   ↓
Compare token generation vs verification
   ↓
Collect evidence
```

Then Gemini receives the **relevant chain**, not the whole project.

---

# Stage 3.2 — Investigation Plan

Your existing `Planner.ts` becomes much more important.

For example:

```text
Question:
"Why does my login API return 401?"
```

M3 creates:

```text
Investigation Plan

1. Find login endpoint
2. Find authentication middleware
3. Find JWT generation
4. Find JWT verification
5. Trace request flow
6. Compare generated claims with verification
7. Identify possible failure
```

The plan should be **dynamic**, not hardcoded.

---

# Stage 3.3 — Tool Execution

Your existing tools:

```text
tools/
├── ListFilesTool.ts
├── ReadFileTool.ts
├── ReadOnlyToolRegistry.ts
└── SearchTool.ts
```

become the investigation primitives.

Stage 3 will make M3 intelligently choose between them.

For example:

```text
SearchTool
     ↓
find auth.go
     ↓
ReadFileTool
     ↓
find ValidateToken()
     ↓
SearchTool
     ↓
find ValidateToken usages
     ↓
ReadFileTool
```

So the agent starts behaving like:

```text
"Search → inspect → decide next step → search → inspect..."
```

rather than:

```text
"Search once → send everything to AI"
```

---

# Stage 3.4 — Dependency Traversal

You already have:

```typescript
DependencyInfo
```

and:

```text
DependencyDetector
```

Stage 3 actually **uses that dependency graph**.

Example:

```text
handlers/login.go
       ↓
services/auth.go
       ↓
services/jwt_service.go
       ↓
middleware/auth.go
       ↓
models/user.go
```

If M3 discovers:

```text
handlers/login.go
```

it can follow its dependencies and investigate related files.

This is one of the biggest improvements over Stage 2.

---

# Stage 3.5 — Symbol Relationships

Stage 2 already indexes symbols:

```text
GenerateToken
ValidateToken
Login
AuthMiddleware
User
```

Stage 3 starts connecting them.

For example:

```text
Login()
  ↓
GenerateToken()
  ↓
SignedString()

Request
  ↓
AuthMiddleware()
  ↓
ValidateToken()
  ↓
Parse()
```

This lets M3 understand **relationships**, rather than just file names.

---

# Stage 3.6 — Evidence Collector

This is very important.

Instead of simply giving Gemini:

```text
Here are 10 files.
Figure it out.
```

M3 builds evidence:

```text
Evidence #1
File: services/jwt_service.go
Reason: Generates JWT
Symbol: GenerateToken
Lines: 20-42

Evidence #2
File: middleware/auth.go
Reason: Verifies JWT
Symbol: ValidateToken
Lines: 15-55

Evidence #3
File: routes/routes.go
Reason: Applies authentication middleware
Lines: 30-40
```

Then:

```text
Evidence
   ↓
Focused Context
   ↓
Gemini
```

This should significantly improve answer quality.

---

# Stage 3.7 — Investigation Limits

We **must not** allow M3 to investigate forever.

For example:

```typescript
maxSteps = 10
maxFiles = 15
maxChars = 50000
maxDepth = 4
```

So an investigation might look like:

```text
Step 1 → Search JWT
Step 2 → Read jwt_service.go
Step 3 → Find GenerateToken
Step 4 → Find usages
Step 5 → Read middleware/auth.go
Step 6 → Find ValidateToken
Step 7 → Read routes.go
Step 8 → Stop
```

Then build context.

This protects:

* latency
* token usage
* Gemini cost
* CPU
* runaway investigations

---

# Stage 3.8 — Investigation State

Your existing:

```text
TaskState
```

will become more useful.

Instead of simply:

```text
status = investigating
```

M3 can track:

```text
Investigation

Step 1/8
Searching JWT...

Step 2/8
Reading services/jwt_service.go...

Step 3/8
Following GenerateToken()...

Step 4/8
Inspecting middleware/auth.go...
```

Eventually this can also be shown in your UI.

---

# Stage 3.9 — Adaptive Investigation

This is where Stage 3 becomes interesting.

M3 shouldn't follow every dependency.

For example:

```text
Question:
"Where is the JWT generated?"
```

Investigation:

```text
Search JWT
   ↓
jwt_service.go
   ↓
GenerateToken()
   ↓
DONE
```

But:

```text
Question:
"Why is JWT authentication failing?"
```

Investigation:

```text
Search JWT
   ↓
GenerateToken()
   ↓
Find usages
   ↓
Middleware
   ↓
ValidateToken()
   ↓
Routes
   ↓
Request flow
   ↓
Compare
```

So **the investigation depth depends on the question**.

---

# Stage 3 final architecture

By the end of Stage 3, I'd target:

```text
                     USER
                       │
                       ▼
                    Agent
                       │
                       ▼
                 IntentDetector
                       │
                       ▼
                    Planner
                       │
                       ▼
             InvestigationEngine
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       Search        Read        Symbols
          │            │            │
          └────────────┼────────────┘
                       ▼
               Dependency Graph
                       │
                       ▼
                EvidenceCollector
                       │
                       ▼
               RelevanceRanker
                       │
                       ▼
                ContextBuilder
                       │
                       ▼
              Focused AI Context
                       │
                       ▼
                  Go Backend
                       │
                       ▼
                    Gemini
                       │
                       ▼
                    Answer
```

## The key difference

### Stage 2

```text
Question
   ↓
Search
   ↓
Rank files
   ↓
Build context
   ↓
AI
```

### Stage 3

```text
Question
   ↓
Understand intent
   ↓
Create investigation plan
   ↓
Search
   ↓
Inspect
   ↓
Follow symbols
   ↓
Follow dependencies
   ↓
Discover more evidence
   ↓
Inspect again
   ↓
Stop when enough evidence exists
   ↓
Build focused context
   ↓
AI
```

### Stage 3 deliverables

I would implement it in this order:

| Stage   | Component              | Purpose                              |
| ------- | ---------------------- | ------------------------------------ |
| **3.1** | `InvestigationEngine`  | Control multi-step investigation     |
| **3.2** | Investigation plan     | Decide what to investigate           |
| **3.3** | Tool execution loop    | Search/read/list intelligently       |
| **3.4** | Dependency traversal   | Follow related files                 |
| **3.5** | Symbol relationships   | Follow functions/classes/usages      |
| **3.6** | EvidenceCollector      | Store why each piece of code matters |
| **3.7** | Investigation limits   | Prevent runaway/costly investigation |
| **3.8** | Investigation state    | Track steps/progress                 |
| **3.9** | Adaptive investigation | Investigate deeper only when needed  |
