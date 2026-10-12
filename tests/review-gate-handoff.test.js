/**
 * Review-gate handoff invariants (v5.26.0).
 *
 * An audit of 455 reviewed phases and the Workflow engine's subagent
 * transcripts found the reviewer agent healthy and the losses downstream:
 *
 * 1. Medium/low findings were a dead end — 221 of them against 101
 *    critical+high, every one routed to `recorded` and read by nothing. The
 *    last three verifiers pulled them in off-contract and reproduced every
 *    medium as a real bug.
 * 2. The re-review's evidence was never checked or kept, so a re-review that
 *    ran nothing and read nothing turned every critical into "fixed in fix
 *    round".
 * 3. The manual build skill branched on the verdict, so an APPROVED carrying
 *    a critical was recorded and the phase moved on; it also never salvaged
 *    the scratch record the reviewer pays to write.
 * 4. Step 1 only re-ran the plan's `<verify>` strings, so a regression in a
 *    sibling test (fix-live-prompt-conflicts phase 3) passed review.
 * 5. The handed diff range was trusted blindly, and the no-commits fallback
 *    asked for `git diff HEAD`, which is empty on a committed phase.
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
const verifySkill = () => readSrc('skills/verify/SKILL.md');
const template = () => readSrc('ship/templates/VERIFY.md');

// Same dry-run harness as tests/rearchitecture-v4.test.js.
function runWorkflow(args, scenario) {
  const src = wf().replace(/^export const meta = \{[\s\S]*?\n\}\n/m, '');
  const calls = [];
  const prompts = {};
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '';
    calls.push(label);
    prompts[label] = prompt;
    for (const k of Object.keys(scenario)) {
      if (k !== '__default' && label.startsWith(k)) {
        return typeof scenario[k] === 'function' ? scenario[k](label) : scenario[k];
      }
    }
    return scenario.__default;
  };
  const noop = () => {};
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t()));
  const pipeline = async () => { throw new Error('pipeline not expected'); };
  const budget = { total: null, spent: () => 0, remaining: () => Infinity };
  const fn = new Function('args', 'phase', 'log', 'parallel', 'pipeline', 'agent', 'budget',
    `return (async () => { ${src}\n })()`);
  return fn(args, noop, noop, parallel, pipeline, agent, budget).then((result) => ({ result, calls, prompts }));
}

const COMPLETE = { feature: 'f', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['abc1234'] };
const FIX = { feature: 'f', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['fix1234'] };
const VERDICT = { feature: 'f', status: 'PASS', criteria_total: 1, criteria_passed: 1 };
const evidence = { verify_runs: [{ command: 'npm test', verdict: 'pass', exit_code: 0 }], files_reviewed: ['x.js'] };
const HIGH = { severity: 'high', file: 'x.js:1', description: 'real bug' };
const MEDIUM = { severity: 'medium', file: 'y.js:9', description: 'draft leaks across tasks' };
const LOW = { severity: 'low', file: 'z.js:3', description: 'misleading name' };
const ONE_PHASE = { feature: 'f', phases: [{ id: 'p1', name: 'A' }] };

// ---------------------------------------------------------------------------
// 1 — recorded (medium/low) findings reach the verifier
// ---------------------------------------------------------------------------

describe('handoff — recorded findings reach the verifier', () => {
  it('the workflow carries medium/low findings as a located-targets block', async () => {
    const review = { feature: 'f', status: 'APPROVED', findings: [MEDIUM, LOW], ...evidence };
    const { result, prompts } = await runWorkflow(ONE_PHASE,
      { 'build:': COMPLETE, 'review:': review, verify: VERDICT, __default: review });
    assert.deepEqual(result.completed[0].recorded.map((f) => f.severity), ['medium', 'low']);
    assert.deepEqual(result.completed[0].unresolved, [], 'medium/low never become unresolved');
    assert.match(prompts.verify, /## Recorded Review Findings — located targets/);
    assert.match(prompts.verify, /\[medium\] phase p1 — y\.js:9: draft leaks across tasks/);
    assert.match(prompts.verify, /\[low\] phase p1 — z\.js:3/);
    assert.ok(!/## Unresolved Review Findings/.test(prompts.verify),
      'no unresolved block when nothing critical/high survived');
  });

  it('a clean review adds no block at all — the prompt is unchanged', async () => {
    const clean = { feature: 'f', status: 'APPROVED', findings: [], ...evidence };
    const { prompts } = await runWorkflow(ONE_PHASE,
      { 'build:': COMPLETE, 'review:': clean, verify: VERDICT, __default: clean });
    assert.ok(!/Recorded Review Findings/.test(prompts.verify));
    assert.ok(!/Unresolved Review Findings/.test(prompts.verify));
  });

  it('medium/low raised by a substantiated re-review are recorded too', async () => {
    const review = { feature: 'f', status: 'NEEDS_FIXES', findings: [HIGH], ...evidence };
    const rereview = { feature: 'f', status: 'APPROVED', findings: [{ ...MEDIUM, new_issue: true }], ...evidence };
    const { result, prompts } = await runWorkflow(ONE_PHASE,
      { 'build:': COMPLETE, 'review:': review, 'fix:': FIX, 'rereview:': rereview, verify: VERDICT, __default: review });
    assert.equal(result.completed[0].unresolved.length, 0, 'the high was confirmed fixed');
    assert.deepEqual(result.completed[0].recorded, [{ ...MEDIUM, new_issue: true }]);
    assert.match(prompts.verify, /Recorded Review Findings/);
  });

  it('the gate-skip entry carries the new keys as empty collections', async () => {
    const { result } = await runWorkflow({ ...ONE_PHASE, reviewGate: false },
      { 'build:': COMPLETE, verify: VERDICT, __default: VERDICT });
    const e = result.completed[0];
    for (const key of ['recorded', 'rereviewFindings', 'rereviewVerifyRuns', 'rereviewFilesReviewed']) {
      assert.deepEqual(e[key], [], `${key} must be an empty array on a profile skip`);
    }
    assert.equal(e.rereviewStatus, null);
  });

  it('the verifier, verify skill, go skill and template all name recorded findings as targets', () => {
    const inputs = verifier().split('## Inputs')[1].split('## Verification Depth')[0];
    assert.match(inputs, /`recorded`/, 'the verifier must be told to collect recorded findings');
    assert.match(inputs, /Recorded Review Findings/, 'the verifier must know the prompt block by name');
    const stage2b = verifier().split('### 2b')[1].split('### 2c')[0];
    assert.match(stage2b, /Recorded review findings come after the gates and before any discretionary test/);
    assert.match(stage2b, /recorded review findings \(uncapped\)/, 'the 2b order line must place them');
    assert.match(verifySkill(), /Every finding marked recorded/);
    assert.match(goSkill(), /`recorded` findings/);
    assert.match(template(), /recorded medium\/low ones are located targets/);
  });

  it('the reviewer is no longer told a medium is consequence-free', () => {
    const c = reviewer();
    assert.ok(!/so do not inflate medium findings/.test(c));
    assert.match(c, /every medium and low finding is handed to the verifier/);
  });
});

// ---------------------------------------------------------------------------
// 2 — the re-review's evidence is checked and kept
// ---------------------------------------------------------------------------

describe('handoff — re-review evidence', () => {
  it('an unsubstantiated re-review keeps every blocking finding unresolved', async () => {
    const review = { feature: 'f', status: 'NEEDS_FIXES', findings: [HIGH], ...evidence };
    const stamp = { feature: 'f', status: 'APPROVED', findings: [], verify_runs: [], files_reviewed: [] };
    const { result } = await runWorkflow(ONE_PHASE,
      { 'build:': COMPLETE, 'review:': review, 'fix:': FIX, 'rereview:': stamp, verify: VERDICT, __default: review });
    const e = result.completed[0];
    assert.equal(e.fixApplied, true, 'the fix round did land commits');
    assert.deepEqual(e.unresolved, [HIGH], 'a rubber-stamp re-review confirms nothing');
    assert.deepEqual(e.introducedByFix, []);
    assert.ok(e.concerns.some((c) => /re-review re-ran no verify commands and reviewed no files/.test(c)));
    assert.equal(e.rereviewStatus, 'APPROVED');
    assert.deepEqual(e.rereviewVerifyRuns, []);
  });

  it('a substantiated re-review still clears the findings and is kept as its own record', async () => {
    const review = { feature: 'f', status: 'NEEDS_FIXES', findings: [HIGH], ...evidence };
    const rereview = { feature: 'f', status: 'APPROVED', findings: [], ...evidence };
    const { result } = await runWorkflow(ONE_PHASE,
      { 'build:': COMPLETE, 'review:': review, 'fix:': FIX, 'rereview:': rereview, verify: VERDICT, __default: review });
    const e = result.completed[0];
    assert.deepEqual(e.unresolved, []);
    assert.equal(e.rereviewStatus, 'APPROVED');
    assert.deepEqual(e.rereviewVerifyRuns, evidence.verify_runs);
    assert.deepEqual(e.rereviewFilesReviewed, ['x.js']);
    assert.ok(!e.concerns.some((c) => /re-review re-ran no/.test(c)));
  });

  it('new_issue findings from a substantiated re-review are still labelled', async () => {
    const review = { feature: 'f', status: 'NEEDS_FIXES', findings: [HIGH], ...evidence };
    const NEW = { severity: 'critical', file: 'w.js:2', description: 'fix broke it', new_issue: true };
    const rereview = { feature: 'f', status: 'NEEDS_FIXES', findings: [NEW], ...evidence };
    const { result } = await runWorkflow(ONE_PHASE,
      { 'build:': COMPLETE, 'review:': review, 'fix:': FIX, 'rereview:': rereview, verify: VERDICT, __default: review });
    assert.deepEqual(result.completed[0].introducedByFix, [NEW]);
    assert.deepEqual(result.completed[0].unresolved, [NEW]);
  });

  it('both orchestrators write a round-2 block with the re-review evidence', () => {
    assert.match(goSkill(), /\(round 2\)`, with `Status: \{rereviewStatus\}`/);
    assert.match(goSkill(), /rereviewVerifyRuns/);
    const b = buildSkill();
    assert.match(b, /Check the re-review's evidence the same way as the review's/);
    assert.match(b, /append a \*\*round-2 block\*\*/);
  });

  it('the reviewer contract says a re-review without evidence is no re-review', () => {
    assert.match(reviewer(), /a re-review that reports neither is treated as no re-review/);
  });
});

// ---------------------------------------------------------------------------
// 3 — the manual build path matches the workflow
// ---------------------------------------------------------------------------

describe('handoff — manual build path', () => {
  it('branches on the findings, not the verdict', () => {
    const gate = buildSkill().split('### 3.1 Review Gate')[1].split('**REVIEW.md format**')[0];
    assert.match(gate, /Branch on the findings, not on `status`/);
    assert.match(gate, /If the blocking set is non-empty/);
    assert.ok(!/4\. \*\*If status is "APPROVED":\*\*/.test(gate),
      'the status-keyed APPROVED branch must be gone');
  });

  it('salvages the scratch record before declaring a review skipped', () => {
    const gate = buildSkill().split('### 3.1 Review Gate')[1].split('**REVIEW.md format**')[0];
    assert.ok(!/do NOT retry/.test(gate), 'the blanket no-retry rule must be gone');
    assert.match(gate, /\.review-scratch\/phase-\{id\}\.json/);
    assert.match(gate, /`stage` is `complete`, adopt/);
    assert.match(gate, /verify-only/);
    assert.match(gate, /A broken reviewer must never block a working build/,
      'the skip path must still exist once salvage is exhausted');
  });
});

// ---------------------------------------------------------------------------
// 4 — Step 1b neighbouring tests and the baseline check
// ---------------------------------------------------------------------------

describe('handoff — reviewer coverage beyond the plan', () => {
  it('Step 1b runs the tests neighbouring each changed source file', () => {
    const c = reviewer();
    assert.match(c, /## Step 1b — Neighbouring Tests/);
    const step = c.split('## Step 1b — Neighbouring Tests')[1].split('## Step 2')[0];
    assert.match(step, /non-test source file/);
    assert.match(step, /task_id: null/, 'the run must land in verify_runs');
    assert.match(step, /never a whole-suite command/);
    assert.match(step, /10 closest/);
    assert.match(step, /\*\*`high`\*\* finding/, 'a HEAD-only failure is a high regression');
  });

  it('not_runnable on a non-zero exit needs a baseline at the range base', () => {
    const step1 = reviewer().split('## Step 1 — Trust-but-Verify')[1].split('## Step 1b')[0];
    assert.match(step1, /Pre-existing failures — the baseline check/);
    assert.match(step1, /git worktree add --detach "\$TRIAL" "\$BASE"/);
    assert.match(step1, /git worktree remove --force "\$TRIAL"/);
    assert.match(step1, /When you cannot produce the baseline, or the failing set differs, the verdict is `fail`/);
  });

  it('the verify-only checkpoint is written after Step 1b, so a salvage cannot skip it', () => {
    const c = reviewer();
    const step1 = c.split('## Step 1 — Trust-but-Verify')[1].split('## Step 1b')[0];
    assert.ok(!/Write the staged scratch record/.test(step1),
      'the checkpoint must not sit between Step 1 and Step 1b');
    const step1b = c.split('## Step 1b — Neighbouring Tests')[1].split('## Step 2')[0];
    assert.match(step1b, /Write the staged scratch record \(see Output\) only now, after Step 1b/);
    const step0 = c.split('## Step 0 — Salvage Check')[1].split('## Step 1')[0];
    assert.match(step0, /Skip Step 1 and 1b/);
    assert.match(c, /\*\*After Step 1b\*\* \(never between Step 1 and 1b\)/);
    assert.match(wf(), /skip Step 1 and 1b, and do Step 2 only/);
  });

  it('the verifier runs only unresolved findings before the gates', () => {
    const stage2b = verifier().split('### 2b')[1].split('### 2c')[0];
    assert.match(stage2b, /take every \*unresolved\* finding you collected/);
  });

  it('the round-2 marker checks introducedByFix before unresolved', () => {
    const line = goSkill().split('one line per entry in `rereviewFindings`:')[1].split('\n')[0];
    assert.ok(line.indexOf('`new (round 2)`') < line.indexOf('`unresolved`'),
      'introducedByFix is a subset of unresolved, so it must be matched first');
  });

  it('the hard gate permits the throwaway worktree and nothing else', () => {
    const gate = reviewer().split('<HARD-GATE>')[1].split('</HARD-GATE>')[0];
    assert.match(gate, /detached throwaway worktree/);
    assert.match(gate, /never for editing files in the checkout/);
  });
});

// ---------------------------------------------------------------------------
// 5 — the diff range is checked, and the no-commits fallback is correct
// ---------------------------------------------------------------------------

describe('handoff — diff range', () => {
  it('the reviewer cross-checks the handed range against PLAN.md commit attributes', () => {
    const inputs = reviewer().split('## Inputs')[1].split('## Step 0')[0];
    assert.match(inputs, /Coverage check/);
    assert.match(inputs, /git log --format=%h \{range\}/);
    assert.match(inputs, /widen the range to `\{oldest-missing-commit\}~1\.\.HEAD`/);
  });

  it('the no-commits fallback never asks for a bare git diff HEAD', () => {
    const m = wf().match(/const rangeInstruction = \(range\) => range[\s\S]*?\n\nconst reviewPrompt/);
    assert.ok(m, 'rangeInstruction not found');
    const fn = new Function(`${m[0].replace(/\n\nconst reviewPrompt$/, '')}\nreturn rangeInstruction(null)`);
    const text = fn();
    assert.ok(!/review the uncommitted working-tree changes via `git diff HEAD`/.test(text));
    assert.match(text, /commit="\.\.\."/, 'derive from PLAN.md commit attributes first');
    assert.match(text, /git merge-base HEAD main/, 'uncommitted work diffs against the merge-base');
  });
});

// ---------------------------------------------------------------------------
// 6 — release bookkeeping
// ---------------------------------------------------------------------------

describe('handoff — release', () => {
  it('the three version files agree and the changelog has the section', () => {
    const v = readSrc('ship/VERSION').trim();
    assert.equal(JSON.parse(readSrc('package.json')).version, v);
    assert.equal(JSON.parse(readSrc('.claude-plugin/plugin.json')).version, v);
    assert.ok(readSrc('CHANGELOG.md').includes(`## ${v}`), `CHANGELOG must carry a ## ${v} section`);
  });
});
