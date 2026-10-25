/**
 * Fix-loop reduction (v5.29.0).
 *
 * Two weeks of rpfs go runs (32 features, 89 verifier runs) spent more on
 * re-verifications than on first verifications: 58 re-verify runs against 31
 * first ones. The fix rounds behind them had causes the spine could prevent:
 *
 * 1. A medium the phase reviewer had already reproduced was only `recorded`,
 *    so the verifier re-found it, failed, and a whole fix round plus a full
 *    re-verify cleared what an in-phase fix round would have.
 * 2. Fixes repaired one call site of a defect class per round — one feature
 *    fixed last-writer-wins saves one method at a time through five verifies.
 * 3. Trial merges failed on rows both sides appended to a shared file, each
 *    one a fix round.
 * 4. The builder never saw the verify checklist it was failed against.
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
const builder = () => readSrc('agents/ship-builder.md');
const goSkill = () => readSrc('skills/go/SKILL.md');
const buildSkill = () => readSrc('skills/build/SKILL.md');
const template = () => readSrc('ship/templates/VERIFY.md');

// Same dry-run harness as tests/review-gate-handoff.test.js.
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
        const v = typeof scenario[k] === 'function' ? scenario[k](label) : scenario[k];
        if (v instanceof Error) throw v;
        return v;
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
const ONE_PHASE = { feature: 'f', phases: [{ id: 'p1', name: 'A' }] };

const REPRODUCED = {
  severity: 'medium', file: 'svc.cs:40', description: 'reopen racing a save is reverted',
  reproduced: true, pattern: 'save writes the stale copy back with an unconditional Update',
  sites: ['svc.cs:40', 'svc.cs:88', 'assign.cs:12'],
};
const UNREPRODUCED = { severity: 'medium', file: 'y.js:9', description: 'draft leaks across tasks' };
const LOW = { severity: 'low', file: 'z.js:3', description: 'misleading name' };

const clean = { feature: 'f', status: 'APPROVED', findings: [], ...evidence };

// ---------------------------------------------------------------------------
// 1 — a reproduced medium gates the phase
// ---------------------------------------------------------------------------

describe('fix loop — a reproduced medium gates the phase', () => {
  it('runs the fix round and the re-review for a reproduced medium, even under APPROVED', async () => {
    const review = { feature: 'f', status: 'APPROVED', findings: [REPRODUCED], ...evidence };
    const { calls, result } = await runWorkflow(ONE_PHASE, {
      build: COMPLETE, review, fix: FIX, rereview: clean, verify: VERDICT,
    });
    assert.ok(calls.includes('fix:p1'), `fix round must run, calls: ${calls.join(', ')}`);
    assert.ok(calls.includes('rereview:p1'));
    const p = result.completed[0];
    assert.equal(p.fixApplied, true);
    assert.deepEqual(p.recorded, [], 'a gating medium is not also a recorded target');
    assert.deepEqual(p.unresolved, []);
  });

  it('an unreproduced medium does not gate — it travels to the verifier as before', async () => {
    const review = { feature: 'f', status: 'APPROVED', findings: [UNREPRODUCED, LOW], ...evidence };
    const { calls, result, prompts } = await runWorkflow(ONE_PHASE, {
      build: COMPLETE, review, verify: VERDICT,
    });
    assert.ok(!calls.includes('fix:p1'), 'no fix round for an unreproduced medium');
    assert.equal(result.completed[0].recorded.length, 2);
    assert.match(prompts.verify, /\[medium\] phase p1 — y\.js:9: draft leaks across tasks/);
  });

  it('reproduced: false and a reproduced low do not gate', async () => {
    const review = {
      feature: 'f', status: 'APPROVED', ...evidence,
      findings: [{ ...UNREPRODUCED, reproduced: false }, { ...LOW, reproduced: true }],
    };
    const { calls } = await runWorkflow(ONE_PHASE, { build: COMPLETE, review, verify: VERDICT });
    assert.ok(!calls.includes('fix:p1'));
  });

  it('a reproduced medium that survives the re-review is carried as an unresolved mandatory target', async () => {
    const review = { feature: 'f', status: 'NEEDS_FIXES', findings: [REPRODUCED], ...evidence };
    const rereview = { feature: 'f', status: 'NEEDS_FIXES', findings: [{ ...REPRODUCED, sites: ['assign.cs:12'] }], ...evidence };
    const { result, prompts } = await runWorkflow(ONE_PHASE, {
      build: COMPLETE, review, fix: FIX, rereview, verify: VERDICT,
    });
    assert.equal(result.completed[0].unresolved.length, 1);
    assert.match(prompts.verify, /## Unresolved Review Findings — mandatory targets/);
    assert.match(prompts.verify, /\[medium, reproduced\] phase p1 — svc\.cs:40: reopen racing a save is reverted/);
    assert.match(prompts.verify, /Sites: assign\.cs:12\./, 'the missed site must reach the verifier');
  });

  it('a medium the re-reviewer did not reproduce again drops back to a located target', async () => {
    const review = { feature: 'f', status: 'NEEDS_FIXES', findings: [REPRODUCED], ...evidence };
    const { reproduced, ...still } = REPRODUCED;
    const rereview = { feature: 'f', status: 'APPROVED', findings: [still], ...evidence };
    const { result } = await runWorkflow(ONE_PHASE, {
      build: COMPLETE, review, fix: FIX, rereview, verify: VERDICT,
    });
    assert.deepEqual(result.completed[0].unresolved, []);
    assert.equal(result.completed[0].recorded.length, 1);
  });

  it('the review schema declares reproduced, pattern and sites (additionalProperties is false)', () => {
    const c = wf();
    const schema = c.slice(c.indexOf('const REVIEW_SCHEMA'), c.indexOf('const PROGRESS_SCHEMA'));
    assert.match(schema, /reproduced: \{ type: 'boolean' \}/);
    assert.match(schema, /pattern: \{ type: 'string' \}/);
    assert.match(schema, /sites: \{ type: 'array', items: \{ type: 'string' \} \}/);
  });
});

// ---------------------------------------------------------------------------
// 2 — fixes sweep the defect class
// ---------------------------------------------------------------------------

describe('fix loop — fixes cover the defect class, not one site', () => {
  it('the fix prompt carries the pattern, every site, and the sweep rule', async () => {
    const review = { feature: 'f', status: 'NEEDS_FIXES', findings: [REPRODUCED], ...evidence };
    const { prompts } = await runWorkflow(ONE_PHASE, {
      build: COMPLETE, review, fix: FIX, rereview: clean, verify: VERDICT,
    });
    const p = prompts['fix:p1'];
    assert.match(p, /Pattern: save writes the stale copy back/);
    assert.match(p, /Sites: svc\.cs:40, svc\.cs:88, assign\.cs:12\./);
    assert.match(p, /Fix the defect class, not the instance/);
    assert.match(p, /cover each one with a test/);
  });

  it('the re-review must check every site', async () => {
    const review = { feature: 'f', status: 'NEEDS_FIXES', findings: [REPRODUCED], ...evidence };
    const { prompts } = await runWorkflow(ONE_PHASE, {
      build: COMPLETE, review, fix: FIX, rereview: clean, verify: VERDICT,
    });
    assert.match(prompts['rereview:p1'], /at every site, not just the first/);
    assert.match(prompts['rereview:p1'], /an occurrence the fix missed means the finding is not resolved/);
  });

  it('the verify prompt asks for one bug per defect class', async () => {
    const { prompts } = await runWorkflow(ONE_PHASE, { build: COMPLETE, review: clean, verify: VERDICT });
    assert.match(prompts.verify, /## One bug per defect class/);
  });

  it('the verify schema accepts pattern and sites on a bug', () => {
    const c = wf();
    const schema = c.slice(c.indexOf('const VERIFY_SCHEMA'), c.indexOf('const SYNC_SCHEMA'));
    assert.match(schema, /pattern: \{ type: 'string' \}/);
    assert.match(schema, /sites: \{ type: 'array', items: \{ type: 'string' \} \}/);
  });

  it('agents and skills state the sweep', () => {
    assert.match(reviewer(), /### One finding per defect class/);
    assert.match(verifier(), /\*\*One bug per defect class\.\*\*/);
    assert.match(verifier(), /re-run the pattern search for each bug the previous round fixed/);
    assert.match(builder(), /covers the finding's whole defect class/);
    assert.match(buildSkill(), /Fix the defect class, not the instance/);
    assert.match(goSkill(), /naming every `sites` entry and the `pattern`/);
    assert.match(template(), /One row per defect class, not per call site/);
  });
});

// ---------------------------------------------------------------------------
// 3 — main is synced before the verifier runs
// ---------------------------------------------------------------------------

describe('fix loop — sync with main before verify', () => {
  it('absent syncMain keeps the previous behavior: no sync agent', async () => {
    const { calls, result } = await runWorkflow(ONE_PHASE, { build: COMPLETE, review: clean, verify: VERDICT });
    assert.ok(!calls.some((c) => c.startsWith('sync')));
    assert.equal(result.sync, null);
  });

  it('syncMain: true runs one sync builder after the build and before the verifier', async () => {
    const SYNC = { outcome: 'merged', target: 'origin/main', commit: 'm3rge01', conflicted_files: ['COVERAGE.md'], notes: null };
    const { calls, result } = await runWorkflow({ ...ONE_PHASE, syncMain: true }, {
      build: COMPLETE, review: clean, sync: SYNC, verify: VERDICT,
    });
    const s = calls.indexOf('sync:main');
    assert.ok(s > calls.indexOf('review:p1') && s < calls.indexOf('verify'), calls.join(', '));
    assert.equal(calls.filter((c) => c.startsWith('sync')).length, 1);
    assert.deepEqual(result.sync, SYNC);
  });

  it('accepts the string form the go skill may hand-build', async () => {
    const { calls } = await runWorkflow({ ...ONE_PHASE, syncMain: 'true' }, {
      build: COMPLETE, review: clean, sync: { outcome: 'up-to-date' }, verify: VERDICT,
    });
    assert.ok(calls.includes('sync:main'));
  });

  it('a verify-only run (no pending phases) still syncs', async () => {
    const { calls } = await runWorkflow({ feature: 'f', phases: [], syncMain: true }, {
      sync: { outcome: 'up-to-date' }, verify: VERDICT,
    });
    assert.deepEqual(calls, ['sync:main', 'verify']);
  });

  it('a stopped build never syncs', async () => {
    const { calls } = await runWorkflow({ ...ONE_PHASE, syncMain: true }, {
      build: { ...COMPLETE, status: 'CHECKPOINT', stopped_at: '1', reason: 'r' },
    });
    assert.ok(!calls.includes('sync:main'));
  });

  it('a sync that dies twice does not stop verification', async () => {
    const { calls, result } = await runWorkflow({ ...ONE_PHASE, syncMain: true }, {
      build: COMPLETE, review: clean, sync: new Error('boom'), verify: VERDICT,
    });
    assert.ok(calls.includes('verify'));
    assert.equal(result.sync, null);
    assert.equal(result.verdict.status, 'PASS');
  });

  it('the sync prompt is merge-only, mechanical-only, and stands down for a salvage', () => {
    const c = wf();
    const p = c.slice(c.indexOf('const syncPrompt'), c.indexOf('const salvageReviewPrompt'));
    assert.match(p, /never rebase, never push, never force/);
    assert.match(p, /git merge --abort/);
    assert.match(p, /resolve ONLY mechanical ones/);
    assert.match(p, /\.review-scratch\/verify\.json/);
    assert.match(p, /IS the default branch/);
    assert.match(p, /MERGE_HEAD/, 'a retry must clear a merge a dead sync left half-done');
    assert.match(p, /never a bulk add/);
  });

  it('the go skill always passes syncMain: true and reports the outcome', () => {
    assert.match(goSkill(), /syncMain: true/);
    assert.match(goSkill(), /\[If sync is non-null:\] Sync with main/);
  });
});

// ---------------------------------------------------------------------------
// 4 — the checklist reaches the builder and the reviewer
// ---------------------------------------------------------------------------

describe('fix loop — the verify checklist moves left', () => {
  it('the builder reads the checklist and self-checks before committing', () => {
    const b = builder();
    assert.match(b, /`\.planning\/verify-checklist\.md` — if present/);
    assert.match(b, /3b\. \*\*Self-check against the verify checklist\*\*/);
    assert.match(b, /record it in `concerns`/, 'work outside the task files is surfaced, not done');
  });

  it('the reviewer checks the phase diff against the checklist', () => {
    assert.match(reviewer(), /\*\*The verify checklist\*\* — when `\.planning\/verify-checklist\.md` exists/);
  });

  it('the reviewer reproduces cheaply and outside the checkout', () => {
    const r = reviewer();
    assert.match(r, /### Reproduce a medium when it is cheap/);
    assert.match(r, /\*\*outside the checkout\*\*/);
    assert.match(r, /Never set it on reasoning alone, and never on a `low`/);
    assert.match(r, /or a medium with `"reproduced": true`/, 'NEEDS_FIXES definition');
  });

  it('the manual build path gates on the same set as the workflow', () => {
    assert.match(buildSkill(), /plus every medium marked `"reproduced": true`/);
  });
});
