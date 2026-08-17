/**
 * Headless-mode doctrine — go-skill wiring against the contract of record.
 *
 * The contract lives in ship/docs/headless.md; the go skill conforms to it.
 * Doc/skill phrase drift is the failure mode these tests exist to catch, so
 * every assertion targets contract-bearing strings (paths, outcome words,
 * fence tag, file names) — never incidental prose.
 *
 * Scoped to the canonical `skills/` and `ship/` trees only — never the
 * legacy `.claude/` mirrors or `.planning/` documents.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const OUTCOMES = [
  'done', 'deferred', 'needs-input', 'stuck', 'unresolved', 'blocked',
  'verify-fail', 'needs-context', 'exhausted', 'checkpoint', 'error',
];

describe('headless doctrine — flag parsing', () => {
  it('go frontmatter argument-hint advertises --headless', () => {
    const fm = readSrc('skills/go/SKILL.md').split('---')[1];
    assert.ok(/argument-hint:.*--headless/.test(fm), 'argument-hint must list --headless');
  });

  it('go strips --headless alongside --auto before resolving the feature', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(go.includes('strip `--auto` and `--headless`'),
      'section 1 must strip both flags in any argument order');
  });

  it('go states --headless implies --auto', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(go.includes('implies `--auto`'), 'the intro must say --headless implies --auto');
    assert.ok(go.includes('`--headless` sets `--auto`'), 'section 1 must set --auto when --headless is present');
  });
});

describe('headless doctrine — contract doc exists and is referenced', () => {
  it('ship/docs/headless.md exists', () => {
    assert.ok(fs.existsSync(path.join(repoRoot, 'ship/docs/headless.md')),
      'the contract of record must live at ship/docs/headless.md');
  });

  it('go skill references the contract doc path', () => {
    assert.ok(readSrc('skills/go/SKILL.md').includes('ship/docs/headless.md'),
      'the go skill must point at ship/docs/headless.md');
  });

  it('doc carries all 11 outcome words', () => {
    const doc = readSrc('ship/docs/headless.md');
    for (const word of OUTCOMES) {
      assert.ok(doc.includes('`' + word + '`'), `doc must define the \`${word}\` outcome`);
    }
  });

  it('doc specifies schema_version, the ship_outcome fence tag, and QUESTIONS.md frontmatter', () => {
    const doc = readSrc('ship/docs/headless.md');
    assert.ok(doc.includes('schema_version'), 'OUTCOME.json schema must carry schema_version');
    assert.ok(doc.includes('ship_outcome'), 'the fenced block tag ship_outcome must be specified');
    assert.ok(doc.includes('QUESTIONS.md'), 'the QUESTIONS.md format must be specified');
    assert.ok(doc.includes('roundOffset'), 'QUESTIONS.md frontmatter must record roundOffset');
  });
});

/**
 * The park path is split on purpose: the go skill owns the control flow (when
 * to park, which outcome, what status to leave behind) and the contract doc
 * owns the file format. Each assertion below therefore targets whichever file
 * is the single source for the thing it checks — asserting format strings
 * against the skill is what would re-introduce the duplication.
 */
describe('headless doctrine — QUESTIONS.md park path', () => {
  it('go writes QUESTIONS.md on headless NEEDS_INPUT and defers the format to the doc', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(go.includes('QUESTIONS.md'), 'the park path must write QUESTIONS.md');
    assert.ok(go.includes('roundOffset'), 'go computes roundOffset, so it must name it');
    assert.ok(/format specified in \*\*`ship\/docs\/headless\.md` §6\*\*/.test(go),
      'go must point at the doc section that owns the QUESTIONS.md format');
  });

  it('go states the park behaviour without restating the file format', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(!go.includes('**Why blocking:**'),
      'the per-question format belongs to the doc alone; restating it here is the drift risk');
    assert.ok(!go.includes('QUESTIONS-{roundOffset}.answered.md'),
      'the archive naming rule belongs to the doc alone');
  });

  it('the doc owns the QUESTIONS.md section shape', () => {
    const doc = readSrc('ship/docs/headless.md');
    assert.ok(doc.includes('**Answer:**'), 'each question section carries an empty **Answer:** line');
    assert.ok(doc.includes('why_blocking'), 'each question section carries the why_blocking line');
    assert.ok(doc.includes('QUESTIONS-{roundOffset}.answered.md'),
      'the archive name is derived from the recorded roundOffset');
  });

  it('an unanswered file terminates without re-running the loop', () => {
    assert.ok(/unanswered → terminate as `needs-input`.*?without re-running the loop/
      .test(readSrc('skills/go/SKILL.md')),
      'go must carry the branch itself — it decides before invoking the workflow');
    assert.ok(readSrc('ship/docs/headless.md').includes('awaiting answers'),
      'the doc pins the detail string the caller reads');
  });

  it('the interactive AskUserQuestion branch survives, and headless forbids it', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(go.includes('via AskUserQuestion'),
      'the interactive NEEDS_INPUT branch still asks via AskUserQuestion');
    assert.ok(go.includes('do NOT call AskUserQuestion'),
      'the headless NEEDS_INPUT branch must never call AskUserQuestion');
  });
});

describe('headless doctrine — OUTCOME.json termination rule', () => {
  it('go deletes OUTCOME.json at run start and writes it as the last act', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(/delete `\.planning\/features\/\{name\}\/OUTCOME\.json`/.test(go),
      'the headless preamble deletes any existing OUTCOME.json as the first act');
    assert.ok(/LAST act, write `\.planning\/features\/\{name\}\/OUTCOME\.json`/.test(go),
      'the termination rule writes OUTCOME.json as the run\'s last act');
  });

  it('go ends the final message with the ship_outcome fenced block', () => {
    assert.ok(readSrc('skills/go/SKILL.md').includes('ship_outcome'),
      'the final message must end with a fenced ship_outcome block');
  });

  it('go maps every build/verify terminal to its outcome word', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(/FAIL[^\n]*`verify-fail`/.test(go), 'verdict FAIL maps to verify-fail');
    assert.ok(/NEEDS_CONTEXT[^\n]*`needs-context`/.test(go), 'stop NEEDS_CONTEXT maps to needs-context');
    assert.ok(/EXHAUSTED[^\n]*`exhausted`/.test(go), 'stop EXHAUSTED maps to exhausted');
    assert.ok(/CHECKPOINT[^\n]*`checkpoint`/.test(go), 'stop CHECKPOINT maps to checkpoint');
  });
});

describe('headless doctrine — finish is never run headlessly', () => {
  it('the done routing and finish section both suppress /ship:finish', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(go.includes('never attempted headlessly'),
      'routing on status done must not invoke /ship:finish under --headless');
    assert.ok(go.includes('finish offer suppressed'),
      'the post-verify finish offer is suppressed under --headless');
  });
});

describe('headless doctrine — interactive behavior unchanged', () => {
  it('go states interactive runs never write OUTCOME.json', () => {
    assert.ok(readSrc('skills/go/SKILL.md').includes('Interactive runs never write this file'),
      'the termination rule must guard OUTCOME.json behind --headless');
  });

  it('doc compatibility section guards both files behind --headless', () => {
    assert.ok(readSrc('ship/docs/headless.md').includes(
      'Interactive (non-headless) runs never write OUTCOME.json or QUESTIONS.md'),
      'doc section 8 must state interactive runs write neither file');
  });
});

/**
 * The workflow wait rule. The Workflow tool launches in the background and
 * returns a Task ID, not a result — so a headless turn that ends right after
 * invoking it exits having reconciled nothing, whatever the workflow later
 * does. These assertions pin the mechanism (blocking call, its maximum
 * timeout, repetition, the TaskStop-before-terminate ordering) rather than the
 * prose around it, and pin that the rule stays scoped to --headless.
 */
describe('headless doctrine — the turn never ends mid-workflow', () => {
  it('go declares TaskOutput and TaskStop in allowed-tools', () => {
    const fm = readSrc('skills/go/SKILL.md').split('---')[1];
    assert.ok(/allowed-tools:.*\bTaskOutput\b/.test(fm),
      'the skill cannot block on a workflow without TaskOutput in allowed-tools');
    assert.ok(/allowed-tools:.*\bTaskStop\b/.test(fm),
      'the wait-cap path calls TaskStop, so it must be in allowed-tools');
    assert.ok(/allowed-tools:.*\bToolSearch\b/.test(fm),
      'the rule tells go to load deferred TaskOutput/TaskStop with ToolSearch, so it must be in allowed-tools too');
  });

  it('go names the wait rule and states the tool returns a Task ID, not a result', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(go.includes('### Headless workflow wait'),
      'the wait rule must be a findable named section');
    assert.ok(go.includes('does not return the workflow’s result')
      || go.includes("does not return the workflow's result"),
      'the rule must state that Workflow does not return the result');
    assert.ok(/Task ID/.test(go), 'the rule must name the Task ID as what comes back');
  });

  it('go blocks with TaskOutput at the tool maximum timeout', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(/TaskOutput/.test(go), 'the blocking primitive is TaskOutput');
    assert.ok(/block:\s*true/.test(go), 'the call must block');
    assert.ok(/600000/.test(go), '600000ms is the documented maximum for one TaskOutput call');
  });

  it('go repeats the blocking call rather than trusting a single 10-minute wait', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(/while the status is still running, repeat step 3/.test(go),
      'a build spine outlasts one TaskOutput call, so the rule must repeat it');
    assert.ok(/12\*{0,2} calls/.test(go), 'the repetition must be bounded at 12 calls');
    assert.ok(/2-hour ceiling/.test(go), 'the bound must be stated as a 2-hour ceiling');
  });

  it('go reconciles from the blocking call rather than waiting for a notification too', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(/`<status>`/.test(go), 'the loop condition is the reply status');
    assert.ok(/`<output>` carries `result`/.test(go),
      'the blocking reply carries the workflow return value; go must know to read it');
    assert.ok(/do not wait for a separate notification/.test(go),
      'waiting for a notification on top of a completed TaskOutput would re-strand the turn');
  });

  it('go loads the deferred TaskOutput/TaskStop schemas before calling them', () => {
    assert.ok(readSrc('skills/go/SKILL.md').includes('select:TaskOutput,TaskStop'),
      'both tools may be deferred; the rule must say how to load them');
  });

  it('go stops the task before terminating on the wait ceiling', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(/TaskStop[^.]*\*\*before\*\* terminating/.test(go),
      'terminating without TaskStop recreates the orphan the rule exists to prevent');
    assert.ok(go.includes('workflow exceeded the 2-hour headless wait cap'),
      'the cap must terminate with a specific, caller-readable detail string');
  });

  it('the wait ceiling reuses the existing error outcome rather than adding a 12th word', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(/2-hour wait ceiling \| `error`/.test(go),
      'the cap maps to `error`; a new outcome word would force a lockstep caller release');
  });

  it('both Workflow invocation sites point at the wait rule', () => {
    const go = readSrc('skills/go/SKILL.md');
    const pointers = go.match(/see \*\*Headless workflow wait\*\* above/g) || [];
    assert.equal(pointers.length, 2,
      'section 2a (plan loop) and section 5 (build spine) must each point at the rule');
  });

  it('the rule is scoped to --headless so interactive runs still return promptly', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(go.includes('Interactively that is fine and **must not change**'),
      'the rule must protect the interactive path explicitly');
    assert.ok(/Blocking an interactive run for the length of a build would be a worse bug/.test(go),
      'the reason interactive must not block belongs in the doctrine, not just the commit');
    const pointerLines = go.split('\n').filter((l) => l.includes('Headless workflow wait** above'));
    for (const line of pointerLines) {
      assert.ok(line.includes('--headless'),
        `each pointer must be conditioned on --headless: ${line}`);
    }
  });

  it('the contract doc states the guarantee and delegates the mechanism to the skill', () => {
    const doc = readSrc('ship/docs/headless.md');
    assert.ok(/##\s*2\.\s*Run completion/.test(doc),
      'the contract of record must document run completion');
    assert.ok(/A headless run that returns has finished/.test(doc),
      'the caller-facing guarantee is what the contract owes a caller');
    assert.ok(/ceiling is 2 hours/.test(doc), 'callers size their own timeout against the ceiling');
    assert.ok(!doc.includes('600000'),
      'the timeout maximum is mechanism — duplicating it here is what drifts');
    assert.ok(/`skills\/go\/SKILL\.md`/.test(doc),
      'the doc must point at the skill section that owns the mechanism');
    assert.ok(/no caller needs to change/.test(doc),
      'the doc must state the result shape is unchanged for callers');
  });
});
