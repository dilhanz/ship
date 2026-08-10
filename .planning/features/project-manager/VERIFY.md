# Verification Report — project-manager

**Feature:** project-manager
**Verified:** 2026-08-10
**Overall Status:** INCONCLUSIVE

## Stage 1 — Acceptance Criteria

Per-criterion verdict ∈ {PASS, FAIL, INCONCLUSIVE}. INCONCLUSIVE means no runnable verify command was available; grep-only file existence does not upgrade to PASS. Context: five of the seven criteria describe runtime behavior of LLM-executed Markdown skills; the running plugin is the 5.2.0 cache, which contains none of the new pm/pm-sync/pm-state skills or the pm-sync-nudge hook (verified: `ls ~/.claude/plugins/cache/dilhanz-ship/ship/5.2.0/skills/` → 14 dirs, no pm*), so the skills cannot be exercised in-session. This mirrors the autonomous-plan-loop precedent: prose-only skill behaviors are INCONCLUSIVE even when fully specified.

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| 1. `/ship:pm-sync` bootstrap: guided interview (scan → propose → confirm) creates ROADMAP.md, DECISIONS.md, dashboard.html | INCONCLUSIVE | Flow fully specified in `skills/pm-sync/SKILL.md` (Bootstrap flow steps 1–4: scan README/git log/features/archive → draft → AskUserQuestion rounds with "do not write anything until the user has confirmed" → write all three files). Task 3 verify executed OK (`grep ship:pm-sync && grep pm-state/SKILL.md && grep AskUserQuestion && grep -i "only inside .project-manager"` → all match); wiring test asserts AskUserQuestion in allowed-tools (executed, pass). But the interview and file creation are LLM runtime behavior — no command can exercise a Markdown skill in-session. |
| 2. `/ship:pm <question>` → specific recommendation + rationale + Ship command; no args → high-level brief | INCONCLUSIVE | `skills/pm/SKILL.md` steps 6–7 specify exactly this: no-args brief (milestones w/ done/total, blockers, top priorities, one next recommendation) and next-style routing ("Recommend exactly one item: highest-priority non-done, non-blocked item whose dependencies are satisfied… End with the concrete Ship command"). Task 4 verify executed OK. Prose-only skill behavior — content-verified, not executed. |
| 3. `/ship:pm` identifies parallel-safe items from recorded dependencies | INCONCLUSIVE | `skills/pm/SKILL.md` step 8: "List items whose dependencies are all satisfied and that do not depend on each other, grouped as independent lanes"; Depends-on column mandated by pm-state exact table header (wiring test 6 executed, pass). Prose-only skill behavior. |
| 4. dashboard.html single self-contained file, `file://`, no network, regenerated on state change | INCONCLUSIVE | Template half is executed-proven: `grep -q "PM:MILESTONES" ship/templates/dashboard.html && ! grep -qE "https?://" && ! grep -qi "<script src\|<link"` → pass; wiring test 4 asserts all six PM: placeholders and zero http/https/script-src/link substrings (executed, 9/9 pass). Template read: inline CSS only, no JS, prefers-color-scheme, unicode glyphs. But the actual `.project-manager/dashboard.html` is generated at runtime by the skills per the pm-state procedure — regeneration-on-change is prose behavior. |
| 5. Hook injects sync nudge on feature status drift; after `/ship:pm-sync`, ROADMAP.md reflects new status | INCONCLUSIVE | Hook half fully executed-proven: `node --test "tests/pm-nudge.test.js"` → 8/8 pass (drift pending→building nudges with slug + "/ship:pm-sync", archived→done flagged, debounce persists `.nudge-state.json`, blocked shield, unknown slug ignored, malformed roadmap silent) plus 8/8 adversarial (`tests/pm-nudge-adversarial.test.js`); registration proven (`node -e` hooks.json check → PostToolUse matcher `Write|Edit` → pass). Second clause — pm-sync reconcile updating ROADMAP.md — is prose (Reconcile flow step 2 applies the mapping table), unexecutable in-session. |
| 6. PM never writes outside `.project-manager/`, never implements; recommendations end with Ship handoff | INCONCLUSIVE | Soft guidance by design (CONTEXT decision: no tool-level enforcement). Rules present in both skill bodies (wiring test 3 executed: `/never (begin|start) implementation/i` + `.project-manager` write boundary in both); pm's allowed-tools excludes Edit and Bash (wiring test 2 executed, structurally narrowing the write surface); hook writes only `.project-manager/.nudge-state.json` (code read: sole writeFileSync target, lines 102/113). Runtime adherence is LLM behavior — unprovable by command. |
| 7. PM state files contain no dates-as-deadlines, estimates, or sizing (decision-log timestamps allowed) | PASS | The delivered format artifacts define state content and contain none: pm-state table header is exactly `\| Item \| Status \| Priority \| Depends on \| Ship feature \|` with hard rule 1 "no dates-as-deadlines, no estimates, no sizing" (wiring test 6 executed: exact header + no-estimates rule asserted, pass); Task 1 verify executed OK. Dashboard template's only temporal text is the "Last synced" line; ROADMAP `updated:` frontmatter and DECISIONS entry dates are timestamps, not deadlines — compliant with the criterion as worded. No `.project-manager/` exists in-repo to contradict the spec. |

## Stage 2 — Bug Hunt & Quality

### Adversarial Tests

- **Categories tested:** boundary (CRLF line endings, extra-pipe table rows), negative-input (malformed `.nudge-state.json`, garbage stdin), error-handling (silent-fail contract), state-machine edges (debounce keyed on drift set, drift clear-then-reappear, blocked-vs-archived precedence, done-recorded regression)
- **Tests written:** 8  **Passed:** 8 / 8
- **Test files committed:** `tests/pm-nudge-adversarial.test.js` (commit dd7ebd4)
- Full suite after addition: `node --test "tests/*.test.js"` → 178/178 pass.

Notable confirmations: the debounce implements the plan-review suggestion (keys only the drifted pairs, so a new drift alongside a persisting one re-nudges); the blocked shield correctly yields to archived/done reality; state clearing lets an identical drift re-nudge after resolution.

### Bug Findings

| # | Severity | Category | Description | File | Status |
|---|----------|----------|-------------|------|--------|
| 1 | low | negative-input | Status comparison is case-sensitive and format-literal: a hand-edited `Done` cell causes a one-time false drift nudge ("roadmap says Done, actually done"), and `Pending`/`**pending**` cells silently miss drift (rule checks `recorded === 'pending' \|\| recorded === 'done'`). Consistent with the accepted Risk Note (unparseable hand-edits degrade to silence), but a `.toLowerCase()` on the recorded cell would remove both edges. | hooks/pm-sync-nudge.cjs:77-79 | Open |

### Anti-Pattern Scan

QA.md absent — verifier performed fallback grep scan on all 11 changed files.

- TODO/FIXME/placeholder/stub markers: None (the only "placeholder" mentions describe the intentional `<!-- PM:* -->` template mechanism)
- Empty function bodies / hardcoded values: None (hook constants are the documented state-file paths)
- Broken imports / convention violations: None — `hooks/hooks.json` parses as valid JSON with existing entries untouched; hook is zero-dependency (fs, path, scan-features.cjs) with the silent-fail try/catch wrapper; tests follow the node:test spawn-in-tmpdir convention; skill descriptions use the "Use when…" trigger format

### Quality Notes

- CONTEXT's decision prose says "no dates … anywhere in PM state" while the AC allows non-deadline timestamps; the ROADMAP `updated:` frontmatter field (a last-synced timestamp) sits inside that gap. The plan settled it deliberately and plan review approved — recorded for awareness only.
- CLAUDE.md Development Guidelines "Templates" paragraph still mentions only the VERIFY.md template; the architecture block (line 75) does document dashboard.html, so Task 9's verify passes. Cosmetic inconsistency.
- CLAUDE.md counts verified against reality: 17 `skills/*/SKILL.md` dirs, 4 with `user-invocable: false` or reference role (deviation-rules, git-commits, tdd, pm-state) → "17 skills (13 user-invocable + 4 reference)" and "6 Node.js hooks" are accurate.

## Human Checks Required

- [ ] Dogfood after release/plugin refresh: the running 5.2.0 plugin cache contains none of pm, pm-sync, pm-state, or pm-sync-nudge.cjs, so `/ship:pm-sync` bootstrap (AC1), `/ship:pm` routing (AC2, AC3), dashboard generation/regeneration (AC4), the reconcile half of AC5, and the soft-guidance adherence of AC6 need one real session: run `/ship:pm-sync` in a repo, confirm the interview and the three files, open `dashboard.html` via `file://` with the network tab open, change a feature status, observe the nudge, re-sync, and confirm ROADMAP.md updates.

## Gaps

- AC1–AC3, AC6: prose-only behaviors of Markdown skills — instruction content is complete, wiring-tested, and matches the plan, but no command can execute an interactive skill in-session. Resolve via the dogfood check above or `/ship:finish --accept-inconclusive`.
- AC4: template self-containment is executed-proven; the generated artifact and regen-on-change behavior are LLM runtime.
- AC5: hook nudge fully proven by 16 executed tests; the reconcile write-back is skill prose.

## Recommendation

**Needs human review**

Everything executable is green: 178/178 tests including 8 new adversarial edges, all 9 plan verify commands pass, hook drift/debounce logic is correct across every edge probed, and no critical/high bugs exist (one low robustness note). The six INCONCLUSIVE verdicts are inherent to prompt-skill features, not defects — one dogfood session after the plugin cache refreshes, or an operator `--accept-inconclusive`, closes them.

## Inconclusive Override

<!-- This section is populated by /ship:finish --accept-inconclusive "reason".
     It is empty if no override was applied. -->

- **Override applied:** no
- **Reason:** N/A
- **Operator:** N/A
- **Timestamp:** N/A
