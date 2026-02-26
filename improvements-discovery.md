# Ship Framework — Improvements Discovery

## Progress Tracker

| # | Priority | Issue | Status |
|---|----------|-------|--------|
| 1 | P0 | Missing `/ship:pause-work` command | done |
| 2 | P0 | No mid-phase checkpointing in executor | done |
| 3 | P1 | No partial re-execution after failed verify | done |
| 4 | P1 | Planner ignores previous phase summaries | done |
| 5 | P1 | Resume doesn't auto-continue execution | done |
| 6 | P2 | No CLAUDE.md for the Ship repo | done |
| 7 | P2 | Brownfield detection language gaps | done |
| 8 | P2 | No tests for hooks | done |
| 9 | P3 | Legacy GSD aliases still present | done |
| 10 | P3 | Token budget estimates misleading | done |

---

## 1. Missing `/ship:pause-work` Command (P0)

The context monitor references `/ship:pause-work` in both WARNING and CRITICAL messages (`hooks/ship-context-monitor.js:103,106`), but this command doesn't exist in `commands/ship/`. When the agent hits critical context usage, it's told to run a command that doesn't work.

**Recommendation:** Create `commands/ship/pause-work.md` that saves current execution state to SUMMARY.md, records the exact task being worked on, and updates STATE.md with a "paused" marker so `/ship:resume` knows exactly where to pick up.

---

## 2. No Mid-Phase Checkpointing in Executor (P0)

If context runs out during execution, all progress tracking is in the agent's "mental note" — there's no persistent record of which tasks are done until SUMMARY.md is written at the end. If the session dies at task 5 of 8, there's no file showing tasks 1-4 are committed and done.

**Recommendation:** Have the executor update STATE.md (or a separate progress file) after each task commit. Example:

```
## Execution Progress
- [x] Task 1: Setup database schema (commit abc123)
- [x] Task 2: Create user model (commit def456)
- [ ] Task 3: Add auth middleware
```

---

## 3. No Partial Re-execution After Failed Verify (P1)

After a PARTIAL verification, the verifier sets status back to "executing" and says "fix gaps." But the executor doesn't know which tasks failed — it would re-read the entire plan and potentially redo everything. There's no link between verify gaps and specific tasks.

**Recommendation:** Have the verifier write a `## Fix Tasks` section in VERIFY.md with specific remediation tasks (same XML format as PLAN.md). Then have the executor check for VERIFY.md and execute only the fix tasks instead of the full plan.

---

## 4. Planner Ignores Previous Phase Summaries (P1)

The planner reads ROADMAP.md, STATE.md, PROJECT.md, and REQUIREMENTS.md — but not previous phases' SUMMARY.md files. Decisions made during execution, patterns established, and deviations noted are lost context for future planning.

**Recommendation:** Have the planner also read `(N-1)-SUMMARY.md` when planning phase N. The "Notes for Next Phase" section in SUMMARY.md is explicitly designed for this but is never consumed.

---

## 5. Resume Doesn't Auto-Continue Execution (P1)

`/ship:resume` reads STATE.md and tells you which command to run, but doesn't re-invoke it. The user has to manually type the next command. In a context-exhaustion scenario, a brand new session has to re-read all planning files, losing the executor's in-progress context.

**Recommendation:** Either have `/ship:resume` automatically invoke the next command, or at minimum have the executor write a mid-task checkpoint (which task it's on, what's left) so the next session can skip completed tasks.

---

## 6. No CLAUDE.md for the Ship Repo (P2)

The framework has no project-level CLAUDE.md, meaning when working on Ship itself, there's no guidance about its conventions, testing approach, or architecture. Ironic for a framework about structured development.

**Recommendation:** Add a CLAUDE.md to the repo root with: architecture overview (3-layer command/workflow/agent pattern), naming conventions, how to test changes, and contribution guidelines.

---

## 7. Brownfield Detection Language Gaps (P2)

Brownfield detection only checks for `.ts`, `.js`, `.py`, `.go`, `.rb`, `.rs` files and 5 specific manifests (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Gemfile`). Projects in Java, C#, PHP, Kotlin, Swift, Dart/Flutter, Elixir, etc. would be misclassified as greenfield.

**Recommendation:** Add common manifests: `pom.xml`, `build.gradle`, `*.csproj`, `composer.json`, `pubspec.yaml`, `mix.exs`, `Package.swift`, `CMakeLists.txt`. And/or add a simple heuristic: if directory has >5 non-dotfiles, it's likely brownfield.

---

## 8. No Tests for Hooks (P2)

Ship has no tests at all. The hooks (`ship-statusline.js`, `ship-context-monitor.js`, `ship-check-update.js`) contain real logic — file I/O, JSON parsing, threshold math, debounce state — but none of it is tested.

**Recommendation:** Add at least unit tests for the hooks. They're pure functions that read stdin and write stdout, making them easy to test. The context scaling math (80% to 100% mapping) is the kind of thing that easily regresses.

---

## 9. Legacy GSD Aliases Still Present (P3)

The `.claude/hooks/` directory has `gsd-statusline.js`, `gsd-check-update.js`, and `gsd-context-monitor.js` that are simple one-line redirects. These are dev artifacts that shouldn't ship to users.

**Recommendation:** Either remove them, or if backward compatibility is needed for existing users, move the alias logic into `install.js` so it only applies during installation.

---

## 10. Token Budget Estimates Misleading (P3)

The help command estimates ~195K tokens per phase cycle, but nothing actually tracks or enforces this. A complex phase could easily blow past that, especially if the planner does 3 WebFetch calls and the executor hits multiple Rule 3 retries.

**Recommendation:** Either remove the estimates (they set wrong expectations) or have the context monitor factor in phase complexity to give earlier warnings for heavy phases.
