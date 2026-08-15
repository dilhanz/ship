---
name: ship:pm
description: Use when asking project-level questions or doing project-level work — what to work on next, what can run in parallel, milestone status, blockers, why something was decided, plus reconstructing status, grooming the backlog, auditing whether a shipped feature was verified, and handing over a session
effort: medium
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
argument-hint: "[status|groom|check <feature>|handover|<question>]"
---

Run project-level work against the project-manager state in `.project-manager/`.

## Setup

1. Read `${CLAUDE_PLUGIN_ROOT}/skills/pm-state/SKILL.md` for the five state-file formats (ROADMAP.md, STATUS.md, DECISIONS.md, CONVENTIONS.md, dashboard.html), the status mapping table, and the hard rules.

2. If `.project-manager/ROADMAP.md` is missing or unparseable, say the project manager isn't set up (or its state is damaged), point at `/ship:pm-sync` to bootstrap or repair it, and stop. Do not create state files here. (When `.project-manager/` is gitignored, the mechanical scripts resolve it to the main worktree root via `ship/resolve-state-root.cjs` — from a linked worktree, check there before declaring it missing.)

## Route on $ARGUMENTS

3. Parse the first token:
   - `status`, `groom`, `check`, `apply`, `handover` → the matching verb. `check` takes a feature slug; if the slug is missing, list the candidate features from `.planning/features/` and `.planning/archive/` and ask which one. This is the one place `/ship:pm` stops for input. `apply` takes an optional feature slug; with none, it applies every pending handoff.
   - Empty → the **bare brief** below.
   - Anything else → treat the whole argument string as a free-text project question.

## Delegate to the ship-pm agent

4. For every verb and for free-text questions, invoke the Agent tool with `subagent_type: "ship:ship-pm"`, passing the matching verb brief below verbatim plus the raw `$ARGUMENTS`. The agent owns the writes. Do not read state into this conversation yourself, and do not re-derive the agent's findings — relay its report.

   > **status** — Reconstruct the true state; do not recite STATUS.md back. Check the tracking files against git, feature frontmatter, and whether each shipped feature has a VERIFY.md recording a result. Report the delta between the files and the repo, then fix the files. End with what most deserves to happen next.

   > **groom** — Re-check every backlog item still applies. Verify each carries a traceable Source and drop or flag any that does not. Re-prioritise by the P0–P3 key, re-size (S/M/L/XL), and make dependencies explicit. Report what moved and why.

   > **check {feature}** — Audit whether the feature is genuinely done. One `- [PROVEN|UNPROVEN] {criterion} — {evidence}` line per acceptance criterion, evidence being a named artifact. File every unproven criterion into ROADMAP.md as verification debt at P0 (live/customer-facing risk) or P1. End with a one-line verdict.

   > **apply** — Perform the pending PM handoffs: shared `.project-manager/` edits raised by lanes that no lane may write. Take them from the fleet sweep's `pendingHandoffs`, apply each with PM judgment (the proposed content is a proposal, not a patch), stamp `applied: yes` on the handoff, and record the application in DECISIONS.md. Report each edit made and each handoff you could not reach.

   > **handover** — Update STATUS.md to the true state, record decisions in DECISIONS.md, make atomic tracking commits, push, prune stale worktrees, and write a handover a fresh session could start cold from.

## Bare brief (no arguments)

5. Delegate a read-mostly brief to the agent:
   - Each milestone with progress (done/total items) and status
   - Current blockers, with their reasoning from STATUS.md where recorded
   - **Lanes** — per-lane branch, active feature, and stage from the fleet sweep (`node "${CLAUDE_PLUGIN_ROOT}/ship/lane-sweep.cjs"`), plus a collision warning for every `overlaps` entry (two lanes' in-flight plans naming the same file). When `.project-manager/` is tracked (not gitignored), the agent skips the sweep and says fleet aggregation is unavailable — per-worktree state only.
   - **Pending PM handoffs** — one line per `pendingHandoffs` entry from the same sweep: feature, lane, and how many edits wait. This is work only this layer can do, so it belongs in every brief until it is applied. End the section with `/ship:pm apply` when any are pending.
   - Top 1–3 priorities
   - A single "work on next" recommendation with its Ship command, taken from `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" --next`

6. Preserve today's routing semantics for the question shapes:
   - **Next-style questions** ("what should I work on next?") — recommend exactly one item, selected by running `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" --next` and interpreting its JSON (`{item, milestone, priority, shipFeature}`, or `null` when nothing is eligible); do not re-derive the rule in prose (the script implements it: highest-priority non-done, non-blocked item whose Depends-on items are all `done`). Ground the rationale in recorded Priority, Depends on, and status. End with `/ship:start "{item}"`, or `/ship:resume` when its Ship feature is already in progress.
   - **Parallel-style questions** ("what can run in parallel?") — list items whose dependencies are all satisfied and that do not depend on each other, grouped as independent lanes, each ending with its Ship command. Ground lane suggestions in the sweep data: which lanes are free, and which items' files don't overlap any in-flight plan.
   - **Decision/history questions** ("why did we…", "when was X decided?") — answer from DECISIONS.md and its `decisions/` spill files.

## Dashboard freshness

7. After any verb that changed state, the agent regenerates `.project-manager/dashboard.html` by running `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs"` from the repo root — which also reconciles every slugged row's Status per the mapping table. The manual pm-state procedure is the fallback only when the script is unreadable.

## Hard rules

- Write boundary: `.project-manager/**`, `.planning/**`, `.claude/**`, and root `*.md`, plus git (`add`, `commit`, `push`, `status`, `log`, `diff`, `worktree prune`) for the files it owns. Never application source; never `reset --hard`, `push --force`, or `rebase`.
- Never begin implementation work — every recommendation ends with a Ship command handoff (`/ship:start "{item}"`, `/ship:resume`, `/ship:pm-sync`).
- Never invent status — a claim that cannot be verified from a file, a command, or git is reported as `unverified` with a named next step that would settle it.
- No time estimates in answers — reason from priority, size (complexity, not duration), status, and dependencies only.

$ARGUMENTS
