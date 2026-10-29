/**
 * v5 doctrine — adversarial wiring and residue checks.
 *
 * Written by the ship-verifier for the rules-not-babysitting feature.
 * Covers seams the doctrine-v5 invariant file does not:
 *   1. Residual v4 scaffolding phrases doctrine-v5 does not grep for
 *   2. Cross-skill contracts (go ↔ plan-verify, design ↔ plan, builder ↔ build)
 *   3. CHANGELOG heading agrees with ship/VERSION
 *   4. Build-skill internal step references resolve after the 3.1 rewire
 *
 * Scoped to canonical `skills/` and `agents/` trees only — never the legacy
 * `.claude/` mirrors or `.planning/` documents.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('v5 wiring — residual scaffolding gone', () => {
  it('design skill dropped all three canned philosophies (incl. Clean Architecture)', () => {
    const c = readSrc('skills/design/SKILL.md');
    assert.ok(!c.includes('Clean Architecture'), 'design must not carry the Clean Architecture philosophy');
  });

  it('brainstorm has no model pin', () => {
    // The brainstorm runs inline in /ship:start, so the start skill's model applies.
    const c = readSrc('skills/start/references/brainstorm.md');
    assert.ok(!/^model:/m.test(c), 'the brainstorm reference must not pin a model');
    const fm = readSrc('skills/start/SKILL.md').split('---')[1];
    assert.ok(!/^model:/m.test(fm), 'the start skill must not pin a model');
  });

  it('brainstorm is a start-skill reference, not a spawnable agent', () => {
    // AskUserQuestion fails inside a subagent, so the interview must not be
    // discoverable as one.
    assert.ok(!fs.existsSync(path.join(repoRoot, 'agents/ship-brainstormer.md')),
      'agents/ship-brainstormer.md must not exist');
    const start = readSrc('skills/start/SKILL.md');
    assert.ok(start.includes('skills/start/references/brainstorm.md'), 'start reads the brainstorm reference');
    assert.match(start.split('---')[1], /^allowed-tools:.*\bGrep\b/m, 'start can Grep while exploring');
  });

  it('brainstorm confirms the summary before writing CONTEXT.md', () => {
    const c = readSrc('skills/start/references/brainstorm.md');
    const confirm = c.indexOf('## Phase 4 — Play Back and Confirm');
    const write = c.indexOf('## Phase 5 — Capture to CONTEXT.md');
    assert.ok(confirm > 0 && write > confirm, 'the confirm phase precedes the write phase');
    assert.ok(!c.slice(confirm, write).includes('```markdown'), 'no CONTEXT.md template before confirmation');
    assert.match(c.slice(confirm, write), /use `AskUserQuestion` to confirm/, 'the confirm question lives in Phase 4');
  });

  it('brainstorm accepts approval in any form and keeps exploration notes', () => {
    const c = readSrc('skills/start/references/brainstorm.md');
    assert.ok(!c.includes('until the user picks "Looks good"'), 'the gate must not hinge on one option label');
    assert.match(c, /approval typed into "Other"/, 'typed approval counts');
    assert.match(c, /`## Codebase Notes` and `## Research Notes` are the exception/,
      'exploration notes still reach CONTEXT.md for the planner');
  });

  it('an abandoned brainstorm does not strand its slug', () => {
    // The directory used to be created before the interview, so walking away
    // left an empty folder that start sent to /ship:resume and resume could not see.
    const start = readSrc('skills/start/SKILL.md');
    assert.ok(!start.includes('5. Create the feature directory'), 'start must not create the directory before the brainstorm');
    assert.match(start, /directory exists without a CONTEXT\.md/, 'a leftover empty directory is treated as fresh');
  });

  it('legacy reinstall removes the retired brainstormer agent', () => {
    assert.match(readSrc('install.js'), /LEGACY_FILES = \[[\s\S]*path\.join\('agents', 'ship-brainstormer\.md'\)/,
      'LEGACY_FILES must delete agents/ship-brainstormer.md');
  });

  it('plan-verify no longer format-polices the plan document', () => {
    const c = readSrc('skills/plan-verify/SKILL.md');
    assert.ok(!/Exploration Summary.*non-empty/i.test(c), 'the Exploration Summary non-empty check is removed');
    // The review contract now lives in the agent; the skill only delegates to it.
    assert.ok(/do not police document format/i.test(readSrc('agents/ship-plan-reviewer.md')),
      'the plan reviewer agent forbids format policing');
    assert.ok(c.includes('ship-plan-reviewer'), 'plan-verify delegates to the plan reviewer agent');
  });

  it('plan self-checks are exactly 6.1 coverage map and 6.2 adversarial review', () => {
    const c = readSrc('skills/plan/SKILL.md');
    const headings = c.match(/#### 6\.\d+ — .*/g) || [];
    assert.deepEqual(
      headings.map((h) => h.replace(/#### /, '')),
      ['6.1 — Acceptance Criterion Coverage Map', '6.2 — Adversarial Review'],
      'only the coverage map and adversarial review survive in Step 6'
    );
    for (const gone of ['Task Completeness', 'Wiring Completeness', 'Verify Quality', 'Phase Coherence']) {
      assert.ok(!c.includes(gone), `plan must not keep the ${gone} self-check`);
    }
  });
});

describe('v5 wiring — cross-skill contracts hold', () => {
  it('go routes on the plan-loop statuses while plan-verify keeps its verdict strings', () => {
    const go = readSrc('skills/go/SKILL.md');
    const pv = readSrc('skills/plan-verify/SKILL.md');
    for (const s of ['APPROVED', 'NEEDS-REVISION']) {
      assert.ok(pv.includes(s), `plan-verify still emits ${s}`);
    }
    // go now branches on the plan.workflow.js statuses, not the skill's verdict.
    for (const s of ['APPROVED', 'NEEDS_INPUT', 'STUCK', 'UNRESOLVED', 'BLOCKED']) {
      assert.ok(go.includes(s), `go skill routes on ${s}`);
    }
    assert.ok(pv.includes('## PLAN REVIEW COMPLETE'), 'plan-verify keeps the terminal block heading');
    assert.ok(pv.includes('**Status:** APPROVED'), 'PLAN.md append keeps the APPROVED branch verbatim');
    assert.ok(pv.includes('**Status:** NEEDS-REVISION'), 'PLAN.md append keeps the NEEDS-REVISION branch verbatim');
    assert.ok(pv.includes('status: plan-verified'), 'plan-verify still advances the status machine on approval');
  });

  it('design writes the Chosen Architecture section the plan skill consumes', () => {
    assert.ok(readSrc('skills/design/SKILL.md').includes('## Chosen Architecture'), 'design writes the section');
    assert.ok(readSrc('skills/plan/SKILL.md').includes('## Chosen Architecture'), 'plan consumes the section');
  });

  it('builder still emits every status the build skill handles', () => {
    const builder = readSrc('agents/ship-builder.md');
    const build = readSrc('skills/build/SKILL.md');
    for (const s of ['COMPLETE', 'COMPLETE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'CHECKPOINT']) {
      assert.ok(builder.includes(`"${s}"`) || builder.includes(`**${s}**`), `builder defines ${s}`);
      assert.ok(build.includes(`"${s}"`), `build skill handles ${s}`);
    }
  });
});

describe('v5 wiring — release integrity', () => {
  it('CHANGELOG heading matches ship/VERSION', () => {
    const version = readSrc('ship/VERSION').trim();
    assert.ok(new RegExp(`^## ${version.replace(/\./g, '\\.')}$`, 'm').test(readSrc('CHANGELOG.md')),
      `CHANGELOG.md carries a ## ${version} heading`);
  });
});

describe('v5 wiring — build skill step references resolve', () => {
  it('every 3.1 reference points at an existing Review Gate heading', () => {
    const c = readSrc('skills/build/SKILL.md');
    assert.ok(c.includes('### 3.1 Review Gate'), 'the 3.1 Review Gate heading exists');
    // Any referenced "N.M" sub-step must have a matching heading.
    const refs = [...c.matchAll(/\((\d\.\d)\)/g)].map((m) => m[1]);
    for (const ref of new Set(refs)) {
      assert.ok(c.includes(`### ${ref} `), `reference (${ref}) resolves to a ### ${ref} heading`);
    }
    assert.ok(!c.includes('3.2'), 'no dangling reference to the removed 3.2 numbering');
  });
});
