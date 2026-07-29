/**
 * v4.0.0 re-architecture invariants.
 *
 * Covers the workflow-engine /ship:go, the 4-agent / 2-layer-verification
 * structure, removal of the QA layer and subagent-stop hook, and the surviving
 * behaviours that carried over (INCONCLUSIVE verdicts, --accept-inconclusive
 * override, brainstormer NFR probe). Also dry-runs the go workflow control flow.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(repoRoot, rel));

// ---------------------------------------------------------------------------
// Removals — the superseded pieces must be gone
// ---------------------------------------------------------------------------

describe('v4 — removed pieces', () => {
  it('QA layer is gone (agent, skill, template)', () => {
    assert.ok(!exists('agents/ship-qa.md'), 'ship-qa agent must be removed');
    assert.ok(!exists('skills/qa/SKILL.md'), '/ship:qa skill must be removed');
    assert.ok(!exists('ship/templates/QA.md'), 'QA.md template must be removed');
  });

  it('subagent-stop hook is gone and deregistered', () => {
    assert.ok(!exists('hooks/subagent-stop.cjs'), 'subagent-stop.cjs must be removed');
    const hooks = readSrc('hooks/hooks.json');
    assert.ok(!hooks.includes('SubagentStop'), 'hooks.json must not register SubagentStop');
    assert.ok(!hooks.includes('subagent-stop'), 'hooks.json must not reference subagent-stop');
  });

  it('the old go.md markdown state-machine is gone', () => {
    assert.ok(!exists('ship/workflows/go.md'), 'go.md must be replaced by the workflow script');
  });

  it('qa-passed / qa-failed states are no longer documented', () => {
    for (const f of ['CLAUDE.md', 'README.md', 'skills/resume/SKILL.md', 'skills/status/SKILL.md', 'skills/help/SKILL.md']) {
      const c = readSrc(f);
      assert.ok(!c.includes('qa-passed'), `${f} must not mention qa-passed`);
      assert.ok(!c.includes('qa-failed'), `${f} must not mention qa-failed`);
    }
  });
});

// ---------------------------------------------------------------------------
// Structure — 4 agents, workflow script, go skill wiring
// ---------------------------------------------------------------------------

describe('v4 — agent roster', () => {
  it('exactly the 4 expected agents exist', () => {
    const agents = fs.readdirSync(path.join(repoRoot, 'agents')).filter((f) => f.endsWith('.md')).sort();
    assert.deepEqual(agents, ['ship-brainstormer.md', 'ship-builder.md', 'ship-reviewer.md', 'ship-verifier.md']);
  });

  it('agents are slimmed — no rationalization / forbidden-responses scaffolding', () => {
    for (const a of ['ship-brainstormer', 'ship-builder', 'ship-reviewer', 'ship-verifier']) {
      const c = readSrc(`agents/${a}.md`);
      assert.ok(!/Rationalization Table/i.test(c), `${a} should not carry a Rationalization Table`);
      assert.ok(!/Forbidden Responses/i.test(c), `${a} should not carry a Forbidden Responses section`);
    }
  });

  it('reviewer absorbs trust-but-verify (re-runs phase verify commands)', () => {
    const c = readSrc('agents/ship-reviewer.md');
    assert.ok(/Trust-but-Verify/i.test(c), 'reviewer should run the trust-but-verify step');
    assert.ok(c.includes('re-run') && c.includes('verify'), 'reviewer should re-run verify commands');
  });

  it('verifier is the single gate — does its own bug hunt + anti-pattern scan + INCONCLUSIVE', () => {
    const c = readSrc('agents/ship-verifier.md');
    assert.ok(c.includes('adversarial'), 'verifier should write adversarial tests');
    assert.ok(/anti-pattern/i.test(c), 'verifier should scan for anti-patterns');
    assert.ok(c.includes('INCONCLUSIVE'), 'verifier should keep the INCONCLUSIVE verdict');
    assert.ok(!c.includes('QA.md'), 'verifier should no longer read a separate QA.md');
    assert.ok(!c.includes('/review Findings'), 'verifier should no longer ingest pre-gathered /review findings');
  });
});

describe('v4 — go workflow wiring', () => {
  it('workflow script exists with a pure meta literal and the two phases', () => {
    const c = readSrc('ship/workflows/go.workflow.js');
    assert.ok(/export const meta\s*=/.test(c), 'script must export a meta literal');
    assert.ok(c.includes("title: 'Build'") && c.includes("title: 'Verify'"), 'meta must declare Build and Verify phases');
  });

  it('workflow drives the ship agents via agentType + schema', () => {
    const c = readSrc('ship/workflows/go.workflow.js');
    assert.ok(c.includes("agentType: 'ship:ship-builder'"), 'workflow must invoke the builder agentType');
    assert.ok(c.includes("agentType: 'ship:ship-reviewer'"), 'workflow must invoke the reviewer agentType');
    assert.ok(c.includes("agentType: 'ship:ship-verifier'"), 'workflow must invoke the verifier agentType');
    assert.ok(c.includes('schema: BUILD_SCHEMA') && c.includes('schema: VERIFY_SCHEMA'), 'workflow must use schema-validated output');
  });

  it('go skill invokes the Workflow tool and no longer references /ship:qa', () => {
    const c = readSrc('skills/go/SKILL.md');
    assert.ok(c.includes('Workflow(') && c.includes('go.workflow.js'), 'go skill must launch the workflow script');
    assert.ok(c.includes('allowed-tools') && /Workflow/.test(c), 'go skill must allow the Workflow tool');
    assert.ok(!c.includes('/ship:qa'), 'go skill must not reference the removed qa step');
  });

  it('verify skill triggers on built and drops /review + QA shuttling', () => {
    const c = readSrc('skills/verify/SKILL.md');
    assert.ok(c.includes('status `built`'), 'verify should trigger on built');
    assert.ok(!c.includes('QA Findings') && !c.includes('/review Findings'), 'verify must not pre-gather findings');
  });
});

// ---------------------------------------------------------------------------
// Surviving behaviours that must NOT regress
// ---------------------------------------------------------------------------

describe('v4 — surviving behaviours', () => {
  it('VERIFY.md template is 2-stage with INCONCLUSIVE + override section', () => {
    const c = readSrc('ship/templates/VERIFY.md');
    assert.ok(c.includes('## Stage 1 — Acceptance Criteria'), 'template keeps a criteria stage');
    assert.ok(c.includes('## Stage 2 — Bug Hunt & Quality'), 'template merges bug hunt + quality into stage 2');
    assert.ok(!c.includes('Stage 3') && !c.includes('Stage 4'), 'template must drop the /review and QA stages');
    assert.ok(c.includes('INCONCLUSIVE'), 'template keeps INCONCLUSIVE');
    assert.ok(c.includes('## Inconclusive Override'), 'template keeps the override section');
  });

  it('finish skill still parses --accept-inconclusive and records the operator', () => {
    const c = readSrc('skills/finish/SKILL.md');
    assert.ok(c.includes('--accept-inconclusive'), 'finish keeps the override flag');
    assert.ok(c.includes('git config user.email'), 'finish records the operator');
  });

  it('brainstormer NFR probing is judgment-based', () => {
    const c = readSrc('agents/ship-brainstormer.md');
    assert.ok(!c.includes('INFRA_DETECTED'), 'brainstormer must not carry the infra-signal flag');
    assert.ok(/NFR/i.test(c), 'brainstormer keeps NFR judgment guidance');
  });

  it('version files agree with ship/VERSION', () => {
    const version = readSrc('ship/VERSION').trim();
    assert.ok(version.startsWith('5.'), 'ship/VERSION on the 5.x line');
    assert.equal(JSON.parse(readSrc('.claude-plugin/plugin.json')).version, version, `plugin.json at ${version}`);
    assert.equal(JSON.parse(readSrc('package.json')).version, version, `package.json at ${version}`);
  });
});

// ---------------------------------------------------------------------------
// Workflow control-flow dry-run (stubbed agent/phase/log)
// ---------------------------------------------------------------------------

describe('v4 — go workflow control flow', () => {
  // Mirror the engine: strip `export` from meta, run the body in an async fn
  // with the engine globals injected.
  let src = readSrc('ship/workflows/go.workflow.js').replace('export const meta', 'const meta');

  function runWorkflow(args, scenario) {
    const calls = [];
    // A scenario value may be a function (called with the label) so tests can
    // simulate throwing agents — e.g. the flaky final-JSON schema wrapper.
    const agent = async (prompt, opts = {}) => {
      const label = opts.label || '';
      calls.push(label);
      for (const k of Object.keys(scenario)) {
        if (k !== '__default' && label.startsWith(k)) {
          return typeof scenario[k] === 'function' ? scenario[k](label) : scenario[k];
        }
      }
      return scenario.__default;
    };
    const phase = () => {};
    const log = () => {};
    const parallel = async (thunks) => Promise.all(thunks.map((t) => t()));
    const pipeline = async () => { throw new Error('pipeline not expected'); };
    const budget = { total: null, spent: () => 0, remaining: () => Infinity };
    const fn = new Function('args', 'phase', 'log', 'parallel', 'pipeline', 'agent', 'budget',
      `return (async () => { ${src}\n })()`);
    return fn(args, phase, log, parallel, pipeline, agent, budget).then((result) => ({ result, calls }));
  }

  const COMPLETE = { feature: 'f', status: 'COMPLETE', tasks_completed: 2, tasks_total: 2, commits: ['abc1234'] };
  const APPROVED = { feature: 'f', status: 'APPROVED', findings: [] };
  const NEEDS = { feature: 'f', status: 'NEEDS_FIXES', findings: [{ severity: 'high', file: 'x.js:1', description: 'bug' }] };
  const VERDICT = { feature: 'f', status: 'PASS', criteria_total: 3, criteria_passed: 3 };
  const CHECKPOINT = { feature: 'f', status: 'CHECKPOINT', tasks_completed: 0, tasks_total: 2, commits: [] };

  it('happy path: builds each phase then verifies', async () => {
    const { result, calls } = await runWorkflow(
      { feature: 'f', phases: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }] },
      { 'build': COMPLETE, 'review': APPROVED, 'verify': VERDICT, __default: APPROVED });
    assert.deepEqual(calls, ['build:p1', 'review:p1', 'build:p2', 'review:p2', 'verify']);
    assert.equal(result.stoppedAt, null);
    assert.equal(result.completed.length, 2);
    assert.equal(result.verdict.status, 'PASS');
  });

  it('review NEEDS_FIXES triggers one fix round + re-review', async () => {
    const { result, calls } = await runWorkflow(
      { feature: 'f', phases: [{ id: 'p1', name: 'A' }] },
      { 'build:': COMPLETE, 'review:': NEEDS, 'fix:': COMPLETE, 'rereview:': APPROVED, 'verify': VERDICT, __default: APPROVED });
    assert.deepEqual(calls, ['build:p1', 'review:p1', 'fix:p1', 'rereview:p1', 'verify']);
    assert.equal(result.completed[0].fixApplied, true);
    assert.equal(result.completed[0].unresolved.length, 0);
  });

  it('build CHECKPOINT stops the loop before verify', async () => {
    const { result, calls } = await runWorkflow(
      { feature: 'f', phases: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }] },
      { 'build:p1': CHECKPOINT, 'build': COMPLETE, 'review': APPROVED, 'verify': VERDICT, __default: APPROVED });
    assert.deepEqual(calls, ['build:p1']);
    assert.equal(result.stoppedAt.phase.id, 'p1');
    assert.equal(result.verdict, null);
  });

  it('empty phase list (verify-only) skips straight to verify', async () => {
    const { result, calls } = await runWorkflow(
      { feature: 'f', phases: [] },
      { 'verify': VERDICT, __default: APPROVED });
    assert.deepEqual(calls, ['verify']);
    assert.equal(result.verdict.status, 'PASS');
  });

  it('null build result (agent skipped/died) stops the loop', async () => {
    const { result } = await runWorkflow(
      { feature: 'f', phases: [{ id: 'p1', name: 'A' }] },
      { 'build:': null, __default: APPROVED });
    assert.ok(result.stoppedAt, 'a null build result must stop the workflow');
    assert.equal(result.verdict, null);
  });

  it('agent throw is retried once, then the run continues', async () => {
    let verifyAttempts = 0;
    const { result, calls } = await runWorkflow(
      { feature: 'f', phases: [{ id: 'p1', name: 'A' }] },
      { 'build': COMPLETE, 'review': APPROVED, __default: APPROVED,
        'verify': () => { if (++verifyAttempts === 1) throw new Error('schema wrapper flake'); return VERDICT; } });
    assert.deepEqual(calls, ['build:p1', 'review:p1', 'verify', 'verify:retry']);
    assert.equal(result.verdict.status, 'PASS');
  });

  it('agent that throws twice degrades to null instead of killing the run', async () => {
    const { result } = await runWorkflow(
      { feature: 'f', phases: [{ id: 'p1', name: 'A' }] },
      { 'build': COMPLETE, 'review': APPROVED, __default: APPROVED,
        'verify': () => { throw new Error('schema wrapper flake'); } });
    assert.equal(result.stoppedAt, null);
    assert.equal(result.verdict, null, 'verify degrades to a null verdict, not a crash');
    assert.equal(result.completed.length, 1, 'built phases are still reported');
  });

  it('blocking findings stay unresolved when the re-review produces no result', async () => {
    const { result } = await runWorkflow(
      { feature: 'f', phases: [{ id: 'p1', name: 'A' }] },
      { 'build:': COMPLETE, 'review:': NEEDS, 'fix:': COMPLETE, 'verify': VERDICT, __default: APPROVED,
        'rereview:': () => { throw new Error('schema wrapper flake'); } });
    assert.equal(result.completed[0].fixApplied, true);
    assert.equal(result.completed[0].unresolved.length, 1, 'unconfirmed fixes must surface as unresolved');
    assert.equal(result.completed[0].unresolved[0].severity, 'high');
  });

  it('throws when args.feature is missing', async () => {
    await assert.rejects(() => runWorkflow({ phases: [] }, { __default: APPROVED }), /feature is required/);
  });
});
