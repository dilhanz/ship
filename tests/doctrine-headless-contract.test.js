/**
 * Headless-mode contract examples — adversarial verification.
 *
 * The doc's JSON examples ARE the contract external callers copy from, so
 * they must machine-parse and match the schema the doc itself specifies.
 * These tests also pin cross-file phrase consistency (doc <-> go skill) on
 * contract-bearing detail strings that the caller may branch on.
 *
 * Scoped to the canonical `skills/` and `ship/` trees only.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const doc = readSrc('ship/docs/headless.md');
const go = readSrc('skills/go/SKILL.md');

const OUTCOMES = [
  'done', 'needs-input', 'stuck', 'unresolved', 'blocked', 'infrastructure',
  'verify-fail', 'needs-context', 'exhausted', 'checkpoint', 'error',
];
const REQUIRED_FIELDS = ['schema_version', 'feature', 'outcome', 'status', 'timestamp', 'head', 'detail'];

const jsonBlocks = [...doc.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)].map((m) => m[1]);
const shipOutcomeBlock = doc.match(/```ship_outcome\r?\n([\s\S]*?)\r?\n```/);

describe('headless contract — OUTCOME.json example is schema-valid', () => {
  it('the doc contains a parseable OUTCOME.json example', () => {
    assert.ok(jsonBlocks.length >= 1, 'expected at least one fenced json block');
    const example = JSON.parse(jsonBlocks[0]);
    for (const f of REQUIRED_FIELDS) {
      assert.ok(f in example, `example must carry required field ${f}`);
    }
    assert.equal(example.schema_version, 1, 'schema_version is the integer 1');
    assert.ok(OUTCOMES.includes(example.outcome), 'outcome must be one of the 11 words');
    assert.ok(!Number.isNaN(Date.parse(example.timestamp)), 'timestamp must be parseable ISO 8601');
    assert.match(example.head, /^[0-9a-f]{40}$/, 'head is a full git SHA');
  });

  it('questions_file appears exactly when the outcome is needs-input', () => {
    const example = JSON.parse(jsonBlocks[0]);
    if (example.outcome === 'needs-input') {
      assert.ok(typeof example.questions_file === 'string' && example.questions_file.includes('QUESTIONS.md'),
        'needs-input example must carry a questions_file pointing at QUESTIONS.md');
    } else {
      assert.ok(!('questions_file' in example), 'questions_file is needs-input-only');
    }
  });

  it('the ship_outcome fenced example parses and matches the same schema', () => {
    assert.ok(shipOutcomeBlock, 'the doc must show a fenced ship_outcome example');
    const example = JSON.parse(shipOutcomeBlock[1]);
    for (const f of REQUIRED_FIELDS) {
      assert.ok(f in example, `ship_outcome example must carry ${f}`);
    }
    assert.ok(OUTCOMES.includes(example.outcome));
    if (example.outcome !== 'needs-input') {
      assert.ok(!('questions_file' in example), 'questions_file is needs-input-only');
    }
  });
});

describe('headless contract — QUESTIONS.md embedded needs_input example', () => {
  it('the embedded needs_input JSON array parses and matches REPLAN_SCHEMA shape', () => {
    assert.ok(jsonBlocks.length >= 2, 'the QUESTIONS.md example must embed the raw needs_input json block');
    const arr = JSON.parse(jsonBlocks[1]);
    assert.ok(Array.isArray(arr) && arr.length >= 1, 'needs_input is a non-empty array');
    for (const entry of arr) {
      assert.equal(typeof entry.question, 'string');
      assert.ok(Array.isArray(entry.options) && entry.options.length >= 2 && entry.options.length <= 4,
        'each entry carries 2-4 options per REPLAN_SCHEMA');
      assert.equal(typeof entry.why_blocking, 'string');
    }
  });

  it('every question in the embedded JSON has a matching ### Q section with an empty Answer line', () => {
    const arr = JSON.parse(jsonBlocks[1]);
    arr.forEach((entry, i) => {
      assert.ok(doc.includes(`### Q${i + 1}: ${entry.question}`),
        `example must show a ### Q${i + 1} section for "${entry.question}"`);
    });
    const answerLines = doc.match(/^\*\*Answer:\*\*\s*$/gm) || [];
    assert.ok(answerLines.length >= arr.length, 'each question section carries an empty **Answer:** line');
  });
});

describe('headless contract — doc and skill agree on contract-bearing strings', () => {
  it('the doc outcome table lists all 11 outcomes as rows', () => {
    for (const word of OUTCOMES) {
      assert.match(doc, new RegExp('^\\| `' + word + '` \\|', 'm'), `outcome table must row \`${word}\``);
    }
  });

  it('the cap-reached detail phrase matches between doc and skill', () => {
    const phrase = 're-invocation cap reached — escalate to a human';
    assert.ok(doc.includes(phrase), 'doc section 6 carries the cap-reached detail');
    assert.ok(go.includes(phrase), 'go skill carries the identical cap-reached detail');
  });

  it('the awaiting-answers detail phrase matches between doc and skill', () => {
    assert.ok(go.includes('QUESTIONS.md awaiting answers'), 'go skill idempotent-park detail');
    assert.ok(doc.includes('Any answer still empty'), 'doc documents the idempotent re-invoke');
  });

  // Split by kind: strings the skill *emits* (detail values) are duplicated by
  // necessity and pinned in sync above; strings that describe file *structure*
  // live only in the doc, and the skill points at the section that owns them.
  it('the archive name template lives in the doc, with the skill pointing at it', () => {
    const name = 'QUESTIONS-{roundOffset}.answered.md';
    assert.ok(doc.includes(name), 'doc specifies the archive name');
    assert.ok(!go.includes(name), 'a second copy in the skill is what drifts');
    assert.ok(/`ship\/docs\/headless\.md` §7/.test(go),
      'the skill must point at the section that owns the answer round-trip');
  });

  it('both files pin the OUTCOME.json path', () => {
    const p = '.planning/features/{name}/OUTCOME.json';
    assert.ok(doc.includes(p), 'doc pins the OUTCOME.json path');
    assert.ok(go.includes(p), 'go skill pins the identical path');
  });
});
