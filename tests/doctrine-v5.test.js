/**
 * v5.0.0 doctrine invariants — rules, not babysitting.
 *
 * Locks in the shift from prescriptive micromanagement to outcome-gated
 * guidance: question/task quotas removed, outcome gates present, and the
 * machine contracts (workflow schemas, task XML, builder HARD-GATE) frozen.
 *
 * Scoped to the canonical `skills/` and `agents/` trees only — never the
 * legacy `.claude/` mirrors or `.planning/` documents (which legitimately
 * quote the removed phrases when describing the change).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

// Canonical doc globs: agents/*.md + skills/*/SKILL.md
const agentFiles = fs.readdirSync(path.join(repoRoot, 'agents'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => `agents/${f}`);
const skillFiles = fs.readdirSync(path.join(repoRoot, 'skills'))
  .filter((d) => fs.existsSync(path.join(repoRoot, 'skills', d, 'SKILL.md')))
  .map((d) => `skills/${d}/SKILL.md`);

// ---------------------------------------------------------------------------
// Quotas and scaffolding — the prescriptive pieces must be gone
// ---------------------------------------------------------------------------

describe('v5 — quotas removed', () => {
  it('no question quotas in start skill or brainstormer', () => {
    for (const f of ['skills/start/SKILL.md', 'agents/ship-brainstormer.md']) {
      assert.ok(!readSrc(f).includes('5-10+'), `${f} must not carry the 5-10+ question quota`);
    }
    const b = readSrc('agents/ship-brainstormer.md');
    assert.ok(!b.includes('5+ for features'), 'brainstormer must not carry the feature question floor');
    assert.ok(!b.includes('3+ for bug fixes'), 'brainstormer must not carry the bug-fix question floor');
  });

  it('no INFRA_DETECTED signal flag or routing hints anywhere canonical', () => {
    for (const f of [...agentFiles, ...skillFiles]) {
      const c = readSrc(f);
      assert.ok(!c.includes('INFRA_DETECTED'), `${f} must not carry the INFRA_DETECTED flag`);
      assert.ok(!c.includes('Routing hints'), `${f} must not carry the NFR routing table`);
    }
  });

  it('plan skill has no mandatory fan-out, task floor, or no-choice doctrine', () => {
    const c = readSrc('skills/plan/SKILL.md');
    assert.ok(!c.includes('Launch 3 parallel exploration'), 'plan must not mandate the 3-agent fan-out');
    assert.ok(!c.includes('3-12 tasks'), 'plan must not carry the task-count floor');
    assert.ok(!c.includes('underplanned'), 'plan must not equate fewer tasks with underplanning');
    assert.ok(!c.includes('never leave a choice'), 'plan must not forbid builder latitude');
  });

  it('build skill has no orchestrator trust-but-verify re-run', () => {
    assert.ok(!/trust-but-verify/i.test(readSrc('skills/build/SKILL.md')),
      'build skill must not duplicate the reviewer verify re-run');
  });

  it('design skill has no canned philosophies', () => {
    const c = readSrc('skills/design/SKILL.md');
    assert.ok(!c.includes('Minimal Changes'), 'design must not carry the Minimal Changes philosophy');
    assert.ok(!c.includes('Pragmatic Balance'), 'design must not carry the Pragmatic Balance philosophy');
  });
});

// ---------------------------------------------------------------------------
// Outcome gates — the judgment-based replacements must be present
// ---------------------------------------------------------------------------

describe('v5 — outcome gates present', () => {
  it('brainstormer gates CONTEXT.md on testable, confirmed requirements', () => {
    const c = readSrc('agents/ship-brainstormer.md');
    assert.ok(c.includes('testable acceptance criteria'), 'brainstormer gate requires testable acceptance criteria');
    assert.ok(c.includes('the user has confirmed'), 'brainstormer gate requires user confirmation');
    assert.ok(c.includes('Codebase Notes'), 'brainstormer template offers Codebase Notes for the planner');
  });

  it('plan carries the contracts-vs-internals litmus and its surviving self-checks', () => {
    const c = readSrc('skills/plan/SKILL.md');
    assert.ok(c.includes('two reasonable implementations'), 'plan keeps the contract litmus');
    assert.ok(c.includes('Coverage Map'), 'plan keeps the acceptance-criterion coverage map');
    assert.ok(c.includes('Adversarial Review'), 'plan keeps the adversarial review self-check');
  });

  it('builder owns internals and surfaces (never silently takes) better approaches', () => {
    const c = readSrc('agents/ship-builder.md');
    assert.ok(/internals/i.test(c), 'builder doctrine grants internals latitude');
    assert.ok(c.includes('surface'), 'builder must surface better approaches');
    assert.ok(c.includes('never silently'), 'builder must never silently substitute a planned contract');
  });

  it('plan-verify delegates to a fresh-context reviewer and keeps the go contract', () => {
    const c = readSrc('skills/plan-verify/SKILL.md');
    assert.ok(c.includes('fresh-context'), 'plan-verify review runs in a fresh-context subagent');
    assert.ok(c.includes('PLAN REVIEW COMPLETE'), 'plan-verify keeps the terminal block');
    assert.ok(c.includes('NEEDS-REVISION'), 'plan-verify keeps the go-facing verdict string');
  });
});

// ---------------------------------------------------------------------------
// Frozen contracts — the machine-parsed surfaces must not drift
// ---------------------------------------------------------------------------

describe('v5 — frozen contracts', () => {
  it('go workflow still drives the three ship agents with strict schemas', () => {
    const c = readSrc('ship/workflows/go.workflow.js');
    for (const s of ['ship:ship-builder', 'ship:ship-reviewer', 'ship:ship-verifier',
      'COMPLETE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'additionalProperties: false']) {
      assert.ok(c.includes(s), `go.workflow.js must still contain "${s}"`);
    }
  });

  it('plan skill still documents the task XML fields', () => {
    const c = readSrc('skills/plan/SKILL.md');
    for (const field of ['<name>', '<files>', '<action>', '<verify>']) {
      assert.ok(c.includes(field), `plan skill must document the ${field} task field`);
    }
  });

  it('builder HARD-GATE survives', () => {
    assert.ok(readSrc('agents/ship-builder.md').includes('HARD-GATE'),
      'builder keeps the HARD-GATE');
  });
});
