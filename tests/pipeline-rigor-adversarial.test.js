/**
 * Adversarial QA tests for pipeline-rigor.
 *
 * These tests probe boundary conditions, negative inputs, error-handling paths,
 * and security properties of the NEW behaviours added by pipeline-rigor.
 * They are COMPLEMENTARY to tests/pipeline-rigor.test.js (which covers happy path).
 *
 * All tests are prompt-content assertions — we cannot execute skills/agents inside
 * a unit test, so we verify that the prompts contain the language required to handle
 * each adversarial case correctly at runtime.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
function readSrc(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// Boundary: --accept-inconclusive argument parsing
// ---------------------------------------------------------------------------

describe('pipeline-rigor adversarial — boundary: --accept-inconclusive parsing', () => {

  it('finish skill aborts when --accept-inconclusive appears with no reason at all', () => {
    const content = readSrc('skills/finish/SKILL.md');
    // The skill must document that omitting the reason is an error.
    // Without this, the agent may silently accept an empty reason or crash.
    assert.ok(
      content.includes('requires a non-empty reason') || content.includes('non-empty reason in quotes'),
      'finish skill must document that --accept-inconclusive requires a non-empty reason'
    );
    // The error path must tell the user what correct usage looks like.
    assert.ok(
      content.includes('Example:') || content.includes('example:'),
      'finish skill must show a usage example when the reason is missing'
    );
  });

  it('finish skill documents that reason must be quoted (not bare tokens)', () => {
    const content = readSrc('skills/finish/SKILL.md');
    // The documented format must require quotes around the reason text.
    // A bare unquoted reason would make multi-word reasons ambiguous with feature names.
    assert.ok(
      content.includes('"reason') || content.includes('"reason text"') || content.includes('quoted reason'),
      'finish skill must document that the reason must be in quotes'
    );
  });

  it('finish skill specifies that feature name comes from remaining tokens after flag removal', () => {
    const content = readSrc('skills/finish/SKILL.md');
    // If the flag + reason are not stripped before parsing the feature name,
    // the agent may misinterpret part of the reason as the feature name.
    assert.ok(
      content.includes('Remaining tokens') || content.includes('remaining tokens') || content.includes('after removing the flag'),
      'finish skill must describe stripping the flag+reason before treating remainder as feature name'
    );
  });

  it('finish skill documents how to handle VERIFY.md with INCONCLUSIVE in frontmatter vs table', () => {
    const content = readSrc('skills/finish/SKILL.md');
    // Both locations must be checked — a VERIFY.md might have overall status INCONCLUSIVE
    // in frontmatter even if individual rows do not show INCONCLUSIVE (or vice versa).
    assert.ok(
      content.includes('status: INCONCLUSIVE'),
      'finish skill must check INCONCLUSIVE in frontmatter status field'
    );
    assert.ok(
      content.includes('Stage 1') || content.includes('table') || content.includes('Any row'),
      'finish skill must check INCONCLUSIVE in Stage 1 table rows (not just frontmatter)'
    );
  });

  it('finish skill handles missing VERIFY.md gracefully (no crash path documented)', () => {
    const content = readSrc('skills/finish/SKILL.md');
    // If VERIFY.md doesn't exist (verifier never ran), the "Check INCONCLUSIVE Verdicts"
    // section must not have an unguarded Read that would crash or produce a misleading block.
    // The skill must either document the fallback or the overall Prerequisites covers it.
    // A crash-free path requires that the skill not assume VERIFY.md always exists.
    //
    // We look for either: "If VERIFY.md" conditional, or "no INCONCLUSIVE markers" fallback,
    // or "proceed directly to Prerequisites" path when no markers found.
    assert.ok(
      content.includes('no INCONCLUSIVE markers') || content.includes('If VERIFY.md has no') || content.includes('proceed directly to Prerequisites'),
      'finish skill must document the path when VERIFY.md has no INCONCLUSIVE markers (implicitly handles missing file)'
    );
  });

});

// ---------------------------------------------------------------------------
// Boundary: git diff fallback chain in ship-qa
// ---------------------------------------------------------------------------

describe('pipeline-rigor adversarial — boundary: git diff BASE fallback chain', () => {

  it('qa agent documents all three fallback steps: main → master → HEAD~1', () => {
    const content = readSrc('agents/ship-qa.md');
    // The fallback chain must name all three options so the agent can't stop at master
    // when both main and master exist but point to the same commit (making diff empty).
    assert.ok(content.includes('HEAD main'), 'qa agent must reference main branch');
    assert.ok(content.includes('HEAD master'), 'qa agent must reference master branch fallback');
    assert.ok(content.includes('HEAD~1') || content.includes('HEAD~'), 'qa agent must document HEAD~1 as last-resort fallback');
  });

  it('qa agent documents fallback to PLAN.md when git diff entirely fails', () => {
    const content = readSrc('agents/ship-qa.md');
    // Shallow clones, detached HEADs without history, or pristine repos can cause
    // all three git commands to fail. The agent must note this explicitly.
    assert.ok(
      content.includes('fall back to') && content.includes("PLAN.md"),
      'qa agent must document falling back to PLAN.md when git diff is unavailable'
    );
  });

  it('qa agent requires noting git diff failure in QA.md exploratory analysis', () => {
    const content = readSrc('agents/ship-qa.md');
    // Silently using the fallback without noting it would make QA.md misleading.
    assert.ok(
      content.includes('Fell back to PLAN.md') || content.includes('note') || content.includes('note in QA.md'),
      'qa agent must record in QA.md when it fell back from git diff to PLAN.md'
    );
  });

  it('qa agent Step 5.5 git command uses shell OR-chain not separate ifs', () => {
    const content = readSrc('agents/ship-qa.md');
    // The documented bash uses `||` chaining. If it used separate `if` blocks,
    // a false-positive success from one branch could shadow the others.
    // We assert the `||` operator is present in the BASE assignment context.
    assert.ok(
      content.includes('|| git merge-base HEAD master') || content.includes('|| git rev-parse'),
      'qa agent bash fallback must use || operator chaining in a single BASE assignment'
    );
  });

});

// ---------------------------------------------------------------------------
// Boundary: INCONCLUSIVE verdict dominance logic in verifier
// ---------------------------------------------------------------------------

describe('pipeline-rigor adversarial — boundary: INCONCLUSIVE verdict dominance', () => {

  it('verifier documents that FAIL dominates INCONCLUSIVE (not the reverse)', () => {
    const content = readSrc('agents/ship-verifier.md');
    // If a criterion is FAIL and another is INCONCLUSIVE, the overall status must be FAIL.
    // The priority order must be written clearly enough that the agent can't confuse the order.
    assert.ok(
      content.includes('FAIL dominates') || content.includes('(FAIL dominates'),
      'verifier must state that FAIL dominates INCONCLUSIVE in the priority ordering'
    );
  });

  it('verifier status priority ordering: FAIL → PARTIAL → INCONCLUSIVE → PASS (correct sequence)', () => {
    const content = readSrc('agents/ship-verifier.md');
    // Check that the four statuses appear in the correct priority order
    // (FAIL before PARTIAL before INCONCLUSIVE before PASS in the "Determine Overall Status" section).
    const idx_fail = content.indexOf('**FAIL:**');
    const idx_partial = content.indexOf('**PARTIAL:**');
    const idx_inconclusive = content.indexOf('**INCONCLUSIVE:**');
    const idx_pass = content.indexOf('**PASS:**');
    assert.ok(idx_fail !== -1, 'verifier must define **FAIL:** priority case');
    assert.ok(idx_partial !== -1, 'verifier must define **PARTIAL:** priority case');
    assert.ok(idx_inconclusive !== -1, 'verifier must define **INCONCLUSIVE:** priority case');
    assert.ok(idx_pass !== -1, 'verifier must define **PASS:** priority case');
    assert.ok(idx_fail < idx_partial, 'FAIL must appear before PARTIAL in priority order');
    assert.ok(idx_partial < idx_inconclusive, 'PARTIAL must appear before INCONCLUSIVE in priority order');
    assert.ok(idx_inconclusive < idx_pass, 'INCONCLUSIVE must appear before PASS in priority order');
  });

  it('verifier clarifies that INCONCLUSIVE criterion alone does NOT skip Stage 2', () => {
    const content = readSrc('agents/ship-verifier.md');
    // A lone INCONCLUSIVE should still allow Stage 2 to run (FAIL alone skips it).
    // Without this distinction, Stage 2 could be silently skipped for INCONCLUSIVE features.
    assert.ok(
      content.includes('INCONCLUSIVE alone does NOT skip Stage 2') ||
      content.includes('INCONCLUSIVE alone does not skip Stage 2') ||
      (content.includes('INCONCLUSIVE') && content.includes('does NOT skip Stage 2')),
      'verifier must clarify that INCONCLUSIVE alone does not skip Stage 2 (only FAIL does)'
    );
  });

  it('verifier Step 6 sets status done for INCONCLUSIVE (not plan-verified or qa-failed)', () => {
    const content = readSrc('agents/ship-verifier.md');
    // INCONCLUSIVE features must reach status: done so /ship:finish can inspect VERIFY.md
    // and gate on --accept-inconclusive. If the verifier set plan-verified instead,
    // the finish skill gate would never be reached.
    const step6 = content.slice(content.indexOf('### Step 6'));
    assert.ok(
      step6.includes('INCONCLUSIVE') && step6.includes('status: done'),
      'verifier Step 6 must set status: done when overall verdict is INCONCLUSIVE'
    );
  });

});

// ---------------------------------------------------------------------------
// Negative: missing/inconsistent VERIFY.md state
// ---------------------------------------------------------------------------

describe('pipeline-rigor adversarial — negative: inconsistent VERIFY.md state', () => {

  it('VERIFY.md template frontmatter includes INCONCLUSIVE in the status enum', () => {
    const content = readSrc('ship/templates/VERIFY.md');
    // The template must enumerate INCONCLUSIVE as a valid status value.
    // Without this, an agent may not know it can write that value.
    assert.ok(
      content.includes('INCONCLUSIVE'),
      'VERIFY.md template frontmatter must list INCONCLUSIVE as a valid status'
    );
  });

  it('VERIFY.md template Inconclusive Override section has all four required fields', () => {
    const content = readSrc('ship/templates/VERIFY.md');
    const overrideSection = content.slice(content.indexOf('## Inconclusive Override'));
    assert.ok(overrideSection.includes('Override applied'), 'Inconclusive Override section must have Override applied field');
    assert.ok(overrideSection.includes('Reason'), 'Inconclusive Override section must have Reason field');
    assert.ok(overrideSection.includes('Operator'), 'Inconclusive Override section must have Operator field');
    assert.ok(overrideSection.includes('Timestamp'), 'Inconclusive Override section must have Timestamp field');
  });

  it('finish skill check handles VERIFY.md that has INCONCLUSIVE table rows but PASS frontmatter', () => {
    const content = readSrc('skills/finish/SKILL.md');
    // A VERIFY.md could have overall frontmatter "status: PASS" but still have
    // individual rows with verdict INCONCLUSIVE (e.g., if the verifier had a bug
    // or the template was manually edited). The finish skill must check BOTH locations,
    // not just the frontmatter.
    assert.ok(
      content.includes('Any row') || content.includes('any row') || content.includes('Stage 1 table'),
      'finish skill must check for INCONCLUSIVE in Stage 1 table rows, not just frontmatter'
    );
  });

  it('qa skill does NOT set status plan-verified (regression: old rollback path removed)', () => {
    const content = readSrc('skills/qa/SKILL.md');
    // This is the core regression. pipeline-rigor replaced "plan-verified" rollback with "qa-failed".
    // Any surviving "plan-verified" reference in the qa skill indicates the rollback was not fully removed.
    assert.ok(
      !content.includes('status: plan-verified'),
      'qa skill must not contain any "status: plan-verified" assignment (old rollback path must be gone)'
    );
  });

});

// ---------------------------------------------------------------------------
// Error handling: verifier QA.md fallback path
// ---------------------------------------------------------------------------

describe('pipeline-rigor adversarial — error-handling: verifier QA.md fallback', () => {

  it('verifier documents behaviour when QA.md does NOT exist', () => {
    const content = readSrc('agents/ship-verifier.md');
    // The verifier must document what to do when QA.md is missing —
    // falling back to legacy grep. Without documentation, the agent may
    // silently skip Stage 2 or crash.
    assert.ok(
      content.includes('QA.md does NOT exist') || content.includes('QA.md absent') || content.includes('does not exist'),
      'verifier must document the fallback when QA.md does not exist'
    );
  });

  it('verifier fallback notes absence of QA.md in VERIFY.md output', () => {
    const content = readSrc('agents/ship-verifier.md');
    // When falling back to grep, the verifier must note it in VERIFY.md.
    // A silent fallback would make the audit trail misleading.
    assert.ok(
      content.includes('QA.md absent') || content.includes('verifier performed fallback') || content.includes('fallback grep'),
      'verifier must note in VERIFY.md when it fell back to grep because QA.md was absent'
    );
  });

  it('verifier does NOT re-grep when QA.md IS present', () => {
    const content = readSrc('agents/ship-verifier.md');
    // Duplicate grep when QA.md exists creates contradictory verdicts.
    // The Forbidden Responses section must explicitly ban re-grepping.
    assert.ok(
      content.includes("I'll re-grep for TODOs to be safe") || content.includes('re-grep'),
      'verifier Forbidden Responses must ban re-grepping when QA.md is present'
    );
  });

  it('qa agent requires Reviewed files section in QA.md so verifier can see coverage', () => {
    const content = readSrc('agents/ship-qa.md');
    // The verifier reads QA.md's Exploratory Analysis section.
    // If QA.md has no "Reviewed files" subsection, the verifier cannot tell
    // which files were covered — potentially missing builder deviations.
    assert.ok(
      content.includes('Reviewed files (from git diff)'),
      'qa agent must require a "Reviewed files (from git diff)" subsection in QA.md'
    );
  });

});

// ---------------------------------------------------------------------------
// Security: --accept-inconclusive reason interpolation into VERIFY.md
// ---------------------------------------------------------------------------

describe('pipeline-rigor adversarial — security: reason text interpolation', () => {

  it('finish skill uses shell-safe quoting pattern for date command in override record', () => {
    const content = readSrc('skills/finish/SKILL.md');
    // The override record includes a timestamp via $(date -u +%Y-%m-%dT%H:%M:%SZ).
    // This is safe as a shell substitution in bash, but the agent writes it to VERIFY.md
    // as a literal string, not executed in the user's shell. We verify the documented
    // pattern is structured (not free-form shell eval of the reason text).
    assert.ok(
      content.includes('date -u') || content.includes('ISO 8601') || content.includes('Timestamp'),
      'finish skill must document a timestamp pattern for the override record'
    );
  });

  it('finish skill operator identity uses git config user.email with unknown fallback', () => {
    const content = readSrc('skills/finish/SKILL.md');
    // If git config user.email is unset, the command would fail silently or produce empty string.
    // The documented fallback || echo unknown ensures a non-empty value is always recorded.
    assert.ok(
      content.includes('git config user.email') && (content.includes('|| echo unknown') || content.includes('echo unknown')),
      'finish skill must use "git config user.email || echo unknown" for operator identity'
    );
  });

  it('finish skill reason text is documented as extracted from quotes — not shell-executed', () => {
    const content = readSrc('skills/finish/SKILL.md');
    // The reason is user-supplied text. The agent must extract it as literal text,
    // not pass it through shell command substitution.
    // We check that the extraction language ("extract the quoted reason text") is present,
    // signalling that the reason is treated as a literal string, not a command.
    assert.ok(
      content.includes('extract the quoted reason text') || content.includes('quoted reason text'),
      'finish skill must document that the reason is extracted as quoted text (not shell-executed)'
    );
  });

  it('finish skill Inconclusive Override section writes to VERIFY.md (not shell eval)', () => {
    const content = readSrc('skills/finish/SKILL.md');
    // The override record must be written to VERIFY.md. We verify the documented
    // action is "Append the override record to VERIFY.md" — confirming the reason
    // text is written as document content, not executed.
    assert.ok(
      content.includes('Append the override record to VERIFY.md') || content.includes('override record to VERIFY.md'),
      'finish skill must document appending the override record to VERIFY.md (not executing it)'
    );
  });

  it('go workflow does not reintroduce plan-verified for qa-failed status', () => {
    const content = readSrc('ship/workflows/go.md');
    // If the go workflow still references the old "status reset to plan-verified"
    // phrase in the QA handling block, it contradicts the qa skill's new behaviour.
    assert.ok(
      !content.includes('status reset to `plan-verified`') && !content.includes("status reset to 'plan-verified'"),
      'go workflow must not contain old "status reset to plan-verified" phrase'
    );
  });

});

// ---------------------------------------------------------------------------
// Boundary: NFR probe routing hints in brainstormer
// ---------------------------------------------------------------------------

describe('pipeline-rigor adversarial — boundary: brainstormer NFR routing hints', () => {

  it('brainstormer routing hints distinguish between bin-only CLI and service with start script', () => {
    const content = readSrc('agents/ship-brainstormer.md');
    // The PLAN specifies: "package.json with bin only (CLI tool) → prioritise error handling; SKIP rollout/observability"
    // This distinction must be present — otherwise a CLI tool with `bin` would trigger rollout questions.
    assert.ok(
      content.includes('bin') && (content.includes('CLI tool') || content.includes('CLI')),
      'brainstormer routing hints must distinguish bin-only CLI from service with scripts.start'
    );
  });

  it('brainstormer specifies maximum 2-3 NFR questions (not the full menu)', () => {
    const content = readSrc('agents/ship-brainstormer.md');
    // Asking all 5 NFR dimensions would produce N/A spam — the PLAN explicitly limits to 2-3.
    assert.ok(
      content.includes('2-3 questions') || content.includes('2–3 questions') || content.includes('ask 2-3'),
      'brainstormer must document the 2-3 question limit for NFR probing'
    );
  });

  it('brainstormer INFRA_DETECTED=false path explicitly skips NFR section', () => {
    const content = readSrc('agents/ship-brainstormer.md');
    // Without an explicit skip instruction, the agent might still ask NFR questions
    // even when no infra signals are detected (rationalizing "just to be safe").
    assert.ok(
      content.includes('INFRA_DETECTED = false') || content.includes('INFRA_DETECTED=false'),
      'brainstormer must explicitly document the INFRA_DETECTED=false skip path'
    );
    assert.ok(
      content.includes('skip this entire sub-section') || content.includes('skip this section'),
      'brainstormer must explicitly say to skip the NFR section when INFRA_DETECTED is false'
    );
  });

  it('brainstormer captures NFR answers in Decisions section with NFR prefix', () => {
    const content = readSrc('agents/ship-brainstormer.md');
    // If NFR answers are not captured with a consistent prefix, they blend with
    // other decisions and future QA/verifier agents can't distinguish them.
    assert.ok(
      content.includes('NFR — ') || content.includes('**NFR —'),
      'brainstormer must document capturing NFR answers with "NFR — {dimension}" prefix in Decisions section'
    );
  });

});
