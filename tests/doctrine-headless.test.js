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
  'done', 'needs-input', 'stuck', 'unresolved', 'blocked',
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

  it('doc carries all 10 outcome words', () => {
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

describe('headless doctrine — QUESTIONS.md park path', () => {
  it('go writes QUESTIONS.md on headless NEEDS_INPUT in the documented shape', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(go.includes('QUESTIONS.md'), 'the park path must write QUESTIONS.md');
    assert.ok(go.includes('**Answer:**'), 'each question section carries an empty **Answer:** line');
    assert.ok(go.includes('why_blocking'), 'each question section carries the why_blocking line');
    assert.ok(go.includes('roundOffset'), 'the frontmatter must record roundOffset');
  });

  it('go archives an answered file to a .answered.md name', () => {
    const go = readSrc('skills/go/SKILL.md');
    assert.ok(go.includes('.answered.md'), 'the answered file must be archived as *.answered.md');
    assert.ok(go.includes('QUESTIONS-{roundOffset}.answered.md'),
      'the archive name is derived from the recorded roundOffset');
  });

  it('go terminates idempotently when answers are still empty', () => {
    assert.ok(readSrc('skills/go/SKILL.md').includes('awaiting answers'),
      'an unanswered file terminates as needs-input without re-running the loop');
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
