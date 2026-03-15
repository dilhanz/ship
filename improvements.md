# Ship Improvements (from feature-dev plugin analysis)

Findings from analyzing [anthropics/claude-code/plugins/feature-dev](https://github.com/anthropics/claude-code/tree/main/plugins/feature-dev) — March 2025.

## Prioritized Action Items

| # | Improvement | Effort | Impact | Status |
|---|-----------|--------|--------|--------|
| 1 | Parallel codebase exploration in planner (2-3 explorer sub-agents) | Medium | High | done |
| 2 | Architecture comparison step (2-3 approaches with recommendation) | Medium | High | done |
| 3 | Post-exploration clarifying questions (second Q&A round) | Low | Medium-High | done |
| 4 | Confidence scoring in verifier | Low | Medium | done |
| 5 | Parallel reviewer sub-agents in verifier | Medium | Medium | done |
| 6 | Optional approval gates in `/ship-go` | Low | Medium | done |
| 7 | Main-context file reading after plan | Low | Medium | done |

---

## 1. Parallel Codebase Exploration in Planner

**What feature-dev does:** Launches 2-3 `code-explorer` agents in parallel during Phase 2, each targeting a different aspect:
- "Find similar features and trace implementation"
- "Map architecture and abstractions for the area"
- "Analyze current implementation of related feature"

**Ship's gap:** The planner does all exploration sequentially in one agent. Slower and more context-constrained.

**Recommendation:** Ship's `ship-planner` should launch 2-3 parallel `code-explorer` sub-agents before writing PLAN.md. The planner synthesizes their findings into a more informed plan.

---

## 2. Architecture Comparison Step

**What feature-dev does:** Launches 2-3 `code-architect` agents in parallel, each with a different philosophy:
- Minimal changes — smallest diff, maximum reuse
- Clean architecture — maintainability, elegant abstractions
- Pragmatic balance — speed + quality

Presents trade-offs and a recommendation. User chooses.

**Ship's gap:** The planner makes one architecture choice internally without showing alternatives. The user never sees what was considered.

**Recommendation:** Add an optional architecture-comparison step. The planner could present 2-3 approaches in PLAN.md with a recommendation, and the user picks before tasks are finalized. Could be a new `/ship-design` step or folded into `/ship-plan`.

---

## 3. Post-Exploration Clarifying Questions

**What feature-dev does:** Separates codebase exploration (Phase 2) from clarifying questions (Phase 3). After understanding the code, asks targeted questions about edge cases, error handling, integration points, backward compatibility, performance.

**Ship's gap:** The brainstormer asks questions upfront, before any codebase exploration. Questions are based on the user's description alone, not informed by what the code actually looks like.

**Recommendation:** Add a second round of questions after the planner explores the codebase — "Now that I've seen your code, I have these additional questions about integration..." Could be a planner sub-step or a distinct skill.

---

## 4. Confidence Scoring in Verifier

**What feature-dev does:** The code-reviewer rates every finding 0-100 and only reports issues with confidence >= 80. Smart noise reduction.

**Ship's gap:** The verifier reports everything it finds without confidence scoring.

**Recommendation:** Add confidence scoring to Ship's verifier. Only surface high-confidence issues by default.

---

## 5. Parallel Reviewer Sub-Agents in Verifier

**What feature-dev does:** Launches 3 `code-reviewer` agents in parallel after implementation, each with a different focus:
- Simplicity / DRY / elegance
- Bugs / functional correctness
- Project conventions / abstractions

**Ship's gap:** The verifier is a single agent doing a 3-stage review sequentially.

**Recommendation:** Ship's verifier could launch parallel reviewer sub-agents for independent perspectives, then consolidate. Combined with confidence scoring (#4) for maximum signal-to-noise.

---

## 6. Optional Approval Gates in `/ship-go`

**What feature-dev does:** Has 3 explicit gates where it stops and waits:
1. After clarifying questions — waits for answers
2. After architecture options — waits for user choice
3. Before implementation — waits for "go ahead"

**Ship's gap:** After brainstorming Q&A, `/ship-go` runs everything automatically.

**Recommendation:** The `/ship-go` workflow could optionally pause after plan generation to show the plan and ask "Proceed?". Especially valuable for complex features.

---

## 7. Main-Context File Reading After Plan

**What feature-dev does:** Explicitly instructs: after agents return file lists, the main conversation reads those files to build its own understanding. Agents are scouts; the orchestrator builds the real context.

**Ship's gap:** Agents are self-contained. The main conversation doesn't build its own understanding of the codebase after planning.

**Recommendation:** After `ship-plan` completes, the main conversation could read key files referenced in PLAN.md. Makes `/ship-build` more context-aware.

---

## What Ship Already Does Better (no action needed)

- **Persistent artifacts** — CONTEXT.md, PLAN.md, VERIFY.md survive across sessions (feature-dev is ephemeral)
- **Status tracking** — Frontmatter state machine with `/ship-resume` and `/ship-status`
- **Atomic commits** — Per-task commits with enforced conventions
- **Deviation rules** — 3-level escalation when reality diverges from plan
- **Plan verification** — Independent plan review against codebase patterns
- **Phase-aware building** — Task grouping for context management
- **Safety hooks** — Context monitoring, safety gates, statusline
- **Resumability** — Can resume interrupted work from any status
