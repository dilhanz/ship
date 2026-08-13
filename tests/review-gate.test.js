/**
 * Review-gate invariants.
 *
 * The per-phase review gate reported more safety than it had, in four places:
 *
 * 1. REVIEW.md was write-only. `/ship:go` justified marking a phase done with
 *    unresolved critical findings on the grounds that "the verifier is the
 *    backstop", but the verifier's inputs were CONTEXT.md and PLAN.md — nothing
 *    ever read REVIEW.md, so the backstop was never told what to catch.
 * 2. A fix round that committed nothing still got a re-review. With no fix
 *    commits there is no range, so the re-reviewer inspected `git diff HEAD`,
 *    found a clean tree, and approved — and the reconcile recorded every
 *    finding as "fixed in fix round".
 * 3. `{status: "APPROVED", findings: []}` was the whole contract, so a review
 *    that ran every verify command and read the whole diff was byte-identical
 *    to one that read nothing.
 * 4. The re-review was scoped to "ONLY whether each finding is now resolved",
 *    so the fix commits — end-of-phase edits, a classic regression source —
 *    were never reviewed as a diff in their own right.
 *
 * These tests lock in the fixes across both orchestrators (the go workflow and
 * the manual build skill), since the gate exists on both paths.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const wf = () => readSrc('ship/workflows/go.workflow.js');
const reviewer = () => readSrc('agents/ship-reviewer.md');
const verifier = () => readSrc('agents/ship-verifier.md');
const goSkill = () => readSrc('skills/go/SKILL.md');
const buildSkill = () => readSrc('skills/build/SKILL.md');

// ---------------------------------------------------------------------------
// 1 — REVIEW.md is read, not just written
// ---------------------------------------------------------------------------

describe('review gate — unresolved findings reach the verifier', () => {
  it('the verifier reads REVIEW.md as an input', () => {
    const inputs = verifier().split('## Inputs')[1].split('## Stage 0')[0];
    assert.ok(inputs.includes('REVIEW.md'),
      'REVIEW.md must be a verifier input — it is the only record of what the fix round failed to clear');
    assert.ok(/unresolved/.test(inputs),
      'the verifier must be pointed at the unresolved markers specifically, not the whole log');
  });

  it('carried findings are mandatory Stage 2b targets, not optional colour', () => {
    const c = verifier();
    const stage2b = c.split('### 2b')[1].split('### 2c')[0];
    assert.ok(/not optional/i.test(stage2b),
      'Stage 2b must state that carried findings are not optional');
    for (const outcome of ['reproduced', 'not reproduced', 'not testable']) {
      assert.ok(stage2b.includes(outcome),
        `Stage 2b must require a per-finding outcome including "${outcome}"`);
    }
    assert.ok(/by inspection alone/i.test(stage2b),
      'a carried finding must not be closed by reading the code — only a command decides it');
  });

  it('a reproduced carried finding blocks PASS', () => {
    assert.ok(/reproduced carried review finding is such a bug/.test(verifier()),
      'the verdict rule must say a reproduced carried finding counts as a critical/high bug');
  });

  it('VERIFY.md reserves a table for the carried findings', () => {
    const t = readSrc('ship/templates/VERIFY.md');
    assert.ok(t.includes('Carried Review Findings'),
      'the template must reserve a section for carried review findings');
    assert.ok(/None carried/.test(t),
      'an empty table must be explicitly "none carried" so it cannot read as "not checked"');
  });

  it('the go workflow hands the findings over in the prompt, because the file is written later', () => {
    const c = wf();
    assert.ok(c.includes('Unresolved Review Findings'),
      'the verify prompt must carry the unresolved findings block');
    assert.ok(/carriedBlock/.test(c) && /\$\{carriedBlock\}/.test(c),
      'the block must actually be interpolated into the verify prompt');
    assert.ok(/persists that after this workflow returns|after this workflow returns/.test(c),
      'the comment must explain why the prompt, not REVIEW.md, is the handoff on this path');
  });

  it('the manual verify skill points the verifier at REVIEW.md too', () => {
    assert.ok(readSrc('skills/verify/SKILL.md').includes('REVIEW.md'),
      '/ship:verify must tell the verifier to read REVIEW.md — on that path it is already on disk');
  });

  it('go reconciles the verdict against the findings it carried', () => {
    assert.ok(/Carried Review Findings/.test(goSkill()),
      'go must cross-check that VERIFY.md accounted for each unresolved finding');
  });
});

// ---------------------------------------------------------------------------
// 2 — a fix round that commits nothing cannot be recorded as a fix
// ---------------------------------------------------------------------------

describe('review gate — empty fix round', () => {
  it('the workflow skips the re-review when no fix commits landed', () => {
    const c = wf();
    assert.ok(/if \(!fixCommits\.length\)/.test(c),
      'the workflow must branch on the fix round producing no commits');
    assert.ok(/fixSkipped/.test(c),
      'the skipped-fix state must be tracked so it can reach the concerns channel');
  });

  it('a skipped fix round leaves the findings unresolved, never "fixed"', () => {
    const c = wf();
    // fixApplied is what the reconcile turns into "fixed in fix round".
    assert.ok(c.includes('fixApplied: !!fixRound && !fixSkipped'),
      'fixApplied must be false when the fix round landed nothing, or REVIEW.md will claim a fix that never happened');
    const unresolved = c.split('const unresolved =')[1].split('\n')[0];
    assert.ok(/!rereview/.test(unresolved),
      'with no re-review the blocking findings must carry through as unresolved');
  });

  it('the manual build path guards the same way', () => {
    const c = buildSkill();
    assert.ok(/no commits/.test(c) && /skip the re-review/i.test(c),
      'the build skill must skip its re-review when the fix builder committed nothing');
    assert.ok(/worse than sending none/.test(c),
      'the build skill should record why an empty-diff re-review is worse than no re-review');
  });
});

// ---------------------------------------------------------------------------
// 3 — a review must return its own evidence
// ---------------------------------------------------------------------------

describe('review gate — review evidence', () => {
  it('verify_runs and files_reviewed are required schema fields', () => {
    const schema = wf().split('const REVIEW_SCHEMA')[1].split('const PROGRESS_SCHEMA')[0];
    assert.ok(/required: \['feature', 'status', 'findings', 'verify_runs', 'files_reviewed'\]/.test(schema),
      'both evidence fields must be required — optional evidence is no evidence');
    for (const verdict of ['pass', 'fail', 'not_runnable']) {
      assert.ok(schema.includes(`'${verdict}'`),
        `verify_runs must carry a ${verdict} verdict`);
    }
    assert.ok(/exit_code/.test(schema), 'each verify run must record its exit code');
  });

  it('the reviewer contract defines both fields and forbids omitting them', () => {
    const c = reviewer();
    assert.ok(c.includes('verify_runs') && c.includes('files_reviewed'),
      'the reviewer must emit both evidence fields');
    assert.ok(/not optional and not decorative/i.test(c),
      'the contract must state the evidence fields are mandatory');
    assert.ok(/## What NOT to Do/.test(c),
      'the reviewer needs the anti-rubber-stamp section its plan-review counterpart already has');
    assert.ok(/Rubber-stamp/i.test(c),
      'rubber-stamping must be named as the failure mode');
  });

  it('an all-not_runnable phase is escalated instead of waved through', () => {
    const c = reviewer();
    assert.ok(/If \*\*every\*\* verify command/.test(c),
      'a phase where nothing could be re-run has no executable proof and must escalate');
    assert.ok(/`high` finding/.test(c.split('If **every** verify command')[1].split('##')[0]),
      'that escalation must be a high finding, not another low note');
  });

  it('both orchestrators surface an unsubstantiated verdict', () => {
    assert.ok(/unsubstantiated/.test(wf()),
      'the workflow must flag a review that re-ran nothing and read nothing');
    assert.ok(/unsubstantiated/.test(buildSkill()),
      'the build skill must flag the same case');
  });

  it('REVIEW.md records the evidence counts per phase', () => {
    for (const [f, c] of [['skills/build/SKILL.md', buildSkill()], ['skills/go/SKILL.md', goSkill()]]) {
      assert.ok(/Verify: \{N\} re-run|Verify: \{N\} re-run/.test(c),
        `${f} must write the verify re-run counts into REVIEW.md`);
      assert.ok(/Reviewed: \{M\} file/.test(c),
        `${f} must write the reviewed-file count into REVIEW.md`);
    }
  });

  it('go writes a heading for every phase, including clean ones', () => {
    // The evidence lines only pay off if a clean phase records them too: an
    // APPROVED heading over "Verify: 0 re-run" is the case worth catching.
    const c = goSkill();
    assert.ok(/every\*\* phase/.test(c) || /for \*\*every\*\* phase/.test(c),
      'go must no longer skip phases with an empty findings array');
    assert.ok(c.includes('Status: SKIPPED'),
      'an unreviewed phase must still be recorded (v5.0.2 invariant)');
  });
});

// ---------------------------------------------------------------------------
// 4 — the re-review looks at the fix commits as a diff, not just a checklist
// ---------------------------------------------------------------------------

describe('review gate — re-review scope', () => {
  it('the reviewer contract gives re-reviews two jobs', () => {
    const c = reviewer();
    assert.ok(/## Re-Reviews/.test(c), 'the reviewer needs an explicit re-review contract');
    const section = c.split('## Re-Reviews')[1].split('## Severity')[0];
    assert.ok(/Resolution/.test(section) && /New damage/.test(section),
      're-reviews must cover both resolution of old findings and damage from the fixes');
    assert.ok(/new_issue/.test(section),
      'a fix-introduced problem must be distinguishable from a leftover');
    assert.ok(/Do not re-review the rest of the phase/.test(section),
      'the widened scope must still stop short of re-reviewing the whole phase');
  });

  it('the workflow no longer scopes the re-review to resolution only', () => {
    const c = wf();
    assert.ok(!/review ONLY whether each finding above is now resolved/.test(c),
      'the resolution-only re-review prompt must be gone');
    const prompt = c.split('const rereviewPrompt')[1].split('// Salvage retry')[0];
    assert.ok(/new_issue/.test(prompt), 'the re-review prompt must ask for new_issue flagging');
    assert.ok(/in their own right/.test(prompt),
      'the re-review prompt must ask for the fix commits to be reviewed as a diff');
  });

  it('new_issue is in the schema and separated in the result', () => {
    const c = wf();
    assert.ok(/new_issue: \{ type: 'boolean' \}/.test(c),
      'new_issue must be a schema field or the agent cannot return it');
    assert.ok(/introducedByFix/.test(c),
      'fix-introduced findings must be separated for labelling');
    assert.ok(/introducedByFix = surviving\.filter/.test(c),
      'introducedByFix must be derived from the surviving critical/high findings');
  });

  it('the manual path asks for both jobs too', () => {
    const c = buildSkill();
    assert.ok(/new_issue/.test(c), 'the build skill re-review must ask for new_issue flagging');
    assert.ok(/new \(round 2\)/.test(c),
      'REVIEW.md needs a marker distinguishing fix-introduced findings from leftovers');
  });
});

// ---------------------------------------------------------------------------
// 5 — staged scratch record (a turn-exhausted reviewer keeps the expensive half)
// ---------------------------------------------------------------------------

describe('review gate — staged scratch record', () => {
  it('the reviewer writes the record twice, stamped with a stage', () => {
    const c = reviewer();
    assert.ok(/"stage"/.test(c), 'the scratch record must carry a stage key');
    assert.ok(/verify-only/.test(c) && /complete/.test(c),
      'both stages must be named');
    assert.ok(/After Step 1/.test(c) && /After Step 2/.test(c),
      'the two writes must be pinned to the two steps');
  });

  it('salvage routes on the stage instead of assuming completeness', () => {
    const c = reviewer();
    const step0 = c.split('## Step 0 — Salvage Check')[1].split('## Step 1')[0];
    assert.ok(/verify-only/.test(step0),
      'Step 0 must handle a partial record, not just complete or absent');
    assert.ok(/Skip Step 1/.test(step0),
      'a verify-only record must let the reviewer skip the expensive re-runs it already paid for');
  });

  it('the workflow salvage prompt knows all three cases', () => {
    const prompt = wf().split('const salvageReviewPrompt')[1].split('// Same principle')[0];
    assert.ok(/stage/.test(prompt), 'the salvage prompt must route on the stage field');
    assert.ok(/verify-only/.test(prompt), 'the salvage prompt must handle the partial record');
    assert.ok(/Fall back to the full review/.test(prompt),
      'a missing record must still produce a real review (v5.4.2 invariant)');
  });
});
