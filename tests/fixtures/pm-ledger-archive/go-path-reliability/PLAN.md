---
feature: "go-path-reliability"
goal: "Give ship-verifier the durable incremental record the two reviewers already have, make the go workflow name transport failure honestly with an INFRASTRUCTURE terminal status, enforce task `depends` at build time, and surface every salvage event — shipped as 5.11.0"
---

<!-- Reduced copy of .planning/archive/go-path-reliability/PLAN.md for CI.
     `.planning/` is gitignored, so the real archive is invisible to a clean checkout.
     Only the bytes ship/pm-update.cjs harvestFeature() actually parses are kept;
     the prose body is dropped. REVIEW.md and VERIFY.md are copied verbatim.
     tests/pm-ledger.test.js re-harvests the real archive when present and asserts
     this fixture still yields identical rows. -->

## Plan Review

### Round 1

**CRITICAL findings received:**

1. *Task 5 / `ship/workflows/go.workflow.js`* — Task 5 instructs `salvageVerifyPrompt` to embed `node "${CLAUDE_PLUGIN_ROOT}/ship/verify-scratch.cjs" {feature}`. Prompt builders in `go.workflow.js` are JS template literals, so an unescaped `${CLAUDE_PLUGIN_ROOT}` is evaluated as a JS identifier and throws `ReferenceError`, crashing the whole build spine. Fix: state that the reference must be escaped as `\${CLAUDE_PLUGIN_ROOT}` so the literal string reaches the agent's shell, and add a runtime guard to the verify rather than relying on `node --check`. A bare repo-relative path is not a substitute — under a plugin install the helper is not in the user's repo.

**Verification of the finding (confirmed, not disproved):**

- `ship/workflows/go.workflow.js:189-345` — every prompt builder (`buildPrompt`, `continuePrompt`, `progressPrompt`, `rangeInstruction`, `reviewPrompt`, `fixPrompt`, `rereviewPrompt`, `salvageReviewPrompt`, `salvageVerifyPrompt`) is a backtick template literal interpolating `${feature}`, `${scope}`, `${fullPrompt}`. A bare `${CLAUDE_PLUGIN_ROOT}` in that position is an identifier reference, not text.
- `grep -rn CLAUDE_PLUGIN_ROOT` across the repo returns hits only in Markdown (`skills/**`, `agents/**`, `CLAUDE.md`), JSON (`hooks/hooks.json`), and `hooks/pm-sync-nudge.cjs` (which reads `process.env.CLAUDE_PLUGIN_ROOT` properly). There is **no** precedent for the token inside a workflow JS file, so the plan was proposing the first — and it would have been the broken one.
- The plugin-root form is nonetheless the correct one: `skills/go/SKILL.md:48` invokes `resolve-profile.cjs` that way, `agents/ship-pm.md:36` invokes `pm-update.cjs` that way, and `tests/pm-update-verify.test.js:137` asserts the form. The reviewer's rejection of a repo-relative substitute is right.
- The reviewer's claim about `node --check` also holds: the unescaped form is syntactically valid, so `--check` passes; the `ReferenceError` fires at prompt-build time, and only on the retry path. Task 5's previous verify would not have caught it.

**Changes made:**

- Task 5 action — added a leading **Escaping rule** paragraph naming the template-literal hazard, mandating `\${CLAUDE_PLUGIN_ROOT}`, explaining that the backslash is needed here and not in Markdown, explicitly rejecting a repo-relative path (plugin installs put the helper outside the user's repo), and stating that `node --check` cannot catch it.
- Task 5 action, step 1 — the invocation is now written escaped: ``node "\${CLAUDE_PLUGIN_ROOT}/ship/verify-scratch.cjs" {feature}``.
- Task 5 verify — appended a static guard that fails on either half of the defect: `node -e` asserting the source contains the escaped literal AND that `/(^|[^\\])\$\{CLAUDE_PLUGIN_ROOT\}/` does not match. Written with `node -e` rather than `grep -P`, which BSD grep on macOS does not support. Guard was executed against a good/bad fixture pair before being written into the plan: it passes the escaped form and throws on the bare one.
- Task 11 action — added a **Plugin-root escaping** test bullet asserting both halves, noting that the presence check alone would pass a file carrying one escaped and one unescaped reference.
- `## Decisions` — new entry recording the invocation form, why the plugin root (not a relative path) is the only one that resolves under a plugin install, and why the escaping differs between agent Markdown (Task 3, bare) and workflow JS (Task 5, escaped).
- `## Risk Notes` — new Task 5 note: an unescaped reference is a latent spine crash that surfaces only on a retry, i.e. exactly when the run is already in trouble, and takes the spine down instead of degrading to a full re-verify.

**Not changed:** Task 3's bare `${CLAUDE_PLUGIN_ROOT}` in `agents/ship-verifier.md` is correct as written — that file is Markdown delivered verbatim to the agent, matching `agents/ship-verifier.md:131` and `agents/ship-pm.md:36`. No task ids were renumbered.

### Outcome — APPROVED

**Rounds:** 2

- Round 1: NEEDS-REVISION, 1 critical
- Round 2: APPROVED, 0 critical

**Examined:** ship/workflows/go.workflow.js, agents/ship-verifier.md, agents/ship-reviewer.md, agents/ship-builder.md, agents/ship-plan-reviewer.md, agents/ship-pm.md, ship/docs/headless.md, ship/templates/VERIFY.md, skills/go/SKILL.md, skills/verify/SKILL.md, tests/doctrine-headless-contract.test.js, tests/builder-continuation.test.js, tests/structured-output-salvage.test.js, tests/lane-sweep.test.js, tests/pm-handoff.test.js, ship/resolve-profile.cjs

**Surviving non-blocking findings (round 2, both SUGGESTION):**

- *Task 11 / `tests/doctrine-headless-contract.test.js`* — the new 12th outcome word `infrastructure` is not added to that suite's hardcoded `OUTCOMES` list. An extra row in `headless.md` does not fail its loop, so Task 9 will not break the suite, but the word stays unpinned in the contract test that owns doc/skill agreement. Task 11's new `tests/go-path-reliability.test.js` already asserts the doc row, so this is redundancy rather than a coverage hole.
- *Task 1 / `ship/verify-scratch.cjs`* — the CLI parse rule ("first non-flag is the slug") collides with the argument order in Task 1's own verify command (`--cwd /tmp no-such-feature`): a literal first-non-flag scan selects `/tmp` unless `--cwd`'s value is consumed first. The verify only asserts exit 0 and valid JSON, so it passes either way. Recommended clause: `--cwd <dir>` consumes the following argv entry, which is excluded from the slug scan.
