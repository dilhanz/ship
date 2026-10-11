// Doctrine and behavior tests for verify-checklist-gate: the verifier's verdict
// is honest (any Open bug fails, whatever its severity), a non-defect leaves
// Bug Findings only with a CONTEXT.md citation, and the verifier runs at 80
// turns.
//
// Retro evidence: #236 (booking-inspections) shipped PASS 7/7 while its own
// Bug Findings table listed 4 Open bugs (1 medium, 3 low), because only
// critical/high bugs used to fail a verify.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const agent = () => readSrc('agents/ship-verifier.md');
const skill = () => readSrc('skills/verify/SKILL.md');
const template = () => readSrc('ship/templates/VERIFY.md');

/** The agent's Stage 3 section, up to the next top-level heading. */
const stage3 = () => {
  const src = agent();
  const start = src.indexOf('## Stage 3');
  assert.ok(start > -1, 'the verifier must have a Stage 3 section');
  const end = src.indexOf('\n## ', start + 1);
  return src.slice(start, end > -1 ? end : undefined);
};

describe('verify-checklist-gate: any Open bug fails the verify', () => {
  it('the agent states Open → FAIL at any severity', () => {
    const s3 = stage3();
    assert.match(s3, /any bug in Bug Findings with status `Open`, whatever its severity/);
    assert.match(s3, /An Open bug beats INCONCLUSIVE/);
    assert.match(s3, /no Open bug/);
  });

  it('the skill states Open → FAIL at any severity', () => {
    assert.match(skill(), /Any bug left Open — at any severity —/);
  });

  it('the template states Open → FAIL at any severity', () => {
    assert.match(template(), /Any row with Status `Open` makes the Overall Status FAIL, whatever its severity/);
  });

  it('no file still uses critical/high as the fail rule', () => {
    assert.ok(!stage3().includes('any critical/high bug'),
      'Stage 3 must not limit FAIL to critical/high bugs');
    assert.ok(!/Medium\/low bugs .* recommendations/.test(stage3()),
      'medium/low bugs must no longer be demoted to recommendations');
    assert.ok(!skill().includes('Critical or high bugs'),
      'the verify skill must not limit blocking to critical/high bugs');
    assert.ok(!/reproduced\s+critical\/high one is a FAIL/.test(skill()),
      'a reproduced carried finding fails at any severity');
  });

  it('FAIL writes one fix task per Open bug, not only critical/high ones', () => {
    assert.match(stage3(), /one per Open bug/);
  });

  it('a reproduced carried finding is an Open bug that fails the verify', () => {
    assert.match(agent(), /any reproduced finding is an Open bug and FAILs the verify/);
  });
});

describe('verify-checklist-gate: the citation rule', () => {
  const nearCitation = (src, section) => {
    const idx = src.indexOf(section);
    assert.ok(idx > -1, `must mention ${section}`);
    return src;
  };

  it('the agent requires a CONTEXT.md citation to move a non-defect to Quality Notes or Gaps', () => {
    const s3 = stage3();
    const i = s3.indexOf('the citation rule');
    assert.ok(i > -1, 'Stage 3 must name the citation rule');
    const para = s3.slice(i, s3.indexOf('\n\n', i));
    for (const needle of ['Quality Notes', 'Gaps', 'CONTEXT.md', 'cite', 'stays a bug']) {
      assert.ok(para.includes(needle), `citation rule paragraph must mention "${needle}"`);
    }
  });

  it('the template states the citation rule and gives Quality Notes and Gaps a cited-item format', () => {
    const t = nearCitation(template(), 'Citation rule');
    const ruleAt = t.indexOf('Citation rule');
    const rule = t.slice(ruleAt, t.indexOf('\n', ruleAt));
    for (const needle of ['Quality Notes', 'Gaps', 'CONTEXT.md', 'uncited']) {
      assert.ok(rule.includes(needle), `template citation rule must mention "${needle}"`);
    }
    for (const section of ['### Quality Notes', '## Gaps']) {
      const at = t.indexOf(section);
      assert.ok(at > -1, `template must have ${section}`);
      const body = t.slice(at, t.indexOf('\n#', at + section.length));
      assert.ok(body.includes('— cites CONTEXT.md: "{quoted line}"'),
        `${section} must show the cited-item format`);
    }
  });
});

describe('verify-checklist-gate: verifier turn budget', () => {
  it('the verifier frontmatter declares maxTurns: 80', () => {
    const front = agent().split('---')[1];
    assert.match(front, /^maxTurns: 80$/m);
  });

  it('the 2b budget paragraph reasons with 80 turns', () => {
    assert.match(agent(), /With 80 turns/);
    assert.ok(!/With 60 turns/.test(agent()));
  });
});

/** The agent's Stage 2b section, up to 2c. */
const stage2b = () => {
  const src = agent();
  const start = src.indexOf('### 2b');
  assert.ok(start > -1, 'the verifier must have a 2b section');
  const end = src.indexOf('### 2c', start);
  return src.slice(start, end > -1 ? end : undefined);
};

/** The agent's Verification Depth section. */
const depthSection = () => agent().split('## Verification Depth')[1].split('\n## ')[0];

describe('verify-checklist-gate: the verifier runs the checklist and trial merge', () => {
  it('names the repo checklist file as an input and points at its format doc', () => {
    const inputs = agent().split('## Inputs')[1].split('## Verification Depth')[0];
    assert.ok(inputs.includes('.planning/verify-checklist.md'));
    assert.ok(inputs.includes('ship/docs/verify-checklist.md'));
  });

  it('names the three generic checklist items', () => {
    const s = stage2b();
    assert.match(s, /docs\/manual\/user-facing claims in the diff match the code/);
    assert.match(s, /tests that depend on the current date or time zone/);
    assert.match(s, /concurrency on write paths/);
  });

  it('states "No repo checklist" when the file is absent', () => {
    assert.ok(stage2b().includes('No repo checklist'));
  });

  it('a FAIL row is a bug at medium or above, never low', () => {
    assert.match(stage2b(), /medium severity or above, never low/);
  });

  it('every row is decided with evidence, N/A carries a reason', () => {
    const s = stage2b();
    assert.match(s, /PASS \/ FAIL \/ N\/A/);
    assert.match(s, /N\/A carries a one-line reason/);
  });

  it('the trial merge uses a throwaway worktree and removes it', () => {
    const s = stage2b();
    const at = s.indexOf('#### Trial merge with main');
    assert.ok(at > -1, '2b must have a Trial merge with main subsection');
    const section = s.slice(at, s.indexOf('\n#### ', at + 1));
    assert.ok(section.includes('git worktree add --detach "$TRIAL" HEAD'));
    assert.ok(section.includes('git worktree remove --force "$TRIAL"'));
    assert.ok(section.includes('-C "$TRIAL"'));
    assert.match(section, /never run `git merge` in the feature checkout/);
    assert.ok(section.includes('NOT_RUNNABLE'));
    assert.ok(section.includes('Merge main into the branch and fix the break'));
  });

  it('no line in the agent runs a bare git merge outside the trial worktree', () => {
    const offenders = agent().split('\n').filter((line) =>
      /git (-C \S+ )?(-c \S+ )*merge\b/.test(line)
      && !line.includes('merge-base')
      && !line.includes('never')
      && !line.includes('-C "$TRIAL"'));
    assert.deepEqual(offenders, [], 'every git merge must run with -C "$TRIAL"');
  });

  it('2b orders carried findings, then the gates, then the capped discretionary tests', () => {
    const s = stage2b();
    const order = [
      'Unresolved review findings come first',
      '#### Trial merge with main',
      '#### Repo checklist',
      '#### Generic checklist',
      'capped at **3 test files**',
    ].map((needle) => {
      const i = s.indexOf(needle);
      assert.ok(i > -1, `2b must contain "${needle}"`);
      return i;
    });
    for (let k = 1; k < order.length; k++) {
      assert.ok(order[k - 1] < order[k], `2b order broken at step ${k}`);
    }
  });

  it('at criteria-only the trial merge and repo checklist run, the generic checklist is skipped', () => {
    const d = depthSection();
    assert.match(d, /trial merge and the repo checklist still run/i);
    assert.match(d, /generic checklist is skipped/i);
    assert.match(d, /build-command lookup/);
  });

  it('the incremental record and output block carry checklist and trial_merge', () => {
    const src = agent();
    const record = src.split('## The Incremental Record')[1].split('\n## ')[0];
    assert.ok(record.includes('`checklist`'));
    assert.ok(record.includes('`trial_merge`'));
    const stage0 = src.split('## Stage 0')[1].split('\n## ')[0];
    assert.match(stage0, /checklist rows/);
    assert.match(stage0, /trial merge/);
    const output = src.split('## Output')[1];
    assert.ok(output.includes('"checklist"'));
    assert.ok(output.includes('"trial_merge"'));
  });
});

describe('verify-checklist-gate: the VERIFY template carries the gates', () => {
  it('has a Verify Checklist table with per-row verdicts', () => {
    const t = template();
    assert.ok(t.includes('### Verify Checklist'));
    assert.ok(t.includes('| Item | Source | Verdict | Evidence |'));
    assert.ok(t.includes('PASS / FAIL / N/A'));
    assert.ok(t.includes('No repo checklist'));
  });

  it('has a Trial Merge section between Carried Review Findings and Adversarial Tests', () => {
    const t = template();
    const carried = t.indexOf('### Carried Review Findings');
    const trial = t.indexOf('### Trial Merge');
    const checklist = t.indexOf('### Verify Checklist');
    const adversarial = t.indexOf('### Adversarial Tests');
    assert.ok(trial > -1, 'template must have ### Trial Merge');
    assert.ok(carried < trial && trial < adversarial && checklist < adversarial && carried < checklist,
      'gates sit after Carried Review Findings and before Adversarial Tests');
    assert.ok(t.includes('PASS | FAIL | NOT_RUNNABLE'));
  });

  it('the narrowing note keeps the Trial Merge and repo checklist rows mandatory', () => {
    const t = template();
    const at = t.indexOf('(If this run was narrowed by profile');
    const note = t.slice(at, t.indexOf('\n', at));
    assert.match(note, /Trial Merge and the repo checklist rows remain mandatory/);
  });
});

const goSrc = () => readSrc('ship/workflows/go.workflow.js');

/** The VERIFY_SCHEMA declaration text. */
const verifySchemaText = () => {
  const src = goSrc();
  const start = src.indexOf('const VERIFY_SCHEMA = {');
  assert.ok(start > -1, 'VERIFY_SCHEMA must exist');
  return src.slice(start, src.indexOf('\n}\n', start));
};

/** Evaluate the depthBlock declaration the same way workflow-profiles-adversarial does. */
const depthBlockFor = (verifyDepth, profileName) => {
  const m = goSrc().match(/const depthBlock = verifyDepth === 'criteria-only'[\s\S]*?\n {2}: ''/);
  assert.ok(m, 'depthBlock declaration not found');
  // eslint-disable-next-line no-new-func
  return new Function('verifyDepth', 'profileName', `${m[0]}\nreturn depthBlock`)(verifyDepth, profileName);
};

/** The salvageVerifyPrompt template text. */
const salvageText = () => {
  const src = goSrc();
  const start = src.indexOf('const salvageVerifyPrompt =');
  assert.ok(start > -1, 'salvageVerifyPrompt must exist');
  return src.slice(start, src.indexOf('${fullPrompt}`', start));
};

describe('verify-checklist-gate: the go workflow carries the gates', () => {
  it('VERIFY_SCHEMA declares checklist and trial_merge with their verdict enums', () => {
    const t = verifySchemaText();
    assert.ok(t.includes('checklist: {'), 'schema must declare checklist');
    assert.ok(t.includes('trial_merge: {'), 'schema must declare trial_merge');
    assert.ok(t.includes("source: { enum: ['generic', 'repo'] }"));
    assert.ok(t.includes("verdict: { enum: ['PASS', 'FAIL', 'N/A'] }"));
    assert.ok(t.includes("outcome: { enum: ['PASS', 'FAIL', 'NOT_RUNNABLE'] }"));
    assert.ok(t.includes("type: ['object', 'null']"));
    assert.match(t, /required: \['feature', 'status', 'criteria_total', 'criteria_passed'\]/,
      'neither gate field may become required');
  });

  it('the verify prompt asks for the trial merge and the checklist', () => {
    assert.match(goSrc(), /run the trial merge with main and the verify checklist \(generic items plus \.planning\/verify-checklist\.md if present\)/);
  });

  it('at criteria-only the depth block keeps the trial merge and repo checklist and skips the generic items', () => {
    const block = depthBlockFor('criteria-only', 'quick');
    assert.match(block, /trial merge with main and the repo checklist from \.planning\/verify-checklist\.md still run/);
    assert.match(block, /generic checklist items are skipped/);
    assert.match(block, /narrowing never waives them/);
  });

  it('the depth block stays empty at full depth', () => {
    assert.equal(depthBlockFor('full', 'standard'), '');
  });

  it('the salvage prompt adopts checklist rows and a decided trial merge', () => {
    const t = salvageText();
    assert.match(t, /adopt the record's \\`checklist\\` rows and its \\`trial_merge\\` verbatim/);
    assert.match(t, /first checklist item the record has not decided/);
    assert.match(t, /do NOT repeat a trial merge/);
  });

  it('the agent Stage 0 and the salvage prompt agree on adopting checklist rows and the trial merge', () => {
    const stage0 = agent().split('## Stage 0')[1].split('\n## ')[0];
    const t = salvageText();
    for (const src of [stage0, t]) {
      assert.match(src, /checklist/);
      assert.match(src, /trial merge|trial_merge/);
      assert.match(src, /verbatim/);
    }
  });
});

// ---------------------------------------------------------------------------
// The workflow guard: a PASS/INCONCLUSIVE verdict that carries Open bugs, a
// failed checklist row, or a failed trial merge is downgraded to FAIL. Run the
// real workflow with a scripted agent (same harness as
// go-path-reliability-carried.test.js).
// ---------------------------------------------------------------------------

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const runWorkflowWithVerdict = async (verifierResult) => {
  const run = new AsyncFunction(
    'args', 'agent', 'log', 'phase',
    goSrc().replace(/^export const meta/m, 'const meta'),
  );
  const logs = [];
  const agent = async (prompt, opts) => {
    const label = opts.label || '';
    if (label.startsWith('build:')) {
      return { feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['abc1234'] };
    }
    if (label.startsWith('review:')) {
      return {
        feature: 'demo', status: 'APPROVED', findings: [],
        verify_runs: [{ command: 'node --test', exit_code: 0, verdict: 'pass' }],
        files_reviewed: ['x'],
      };
    }
    if (label === 'verify') return verifierResult;
    throw new Error(`unexpected agent call: ${label}`);
  };
  const result = await run(
    { feature: 'demo', phases: [{ id: '1', name: 'one' }] },
    agent, (m) => logs.push(m), () => {},
  );
  return { result, logs };
};

const bug = (severity) => ({ severity, category: 'logic', description: `${severity} bug`, file: 'a.js', evidence: 'repro' });
const base = { feature: 'demo', criteria_total: 7, criteria_passed: 7, criteria_failed: 0, criteria_inconclusive: 0 };

describe('verify-checklist-gate: go.workflow downgrades a dishonest PASS', () => {
  it('#236 shape — PASS 7/7 with 4 Open bugs becomes FAIL', async () => {
    const { result } = await runWorkflowWithVerdict({
      ...base, status: 'PASS', bugs: [bug('medium'), bug('low'), bug('low'), bug('low')],
    });
    assert.equal(result.verdict.status, 'FAIL');
    assert.equal(result.verdict.downgraded_from, 'PASS');
    assert.match(result.verdict.downgrade_reason, /\b4 open bug/);
    assert.equal(result.verdict.bugs.length, 4, 'the bugs travel with the downgraded verdict');
  });

  it('INCONCLUSIVE with one low bug becomes FAIL', async () => {
    const { result } = await runWorkflowWithVerdict({
      ...base, criteria_passed: 6, criteria_inconclusive: 1, status: 'INCONCLUSIVE', bugs: [bug('low')],
    });
    assert.equal(result.verdict.status, 'FAIL');
    assert.equal(result.verdict.downgraded_from, 'INCONCLUSIVE');
    assert.match(result.verdict.downgrade_reason, /\b1 open bug/);
  });

  it('PASS with no bugs but a FAIL checklist row becomes FAIL', async () => {
    const { result } = await runWorkflowWithVerdict({
      ...base, status: 'PASS', bugs: [],
      checklist: [
        { item: 'docs match code', source: 'generic', verdict: 'PASS', evidence: 'ok' },
        { item: 'migrations reversible', source: 'repo', verdict: 'FAIL', evidence: 'no down' },
      ],
    });
    assert.equal(result.verdict.status, 'FAIL');
    assert.equal(result.verdict.downgraded_from, 'PASS');
    assert.match(result.verdict.downgrade_reason, /1 failed checklist item/);
  });

  it('PASS with a failed trial merge becomes FAIL', async () => {
    const { result } = await runWorkflowWithVerdict({
      ...base, status: 'PASS', bugs: [],
      trial_merge: { outcome: 'FAIL', target: 'origin/main', command: 'npm test', evidence: 'conflict' },
    });
    assert.equal(result.verdict.status, 'FAIL');
    assert.equal(result.verdict.downgraded_from, 'PASS');
    assert.match(result.verdict.downgrade_reason, /trial merge failed/);
  });

  it('a clean PASS stays PASS, untouched', async () => {
    const clean = {
      ...base, status: 'PASS', bugs: [],
      checklist: [{ item: 'docs match code', source: 'generic', verdict: 'PASS', evidence: 'ok' }],
      trial_merge: { outcome: 'PASS', target: 'main', command: 'npm test', evidence: 'green' },
    };
    const { result } = await runWorkflowWithVerdict(clean);
    assert.equal(result.verdict.status, 'PASS');
    assert.equal(result.verdict.downgraded_from, undefined);
    assert.equal(result.verdict, clean, 'a clean PASS is the same object');
  });

  it('a FAIL stays FAIL with no downgraded_from', async () => {
    const failed = { ...base, criteria_passed: 6, criteria_failed: 1, status: 'FAIL', bugs: [bug('high')] };
    const { result } = await runWorkflowWithVerdict(failed);
    assert.equal(result.verdict.status, 'FAIL');
    assert.equal(result.verdict.downgraded_from, undefined);
    assert.equal(result.verdict, failed, 'a FAIL verdict is the same object');
  });

  it('the guard sits before the outage handling and cites #236', () => {
    const src = goSrc();
    const guard = src.indexOf('downgraded_from:');
    const outage = src.indexOf('let verifyOutage = null');
    assert.ok(guard > -1 && outage > -1 && guard < outage, 'the guard must run before the outage block');
    assert.match(src, /#236/);
  });
});

describe('verify-checklist-gate: the go skill reconciles a downgraded verdict', () => {
  const go = () => readSrc('skills/go/SKILL.md');
  const section6 = () => go().split('## 6. Reconcile & Report')[1].split('\n## ')[0];

  it('section 6 branches on downgraded_from and sets plan-verified', () => {
    const s = section6();
    assert.ok(s.includes('verdict.downgraded_from'));
    assert.match(s, /status: plan-verified/);
  });

  it('rewrites the VERIFY.md Overall Status line to a downgraded FAIL', () => {
    assert.ok(section6().includes('**Overall Status:** FAIL (downgraded by go workflow from {downgraded_from}: {downgrade_reason})'));
  });

  it('appends a pending fix phase with one task per bug, failed checklist row, or failed trial merge', () => {
    const s = section6();
    assert.ok(s.includes('<phase id="fix-{n}" name="Verify fix round {n}" status="pending">'));
    assert.match(s, /one task per `verdict\.bugs` entry/);
    assert.match(s, /failed `verdict\.checklist` row or failed `verdict\.trial_merge`/);
    assert.match(s, /Fix: \{description\}/);
  });

  it('the GO COMPLETE report and the headless table name the downgrade', () => {
    const g = go();
    assert.ok(g.includes('FAIL (downgraded from {downgraded_from})'));
    assert.match(g, /\| Verdict FAIL, or a PASS\/INCONCLUSIVE downgraded[^\n]*`verify-fail`/);
  });
});
