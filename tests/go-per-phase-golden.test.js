/**
 * The per-phase build path is pinned byte for byte.
 *
 * `buildMode: 'per-phase'` is the rollback knob for the per-task builder: it
 * must reproduce exactly the builder, probe, review, fix, re-review, sync and
 * verify prompts the workflow sent before per-task dispatch existed. The
 * fixture under tests/fixtures/ was captured from the base commit (ec12c3c)
 * and is compared here against the current script, in two arg shapes:
 *   (i)  today's args — no buildMode, no task lists;
 *   (ii) buildMode 'per-phase' with every phase carrying a task list, which
 *        proves the knob overrides the task list.
 *
 * Regenerate (only when a deliberate per-phase prompt change lands):
 *   git show ec12c3c:ship/workflows/go.workflow.js > "$TMPDIR/go-base.js"
 *   SHIP_GOLDEN_WRITE="$TMPDIR/go-base.js" node --test tests/go-per-phase-golden.test.js
 *
 * The model is deliberately excluded from the fixture: the base commit named
 * none, and tests/go-agent-models.test.js owns that contract.
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const WORKFLOW = path.join(repoRoot, 'ship', 'workflows', 'go.workflow.js');
const FIXTURE = path.join(repoRoot, 'tests', 'fixtures', 'go-per-phase-prompts.json');

// Mirror the engine: run the script body in an async fn with the globals
// injected. `resolve(label, prompt)` returns the agent's result, or a function
// that is called instead (so a scenario can throw).
async function run(src, args, resolve) {
  const body = src.replace(/^export const meta/m, 'const meta');
  const calls = [];
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '';
    calls.push({ label, agentType: opts.agentType || null, prompt, model: opts.model });
    const out = resolve(label, prompt);
    if (typeof out === 'function') return out();
    return out;
  };
  const phase = () => {};
  const log = () => {};
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t()));
  const pipeline = async () => { throw new Error('pipeline not expected'); };
  const budget = { total: null, spent: () => 0, remaining: () => Infinity };
  const fn = new Function('args', 'phase', 'log', 'parallel', 'pipeline', 'agent', 'budget',
    `return (async () => { ${body}\n })()`);
  const result = await fn(args, phase, log, parallel, pipeline, agent, budget);
  return { result, calls };
}

async function collect(src, args, resolve) {
  const { calls } = await run(src, args, resolve);
  return calls.map(({ label, agentType, prompt }) => ({ label, agentType, prompt }));
}

const FEATURE = 'demo';
const GENERIC = () => { throw new Error('agent({schema}): subagent completed without calling StructuredOutput'); };
const complete = (done, total, commits) => ({
  feature: FEATURE, status: 'COMPLETE', tasks_completed: done, tasks_total: total, commits,
});
const partial = (done, total, commits) => ({
  feature: FEATURE, status: 'PARTIAL', tasks_completed: done, tasks_total: total, commits,
});
const probe = (done, pending, clean, commits = []) => ({
  tasks_done: done, tasks_pending: pending, tasks_total: done + pending, commits, working_tree_clean: clean,
});
const APPROVED = { feature: FEATURE, status: 'APPROVED', findings: [], verify_runs: [{ command: 'npm test', verdict: 'pass' }], files_reviewed: ['a.js'] };
const PASS = { feature: FEATURE, status: 'PASS', criteria_total: 2, criteria_passed: 2 };
const CRITICAL = { severity: 'critical', file: 'a.js', description: 'null deref', recommendation: 'guard it', pattern: 'unguarded deref', sites: ['a.js:3', 'a.js:9'] };
const MEDIUM = { severity: 'medium', file: 'b.js', description: 'off by one' };

const ONE = [{ id: '1', name: 'one' }];
const TWO = [{ id: '1', name: 'one' }, { id: '2', name: 'two' }];

// Each scenario: base args (shape i) and a label-keyed resolver.
const SCENARIOS = [
  {
    name: 'complete-approved-pass',
    args: { phases: ONE },
    resolve: (label) => {
      if (label === 'build:1') return complete(2, 2, ['aaa1111', 'bbb2222']);
      if (label === 'review:1') return APPROVED;
      if (label === 'verify') return PASS;
      return null;
    },
  },
  {
    name: 'partial-continuation',
    args: { phases: ONE, keyFileContext: 'ctx: src/a.js' },
    resolve: (label) => {
      if (label === 'build:1') return partial(1, 3, ['aaa1111']);
      if (label === 'build:1:cont1') return complete(2, 3, ['bbb2222', 'ccc3333']);
      if (label === 'review:1') return APPROVED;
      if (label === 'verify') return PASS;
      return null;
    },
  },
  {
    name: 'dead-builder-probe-dirty-salvage',
    args: { phases: ONE },
    resolve: (label) => {
      if (label === 'build:1') return null;
      if (label === 'progress:1') return probe(2, 2, true, ['aaa1111', 'bbb2222']);
      if (label === 'build:1:cont1') return null;
      if (label === 'progress:1:cont1') return probe(2, 2, false, ['aaa1111', 'bbb2222']);
      if (label === 'build:1:cont2') return complete(2, 4, ['ccc3333', 'ddd4444']);
      if (label === 'review:1') return APPROVED;
      if (label === 'verify') return PASS;
      return null;
    },
  },
  {
    name: 'critical-fix-rereview',
    args: { phases: TWO },
    resolve: (label) => {
      if (label === 'build:1') return complete(1, 1, ['aaa1111']);
      if (label === 'review:1') return { ...APPROVED, status: 'NEEDS_FIXES', findings: [CRITICAL, MEDIUM] };
      if (label === 'fix:1') return complete(1, 1, ['fff1111']);
      if (label === 'rereview:1') return APPROVED;
      if (label === 'build:2') return complete(1, 1, []);
      if (label === 'review:2') return APPROVED;
      if (label === 'verify') return PASS;
      return null;
    },
  },
  {
    name: 'flat-all-phase',
    args: { phases: [{ id: 'all', name: 'all' }] },
    resolve: (label) => {
      if (label === 'build:all') return complete(3, 3, ['aaa1111']);
      if (label === 'review:all') return APPROVED;
      if (label === 'verify') return PASS;
      return null;
    },
  },
  {
    name: 'sync-main',
    args: { phases: ONE, syncMain: true },
    resolve: (label) => {
      if (label === 'build:1') return complete(1, 1, ['aaa1111']);
      if (label === 'review:1') return APPROVED;
      if (label === 'sync:main') return { outcome: 'merged', target: 'main', commit: 'mmm1111', conflicted_files: [], notes: null };
      if (label === 'verify') return PASS;
      return null;
    },
  },
  {
    name: 'verifier-dies-canary',
    args: { phases: ONE },
    resolve: (label) => {
      if (label === 'build:1') return complete(1, 1, ['aaa1111']);
      if (label === 'review:1') return APPROVED;
      if (label === 'verify' || label === 'verify:retry') return GENERIC;
      if (label === 'canary:verify') return GENERIC;
      return null;
    },
  },
];

// Shape (i): today's args.
const shapeToday = (args) => ({ feature: FEATURE, ...args });

// Shape (ii): the rollback knob set, with every phase carrying a task list.
const shapePerPhase = (args) => ({
  feature: FEATURE,
  ...args,
  buildMode: 'per-phase',
  phases: args.phases.map((ph) => ({
    ...ph,
    tasks: [{ id: `${ph.id}1`, name: 'first', docsOnly: false }, { id: `${ph.id}2`, name: 'notes', docsOnly: true }],
  })),
});

async function collectAll(src, shape) {
  const out = {};
  for (const s of SCENARIOS) out[s.name] = await collect(src, shape(s.args), s.resolve);
  return out;
}

module.exports = { run, collect, SCENARIOS, shapeToday, shapePerPhase, WORKFLOW, FEATURE };

if (require.main === module) {
  const { describe, it } = require('node:test');
  const assert = require('node:assert/strict');

  if (process.env.SHIP_GOLDEN_WRITE) {
    describe('golden fixture — write mode', () => {
      it(`captures every scenario from ${process.env.SHIP_GOLDEN_WRITE}`, async () => {
        const src = fs.readFileSync(process.env.SHIP_GOLDEN_WRITE, 'utf8');
        const out = await collectAll(src, shapeToday);
        fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
        fs.writeFileSync(FIXTURE, `${JSON.stringify(out, null, 2)}\n`);
      });
    });
  } else {
    describe('go workflow — per-phase prompts match the golden fixture', () => {
      const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
      const src = fs.readFileSync(WORKFLOW, 'utf8');

      it('the fixture covers every scenario', () => {
        assert.deepEqual(Object.keys(fixture).sort(), SCENARIOS.map((s) => s.name).sort());
        for (const s of SCENARIOS) assert.ok(fixture[s.name].length > 0, `${s.name} recorded no calls`);
      });

      for (const s of SCENARIOS) {
        it(`${s.name}: today's args reproduce the fixture`, async () => {
          assert.deepEqual(await collect(src, shapeToday(s.args), s.resolve), fixture[s.name]);
        });
        it(`${s.name}: buildMode per-phase with task lists reproduces the fixture`, async () => {
          assert.deepEqual(await collect(src, shapePerPhase(s.args), s.resolve), fixture[s.name]);
        });
      }
    });
  }
}
