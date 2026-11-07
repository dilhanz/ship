/**
 * Fix-class sweep in verify fix phases (v5.30.0).
 *
 * rpfs finance-meter-readings needed three verify fix rounds for one defect
 * class: a date with no bound rendered in the year-less "d MMM" format.
 * - Fix round 2's task fixed one site.
 * - Its phase reviewer saw the same class one function over and recorded it as
 *   a low.
 * - Lows never gate, so no fix round ran.
 * - The verifier raised it to a medium and failed the feature again.
 *
 * 1. In a `fix-{n}` phase, a reviewer finding marked `fix_class` gates the
 *    phase at any severity, so the in-phase fix round clears it.
 * 2. The fix phase's builder and reviewer both get the sweep rule up front.
 * 3. `--auto` no longer claims to be a fully hands-off run: a verify FAIL
 *    stops it, by design.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const wf = () => readSrc('ship/workflows/go.workflow.js');
const reviewer = () => readSrc('agents/ship-reviewer.md');
const goSkill = () => readSrc('skills/go/SKILL.md');
const buildSkill = () => readSrc('skills/build/SKILL.md');
const readme = () => readSrc('README.md');

// Same dry-run harness as tests/fix-loop-reduction.test.js.
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
const evidence = { verify_runs: [{ command: 'npm test', verdict: 'pass', exit_code: 0 }], files_reviewed: ['x.cs'] };
const FIX_PHASE = { feature: 'f', phases: [{ id: 'fix-2', name: 'Verify fix round 2' }] };
const FEATURE_PHASE = { feature: 'f', phases: [{ id: 'p1', name: 'A' }] };

const SIBLING_LOW = {
  severity: 'low', file: 'Presentation.cs:120',
  description: 'history row renders the unbounded previous reading as "d MMM"',
  pattern: 'an unbounded past date rendered in the year-less "d MMM" format',
  sites: ['Presentation.cs:120'], fix_class: true,
};
const PLAIN_LOW = { severity: 'low', file: 'z.cs:3', description: 'misleading name' };
const clean = { feature: 'f', status: 'APPROVED', findings: [], ...evidence };

describe('fix-class sweep — a same-class sibling gates a fix phase', () => {
  it('a fix_class low runs the fix round and the re-review, even under APPROVED', async () => {
    const review = { feature: 'f', status: 'APPROVED', findings: [SIBLING_LOW], ...evidence };
    const { calls, result, prompts } = await runWorkflow(FIX_PHASE, {
      build: COMPLETE, review, fix: FIX, rereview: clean, verify: VERDICT,
    });
    assert.ok(calls.includes('fix:fix-2'), `fix round must run, calls: ${calls.join(', ')}`);
    assert.ok(calls.includes('rereview:fix-2'));
    const p = result.completed[0];
    assert.equal(p.fixApplied, true);
    assert.deepEqual(p.recorded, [], 'a gating fix-class finding is not also a recorded target');
    assert.deepEqual(p.unresolved, []);
    assert.match(prompts['fix:fix-2'], /\[low, fix-class\] Presentation\.cs:120/,
      'the fix builder sees the finding tagged fix-class');
  });

  it('a fix_class finding the re-review still reports survives as unresolved', async () => {
    const review = { feature: 'f', status: 'NEEDS_FIXES', findings: [SIBLING_LOW], ...evidence };
    const rereview = { feature: 'f', status: 'NEEDS_FIXES', findings: [SIBLING_LOW], ...evidence };
    const { result, prompts } = await runWorkflow(FIX_PHASE, {
      build: COMPLETE, review, fix: FIX, rereview, verify: VERDICT,
    });
    assert.equal(result.completed[0].unresolved.length, 1);
    assert.match(prompts['rereview:fix-2'], /keeps `"fix_class": true`/);
  });

  it('a plain low still does not gate a fix phase', async () => {
    const review = { feature: 'f', status: 'APPROVED', findings: [PLAIN_LOW], ...evidence };
    const { calls, result } = await runWorkflow(FIX_PHASE, { build: COMPLETE, review, verify: VERDICT });
    assert.ok(!calls.includes('fix:fix-2'));
    assert.equal(result.completed[0].recorded.length, 1);
  });

  it('the schema declares fix_class, since additionalProperties is false', () => {
    const schema = wf().split('const REVIEW_SCHEMA')[1].split('const PROGRESS_SCHEMA')[0];
    assert.match(schema, /fix_class: \{ type: 'boolean' \}/);
  });
});

describe('fix-class sweep — the sweep rule reaches the fix phase up front', () => {
  it('a fix phase builder and reviewer are told to sweep the class across the feature', async () => {
    const { prompts } = await runWorkflow(FIX_PHASE, { build: COMPLETE, review: clean, verify: VERDICT });
    assert.match(prompts['build:fix-2'], /This is a verify fix phase/);
    assert.match(prompts['build:fix-2'], /git merge-base HEAD origin\/main/);
    assert.match(prompts['review:fix-2'], /"fix_class": true/);
  });

  it('a fix phase continuation builder keeps the sweep (PR #50 review)', async () => {
    let n = 0;
    const build = () => (++n === 1
      ? { feature: 'f', status: 'PARTIAL', tasks_completed: 1, tasks_total: 2, commits: ['abc1234'] }
      : COMPLETE);
    const { calls, prompts } = await runWorkflow(FIX_PHASE, { build, review: clean, verify: VERDICT });
    const cont = calls.filter((c) => c.startsWith('build:fix-2') && c !== 'build:fix-2');
    assert.ok(cont.length >= 1, `expected a continuation round, got ${calls.join(', ')}`);
    assert.match(prompts[cont[0]], /Continue building feature/);
    assert.match(prompts[cont[0]], /This is a verify fix phase/);
    assert.match(prompts[cont[0]], /git merge-base HEAD origin\/main/);
  });

  it('a fix-class re-review searches the whole feature, not just the phase (PR #50 review)', async () => {
    const review = { feature: 'f', status: 'APPROVED', findings: [SIBLING_LOW], ...evidence };
    const { prompts } = await runWorkflow(FIX_PHASE, {
      build: COMPLETE, review, fix: FIX, rereview: clean, verify: VERDICT,
    });
    assert.match(prompts['rereview:fix-2'], /finding tagged fix-class, search this feature's changed files \(`git diff --name-only \$\(git merge-base/);
    assert.match(reviewer(), /for a fix-class finding, the feature's changed files/);
    assert.match(buildSkill(), /for a `fix_class` finding, the feature's changed files since the merge-base/);
  });

  it('the reviewer can derive the feature-wide file set itself on the manual path (PR #50 review)', () => {
    assert.match(reviewer(), /which you run yourself when the prompt does not supply it/);
    assert.match(reviewer(), /review the phase's own diff range as usual/);
  });

  it('a feature phase gets neither addition', async () => {
    const { prompts } = await runWorkflow(FEATURE_PHASE, { build: COMPLETE, review: clean, verify: VERDICT });
    assert.doesNotMatch(prompts['build:p1'], /verify fix phase/);
    assert.doesNotMatch(prompts['review:p1'], /fix_class/);
  });

  it('the reviewer contract defines fix phases and the field', () => {
    const r = reviewer();
    assert.match(r, /### Fix Phases/);
    assert.match(r, /feature's changed files/);
    assert.match(r, /or any finding with `"fix_class": true`/, 'NEEDS_FIXES definition');
  });

  it('both orchestrators agree on what gates a phase', () => {
    assert.match(buildSkill(), /every finding of any severity marked `"fix_class": true`/);
    assert.match(goSkill(), /any finding with `fix_class: true`/);
  });
});

describe('--auto wording matches what it does', () => {
  it('the go skill no longer calls --auto a fully hands-off run', () => {
    assert.doesNotMatch(goSkill(), /Pass `--auto` for a fully hands-off run/);
    assert.match(goSkill(), /A verify FAIL still stops the run/);
  });

  it('the README lists the verify FAIL stop', () => {
    assert.doesNotMatch(readme(), /exactly twice/);
    assert.match(readme(), /A FAIL still stops an `--auto` run/);
  });
});

// PR #49 made per-task dispatch the default: a fix phase with a task list never
// reaches buildPrompt/reviewPrompt, so the sweep must live in the per-task
// prompts and the package review too, or 5.30.0 is off by default.
describe('fix-class sweep — per-task build mode', () => {
  const { run, WORKFLOW } = require('./go-per-phase-golden.test.js');
  const src = fs.readFileSync(WORKFLOW, 'utf8');
  const T = { id: '7', name: 'Add the year to history dates', docsOnly: false };
  const perTaskFix = { feature: 'demo', shipRoot: '/r', phases: [{ id: 'fix-2', name: 'Verify fix round 2', tasks: [T] }] };
  const DONE = { feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['aaa1111'],
    verify_evidence: [{ task_id: '7', command: 'node --test', exit_code: 0 }] };
  const OK = { feature: 'demo', status: 'APPROVED', findings: [], verify_runs: [], files_reviewed: ['a.js'] };
  const PASS = { feature: 'demo', status: 'PASS', criteria_total: 1, criteria_passed: 1 };
  const prompt = (calls, l) => (calls.find((c) => c.label === l) || {}).prompt || '';

  it('the task builder, its continuation and the package reviewer all carry the sweep', async () => {
    let n = 0;
    const { calls } = await run(src, perTaskFix, (label) => {
      if (label === 'build:fix-2:t7') return { ...DONE, status: 'PARTIAL', commits: [] };
      if (label.startsWith('build:fix-2:t7:cont')) return ++n === 1 ? DONE : null;
      if (label.startsWith('progress')) return { tasks_done: 0, tasks_pending: 1, tasks_total: 1, commits: [], working_tree_clean: true };
      if (label === 'review:fix-2') return OK;
      if (label === 'verify') return PASS;
      return null;
    });
    const labels = calls.map((c) => c.label);
    assert.ok(labels.includes('build:fix-2:t7:cont1'), labels.join(', '));
    for (const l of ['build:fix-2:t7', 'build:fix-2:t7:cont1']) {
      assert.match(prompt(calls, l), /This is a verify fix phase/, l);
      assert.match(prompt(calls, l), /git merge-base HEAD origin\/main/, l);
    }
    assert.match(prompt(calls, 'review:fix-2'), /review-package\.cjs/);
    assert.match(prompt(calls, 'review:fix-2'), /"fix_class": true/);
  });

  it('a per-task feature phase gets no sweep', async () => {
    const args = { ...perTaskFix, phases: [{ id: 'p1', name: 'Core', tasks: [T] }] };
    const { calls } = await run(src, args, (label) => (label === 'build:p1:t7' ? DONE
      : label === 'review:p1' ? OK : label === 'verify' ? PASS : null));
    assert.doesNotMatch(prompt(calls, 'build:p1:t7'), /verify fix phase/);
    assert.doesNotMatch(prompt(calls, 'review:p1'), /fix_class/);
  });
});
