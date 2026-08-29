// PM:PRIORITY evidence layer — the Unblocks inversion, the promotion-only
// derivation rule, the First-seen stamp, and the `--evidence` query mode.
// Fixtures are built inline as strings and driven through the real parser, so
// nothing here depends on this repo's own (gitignored) .project-manager/.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const { parseRoadmap, computeUnblocks, derivePriority, stampFirstSeen } = require(SCRIPT_PATH);

/** Spawn the CLI in a given cwd, return { status, stdout, stderr }. */
function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd, encoding: 'utf8' });
}

function tmpRepo(prefix = 'ship-evidence-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Build a markdown backlog table from a header list and row cell arrays. */
function table(headers, rows) {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(cells => `| ${cells.join(' | ')} |`)
  ];
  return `${lines.join('\n')}\n`;
}

/** A full ROADMAP.md around one backlog table. */
function roadmap(body) {
  return `---\nproject: "Test"\nupdated: "2026-01-01"\n---\n\n### M1 — Test (status: active)\n\n${body}`;
}

/** Write a ROADMAP.md into a temp dir's .project-manager/ and return its path. */
function writeRoadmap(dir, content) {
  const pmDir = path.join(dir, '.project-manager');
  fs.mkdirSync(pmDir, { recursive: true });
  const file = path.join(pmDir, 'ROADMAP.md');
  fs.writeFileSync(file, content);
  return file;
}

const EVIDENCE_HEADERS = [
  'Item', 'Status', 'Priority', 'Depends on', 'Source', 'Ship feature', 'Blast radius', 'Confidence', 'First seen'
];

/** Parse a table and derive one named item's priority evidence. */
function deriveFor(body, item) {
  const rows = parseRoadmap(body);
  const unblocks = computeUnblocks(rows);
  const row = rows.find(r => r.cells.Item === item);
  assert.ok(row, `fixture has no row named ${item}`);
  return derivePriority(row, unblocks.get(item));
}

const rank = p => (typeof p === 'string' && /^P[0-3]$/.test(p) ? Number(p[1]) : 3);

describe('PM:PRIORITY — derivation branches', () => {
  it('users + proven promotes to P0', () => {
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P3', '—', 'src', '—', 'users', 'proven', '—']
    ]);
    const r = deriveFor(body, 'A');
    assert.equal(r.derived, 'P0');
    assert.equal(r.recorded, 'P3');
    assert.equal(r.needsEvidence, false);
    assert.ok(r.reasons.some(x => /users.*proven/.test(x)));
  });

  it('users + suspected promotes to at least P1', () => {
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P3', '—', 'src', '—', 'users', 'suspected', '—']
    ]);
    const r = deriveFor(body, 'A');
    assert.equal(r.derived, 'P1');
    assert.ok(rank(r.derived) <= 1);
  });

  it('contributors + proven promotes to at least P1', () => {
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P2', '—', 'src', '—', 'contributors', 'proven', '—']
    ]);
    const r = deriveFor(body, 'A');
    assert.equal(r.derived, 'P1');
    assert.ok(rank(r.derived) <= 1);
  });

  it('internal + proven fires no blast-radius clause', () => {
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P2', '—', 'src', '—', 'internal', 'proven', '—']
    ]);
    const r = deriveFor(body, 'A');
    assert.equal(r.derived, 'P2');
    assert.equal(r.needsEvidence, false);
    assert.deepEqual(r.reasons, ['no clause fired → unchanged']);
  });

  it('two non-done dependents promote one level', () => {
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P3', '—', 'src', '—', 'internal', 'proven', '—'],
      ['B', 'pending', 'P3', 'A', 'src', '—', '—', '—', '—'],
      ['C', 'pending', 'P3', 'A', 'src', '—', '—', '—', '—']
    ]);
    const r = deriveFor(body, 'A');
    assert.equal(r.unblocks, 2);
    assert.equal(r.derived, 'P2');
    assert.ok(r.reasons.some(x => /unblocks 2 unfinished items/.test(x)));
  });

  it('a single in-progress dependent promotes one level', () => {
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P3', '—', 'src', '—', 'internal', 'proven', '—'],
      ['B', 'in-progress', 'P3', 'A', 'src', '—', '—', '—', '—']
    ]);
    const r = deriveFor(body, 'A');
    assert.equal(r.unblocks, 1);
    assert.equal(r.derived, 'P2');
    assert.ok(r.reasons.some(x => /in flight/.test(x)));
  });

  it('confidence unknown blocks every promotion', () => {
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P2', '—', 'src', '—', 'users', '—', '—'],
      ['B', 'pending', 'P3', 'A', 'src', '—', '—', '—', '—'],
      ['C', 'in-progress', 'P3', 'A', 'src', '—', '—', '—', '—']
    ]);
    const r = deriveFor(body, 'A');
    assert.equal(r.confidence, 'unknown');
    assert.equal(r.derived, r.recorded);
    assert.equal(r.derived, 'P2');
    assert.equal(r.needsEvidence, true);
    assert.deepEqual(r.reasons, ['confidence unknown → no promotion']);
  });

  it('both authored columns absent read as unknown with no promotion', () => {
    const body = table(
      ['Item', 'Status', 'Priority', 'Depends on', 'Ship feature'],
      [['A', 'pending', 'P2', '—', '—']]
    );
    const r = deriveFor(body, 'A');
    assert.equal(r.blastRadius, 'unknown');
    assert.equal(r.confidence, 'unknown');
    assert.equal(r.firstSeen, 'unknown');
    assert.equal(r.derived, 'P2');
    assert.equal(r.needsEvidence, true);
  });

  it('an unrecognised authored value degrades to unknown', () => {
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P2', '—', 'src', '—', 'everyone', 'certain', '—']
    ]);
    const r = deriveFor(body, 'A');
    assert.equal(r.blastRadius, 'unknown');
    assert.equal(r.confidence, 'unknown');
    assert.equal(r.derived, 'P2');
    assert.equal(r.needsEvidence, true);
  });

  it('an unrecorded priority takes base rank P3', () => {
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', '—', '—', 'src', '—', 'internal', 'proven', '—']
    ]);
    const r = deriveFor(body, 'A');
    assert.equal(r.recorded, null);
    assert.equal(r.derived, 'P3');
  });

  it('a malformed row object does not throw', () => {
    assert.doesNotThrow(() => derivePriority({}, undefined));
    assert.doesNotThrow(() => derivePriority(undefined, undefined));
    const r = derivePriority(undefined, undefined);
    assert.equal(r.derived, 'P3');
    assert.equal(r.recorded, null);
  });
});

describe('PM:PRIORITY — the never-demote invariant', () => {
  it('derived is never a lower priority than recorded, across the cross-product', () => {
    const radii = ['users', 'contributors', 'internal', '—', 'nonsense'];
    const confidences = ['proven', 'suspected', '—', 'nonsense'];
    const priorities = ['P0', 'P1', 'P2', 'P3', '—'];

    for (const blast of radii) {
      for (const conf of confidences) {
        for (const priority of priorities) {
          for (let count = 0; count <= 3; count++) {
            for (const inProgress of [false, true]) {
              const row = {
                cells: {
                  Item: 'A',
                  Status: 'pending',
                  Priority: priority,
                  'Blast radius': blast,
                  Confidence: conf,
                  'First seen': '—'
                }
              };
              const r = derivePriority(row, { count, inProgress });
              const label = `${blast}/${conf}/${priority}/${count}/${inProgress}`;
              assert.match(r.derived, /^P[0-3]$/, label);
              assert.ok(rank(r.derived) <= rank(r.recorded), `demoted: ${label}`);
              assert.equal(typeof r.unblocks, 'number', label);
              assert.ok(Array.isArray(r.reasons) && r.reasons.length > 0, label);
            }
          }
        }
      }
    }
  });

  it('the unblocks clause is floored at P1', () => {
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P1', '—', 'src', '—', 'internal', 'proven', '—'],
      ['B', 'pending', 'P3', 'A', 'src', '—', '—', '—', '—'],
      ['C', 'pending', 'P3', 'A', 'src', '—', '—', '—', '—'],
      ['D', 'in-progress', 'P3', 'A', 'src', '—', '—', '—', '—']
    ]);
    const r = deriveFor(body, 'A');
    assert.equal(r.unblocks, 3);
    assert.equal(r.derived, 'P1'); // never P0 on the unblocks clause alone
  });
});

describe('computeUnblocks — the selectNext dependency convention', () => {
  it('counts only non-done dependents and flags in-progress ones', () => {
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P2', '—', 'src', '—', '—', '—', '—'],
      ['B', 'done', 'P2', 'A', 'src', '—', '—', '—', '—'],
      ['C', 'pending', 'P2', 'A', 'src', '—', '—', '—', '—'],
      ['D', 'in-progress', 'P2', 'A', 'src', '—', '—', '—', '—']
    ]);
    const u = computeUnblocks(parseRoadmap(body));
    assert.equal(u.get('A').count, 2);
    assert.equal(u.get('A').inProgress, true);
  });

  it('a done dependent contributes nothing, leaving inProgress false', () => {
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P2', '—', 'src', '—', '—', '—', '—'],
      ['B', 'done', 'P2', 'A', 'src', '—', '—', '—', '—']
    ]);
    const u = computeUnblocks(parseRoadmap(body));
    assert.equal(u.get('A').count, 0);
    assert.equal(u.get('A').inProgress, false);
  });

  it('the name match is exact and case-sensitive', () => {
    const body = table(EVIDENCE_HEADERS, [
      ['Alpha', 'pending', 'P2', '—', 'src', '—', '—', '—', '—'],
      ['B', 'pending', 'P2', 'alpha', 'src', '—', '—', '—', '—'],
      ['C', 'pending', 'P2', 'Alpha extra', 'src', '—', '—', '—', '—']
    ]);
    const u = computeUnblocks(parseRoadmap(body));
    assert.equal(u.get('Alpha').count, 0);
  });

  it('a multi-name Depends on cell counts the dependent once per name', () => {
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P2', '—', 'src', '—', '—', '—', '—'],
      ['B', 'pending', 'P2', '—', 'src', '—', '—', '—', '—'],
      ['C', 'pending', 'P2', 'A, B, A', 'src', '—', '—', '—', '—']
    ]);
    const u = computeUnblocks(parseRoadmap(body));
    assert.equal(u.get('A').count, 1);
    assert.equal(u.get('B').count, 1);
  });

  it('an empty or dash Depends on cell contributes nothing', () => {
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P2', '—', 'src', '—', '—', '—', '—'],
      ['B', 'pending', 'P2', '-', 'src', '—', '—', '—', '—'],
      ['C', 'pending', 'P2', '', 'src', '—', '—', '—', '—']
    ]);
    const u = computeUnblocks(parseRoadmap(body));
    for (const item of ['A', 'B', 'C']) assert.equal(u.get(item).count, 0);
  });

  it('never throws on junk input', () => {
    assert.equal(computeUnblocks(undefined).size, 0);
    assert.equal(computeUnblocks([]).size, 0);
    assert.doesNotThrow(() => computeUnblocks([{}, { cells: {} }]));
  });
});

describe('First seen — stamped once, never rewritten', () => {
  it('the CLI stamps today into empty cells and leaves the rest alone', () => {
    const dir = tmpRepo();
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P2', '—', 'src', '—', 'users', 'proven', '—'],
      ['B', 'pending', 'P2', '—', 'src', '—', '—', '—', '2020-01-01']
    ]);
    const file = writeRoadmap(dir, roadmap(body));

    const r = runCli(dir);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');

    const after = fs.readFileSync(file, 'utf8');
    const rows = parseRoadmap(after);
    assert.equal(rows.find(x => x.cells.Item === 'A').cells['First seen'], today());
    assert.equal(rows.find(x => x.cells.Item === 'B').cells['First seen'], '2020-01-01');
    assert.match(after, /^updated: "\d{4}-\d{2}-\d{2}"$/m);
  });

  it('a second run rewrites nothing', () => {
    const dir = tmpRepo();
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P2', '—', 'src', '—', 'users', 'proven', '—']
    ]);
    const file = writeRoadmap(dir, roadmap(body));

    assert.equal(runCli(dir).status, 0);
    const first = fs.readFileSync(file, 'utf8');
    assert.equal(runCli(dir).status, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), first);
  });

  it('a later date never overwrites an existing stamp', () => {
    // The CLI takes no date argument, so the module drives the injected-date
    // case directly — the same function the CLI write path calls.
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P2', '—', 'src', '—', 'users', 'proven', '—']
    ]);
    const first = stampFirstSeen(body, '2026-01-01');
    assert.equal(first.changed, true);
    const second = stampFirstSeen(first.content, '2030-12-31');
    assert.equal(second.changed, false);
    assert.equal(second.content, first.content);
    assert.ok(first.content.includes('2026-01-01'));
    assert.ok(!first.content.includes('2030-12-31'));
  });

  it('a table without the column is byte-identical after a run', () => {
    const dir = tmpRepo();
    const body = table(
      ['Item', 'Status', 'Priority', 'Depends on', 'Ship feature'],
      [['A', 'pending', 'P2', '—', '—']]
    );
    const content = roadmap(body);
    const file = writeRoadmap(dir, content);

    const r = runCli(dir);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  });

  it('padding and CRLF terminators elsewhere survive the splice', () => {
    const crlf =
      '| Item | Status | Priority | Ship feature | First seen |\r\n' +
      '| --- | --- | --- | --- | --- |\r\n' +
      '|   A   | pending  | P2 | — | — |\r\n';
    const { content, changed } = stampFirstSeen(crlf, '2026-08-24');
    assert.equal(changed, true);
    assert.ok(content.includes('|   A   | pending  | P2 | — | 2026-08-24 |\r\n'));
  });
});

describe('--evidence — the query-mode contract', () => {
  const REQUIRED_KEYS = [
    'item', 'recorded', 'derived', 'unblocks', 'firstSeen', 'blastRadius', 'confidence', 'needsEvidence'
  ];

  it('emits every required key per row, in document order, writing nothing', () => {
    const dir = tmpRepo();
    const body = table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P2', '—', 'src', 'feat-a', 'users', 'proven', '—'],
      ['B', 'in-progress', 'P3', 'A', 'src', '—', '—', '—', '—'],
      ['C', 'pending', 'P3', 'A', 'src', '—', 'contributors', 'proven', '2026-01-01']
    ]);
    const content = roadmap(body);
    const file = writeRoadmap(dir, content);

    const r = runCli(dir, ['--evidence']);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');

    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.map(e => e.item), ['A', 'B', 'C']);
    for (const entry of out) {
      for (const key of REQUIRED_KEYS) assert.ok(key in entry, `${entry.item} missing ${key}`);
      assert.equal(typeof entry.unblocks, 'number');
      assert.ok(Array.isArray(entry.reasons));
      assert.equal(entry.milestone, 'M1 — Test');
    }
    assert.equal(out[0].derived, 'P0');
    assert.equal(out[0].unblocks, 2);
    assert.equal(out[1].status, 'in-progress');
    assert.equal(out[1].needsEvidence, true);
    assert.equal(out[2].firstSeen, '2026-01-01');

    // Writes nothing at all: no roadmap edit, no stamp, no dashboard, no ledger.
    assert.equal(fs.readFileSync(file, 'utf8'), content);
    assert.equal(fs.existsSync(path.join(dir, '.project-manager', 'dashboard.html')), false);
    assert.equal(fs.existsSync(path.join(dir, '.project-manager', 'LEDGER.md')), false);
  });

  it('includes slugless rows', () => {
    const dir = tmpRepo();
    writeRoadmap(dir, roadmap(table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P2', '—', 'src', '—', '—', '—', '—'],
      ['B', 'pending', 'P2', '—', 'src', 'feat-b', '—', '—', '—']
    ])));
    const out = JSON.parse(runCli(dir, ['--evidence']).stdout);
    assert.deepEqual(out.map(e => e.item), ['A', 'B']);
  });

  it('does not suppress the ledger harvest of a prior run, and creates none of its own', () => {
    const dir = tmpRepo();
    writeRoadmap(dir, roadmap(table(EVIDENCE_HEADERS, [
      ['A', 'pending', 'P2', '—', 'src', '—', '—', '—', '—']
    ])));
    const archived = path.join(dir, '.planning', 'archive', 'some-feature');
    fs.mkdirSync(archived, { recursive: true });
    fs.writeFileSync(path.join(archived, 'CONTEXT.md'), '---\nstatus: done\n---\n');

    const r = runCli(dir, ['--evidence']);
    assert.equal(r.status, 0);
    assert.equal(fs.existsSync(path.join(dir, '.project-manager', 'LEDGER.md')), false);
  });
});

describe('--evidence — resilience', () => {
  it('exits 0 and silent when .project-manager/ is absent', () => {
    const dir = tmpRepo();
    const r = runCli(dir, ['--evidence']);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
  });

  it('prints [] when the roadmap holds no parseable backlog table', () => {
    const dir = tmpRepo();
    writeRoadmap(dir, '---\nproject: "Test"\nupdated: "2026-01-01"\n---\n\n## Notes\n\nNo table here.\n');
    const r = runCli(dir, ['--evidence']);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.deepEqual(JSON.parse(r.stdout), []);
  });

  it('prints [] for a table whose header lacks the required columns', () => {
    const dir = tmpRepo();
    writeRoadmap(dir, roadmap(table(['Thing', 'State'], [['A', 'pending']])));
    const r = runCli(dir, ['--evidence']);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.deepEqual(JSON.parse(r.stdout), []);
  });

  it('drops rows whose cell count disagrees with the header and still exits 0', () => {
    const dir = tmpRepo();
    const body =
      '| Item | Status | Priority | Depends on | Ship feature |\n' +
      '| --- | --- | --- | --- | --- |\n' +
      '| A | pending | P2 | — | — |\n' +
      '| B | pending | P2 | — |\n' +
      '| C | pending | P2 | — | — | extra |\n';
    writeRoadmap(dir, roadmap(body));
    const r = runCli(dir, ['--evidence']);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.deepEqual(JSON.parse(r.stdout).map(e => e.item), ['A']);
  });
});
