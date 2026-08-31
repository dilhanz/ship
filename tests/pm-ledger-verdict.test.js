// Verdict extraction — the four shapes Ship's agents actually write into
// VERIFY.md, normalised to the documented Verify enum with the qualifier
// preserved separately.
//
// The ledger used to read exactly one shape (`**Overall Status:**`) and
// recorded `unknown` for the other three, which is a confidently wrong
// answer dressed as an admitted gap. These tests pin the precedence order —
// notably that the Stage-1 `IN PROGRESS` flush marker outranks a bare
// `**Status:**` match, but loses to an `**Overall Status:**` line — and pin
// that an unrecognised verdict keeps its raw text in the note rather than
// discarding it.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const { extractVerdict, LEDGER_COLUMNS } = require(SCRIPT_PATH);

describe('extractVerdict — the four shapes', () => {
  it('reads **Overall Status:**', () => {
    assert.deepEqual(extractVerdict('# Verification\n\n**Overall Status:** PASS\n'), {
      verify: 'PASS',
      note: ''
    });
  });

  it('reads a bare **Status:** when there is no Overall line', () => {
    assert.deepEqual(extractVerdict('**Status:** PASS\n'), { verify: 'PASS', note: '' });
  });

  it('reads **Verdict:** X', () => {
    assert.deepEqual(extractVerdict('**Verdict:** DEFERRED\n'), {
      verify: 'DEFERRED',
      note: ''
    });
  });

  it('reads **Verdict: X** (the marker inside the bold span)', () => {
    assert.deepEqual(extractVerdict('**Verdict: DEFERRED**\n'), {
      verify: 'DEFERRED',
      note: ''
    });
  });

  it('reads **Verdict: X** with prose following the closing asterisks', () => {
    // The inline shape captures to end of line, so the closing `**` lands
    // inside the first token. It used to yield `PASS.**` — an unrecognised
    // verdict — recording phantom verification debt for a feature that passed.
    assert.deepEqual(extractVerdict('**Verdict: PASS.** Criterion 8 holds.\n'), {
      verify: 'PASS',
      note: 'Criterion 8 holds.'
    });
    assert.deepEqual(extractVerdict('**Verdict: PASS** and more\n'), {
      verify: 'PASS',
      note: 'and more'
    });
  });

  it('reads a backtick-wrapped verdict inside the bold span', () => {
    assert.deepEqual(extractVerdict('**Verdict: `FAIL`** — criterion 2 unproven\n'), {
      verify: 'FAIL',
      note: 'criterion 2 unproven'
    });
  });

  it('reads a ## Verdict section body', () => {
    const doc = '# Report\n\n## Criteria\n\nstuff\n\n## Verdict\n\nINCONCLUSIVE\n\n## Notes\n\nmore\n';
    assert.deepEqual(extractVerdict(doc), { verify: 'INCONCLUSIVE', note: '' });
  });
});

describe('extractVerdict — precedence', () => {
  it('records in-progress for the Stage-1 flush marker', () => {
    assert.deepEqual(extractVerdict('**Status:** IN PROGRESS — Stage 1 only\n'), {
      verify: 'in-progress',
      note: 'Stage 1 only'
    });
  });

  it('lets **Overall Status:** win over a Stage-1 **Status:** line', () => {
    const doc = '**Status:** IN PROGRESS — Stage 1 only\n\n**Overall Status:** FAIL — 2 criteria failed\n';
    assert.deepEqual(extractVerdict(doc), { verify: 'FAIL', note: '2 criteria failed' });
  });

  it('lets a bare **Status:** win over a later **Verdict:** line', () => {
    const doc = '**Status:** PASS\n\n**Verdict:** FAIL\n';
    assert.deepEqual(extractVerdict(doc), { verify: 'PASS', note: '' });
  });

  it('lets a **Verdict:** line win over a ## Verdict section', () => {
    const doc = '**Verdict:** PASS\n\n## Verdict\n\nFAIL\n';
    assert.deepEqual(extractVerdict(doc), { verify: 'PASS', note: '' });
  });
});

describe('extractVerdict — normalisation', () => {
  it('splits the qualifier into the note', () => {
    assert.deepEqual(extractVerdict('**Overall Status:** PASS — all 11 criteria proven\n'), {
      verify: 'PASS',
      note: 'all 11 criteria proven'
    });
  });

  it('strips a hyphen separator from the note', () => {
    assert.deepEqual(extractVerdict('**Overall Status:** FAIL - criterion 3 unproven\n'), {
      verify: 'FAIL',
      note: 'criterion 3 unproven'
    });
  });

  it('upper-cases a lower-case verdict', () => {
    assert.deepEqual(extractVerdict('**Overall Status:** pass\n'), { verify: 'PASS', note: '' });
  });

  it('strips bold markers and trailing punctuation', () => {
    assert.deepEqual(extractVerdict('**Overall Status:** **PASS.**\n'), {
      verify: 'PASS',
      note: ''
    });
  });

  it('accepts every documented enum value', () => {
    for (const verdict of ['PASS', 'FAIL', 'INCONCLUSIVE', 'DEFERRED']) {
      assert.deepEqual(extractVerdict(`**Overall Status:** ${verdict}\n`), {
        verify: verdict,
        note: ''
      });
    }
  });

  it('keeps the raw text as the note for an unrecognised verdict', () => {
    assert.deepEqual(extractVerdict('**Overall Status:** MOSTLY FINE, PROBABLY\n'), {
      verify: 'unknown',
      note: 'MOSTLY FINE, PROBABLY'
    });
  });

  it('records unknown for an empty document', () => {
    assert.deepEqual(extractVerdict(''), { verify: 'unknown', note: '' });
  });

  it('records unknown for a document carrying no verdict shape at all', () => {
    assert.deepEqual(extractVerdict('# Verification\n\nSome prose and nothing else.\n'), {
      verify: 'unknown',
      note: ''
    });
  });

  it('degrades to unknown for a null or non-string argument', () => {
    assert.deepEqual(extractVerdict(null), { verify: 'unknown', note: '' });
    assert.deepEqual(extractVerdict(undefined), { verify: 'unknown', note: '' });
    assert.deepEqual(extractVerdict(42), { verify: 'unknown', note: '' });
  });
});

describe('LEDGER_COLUMNS carries the verdict columns', () => {
  // `Outcome` and `Verify note` arrived with header-aware rendering, in one
  // commit: a widened column list without it would misalign every append to
  // an existing ten-column ledger. tests/pm-ledger-header.test.js owns that
  // guarantee; this is the column list the note the extractor produces lands in.
  it('holds Verify note beside Verify', () => {
    assert.deepEqual(LEDGER_COLUMNS, [
      'Feature',
      'Shipped',
      'Profile',
      'Outcome',
      'Verify',
      'Verify note',
      'Unresolved carried',
      'Plan rounds',
      'Fix rounds',
      'Findings (C/H/M/L)',
      'Phases',
      'Artifacts'
    ]);
  });
});
