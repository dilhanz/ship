/**
 * Adversarial coverage for the pm-blind-spots fix round — the four surfaces the
 * fixes themselves introduced, each of which can only fail in a way the
 * per-function suites structurally cannot see.
 *
 * 1. `cachedBaseRef` memoises the base ref for the life of the process. The
 *    optimisation is only safe if the cache is keyed per working tree: a
 *    single process that reconciles two repos with different base branches
 *    must not answer the second one from the first one's entry.
 * 2. `applyLaneColumn` sanitises the derived label. The property that matters
 *    is not "a pipe becomes a slash" but that `parseRoadmap` still returns the
 *    same number of rows afterwards, for *every* label — an unsanitised cell
 *    deletes the row rather than mangling it, and the writer can never see it
 *    again to repair it.
 * 3. `reharvestLedger` rewrites only the cells the relaxation exists to repair
 *    (`Verify`, `Verify note`, `Outcome`). Every other recorded cell — above
 *    all `Shipped` — is history, and history must survive a re-read that
 *    learns nothing.
 * 4. `parseHandoff` and `handoffFailureReason` are two functions answering the
 *    same question. They must never disagree: a handoff that parses must have
 *    no failure reason, and one that does not parse must have one.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const SWEEP_PATH = path.join(__dirname, '..', 'ship', 'lane-sweep.cjs');
const { parseRoadmap, applyLaneColumn, archiveMergeStatus, runHarvest } = require(SCRIPT_PATH);
const { parseHandoff, handoffFailureReason } = require(SWEEP_PATH);

const gitAvailable = (() => {
  try {
    return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
  } catch (e) {
    return false;
  }
})();

const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function initRepo(branch) {
  const dir = tmp('pmbsf-');
  const run = args => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  run(['init', '-q', '-b', branch, '.']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, 'file.txt'), 'one\n');
  run(['add', 'file.txt']);
  run(['commit', '-qm', 'one']);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  return { dir, head, run };
}

function stampArchive(dir, slug, head) {
  const p = path.join(dir, '.planning', 'archive', slug);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'VERIFY.md'), head === null ? '# no stamp\n' : `**Head:** ${head}\n`);
  return p;
}

describe('pm-blind-spots fix round — the base ref cache is per working tree', () => {
  it('answers each repo from its own base, interleaved, and never from a neighbour\'s entry', { skip: !gitAvailable }, () => {
    const onMain = initRepo('main');
    const onMaster = initRepo('master');
    const notARepo = tmp('pmbsf-bare-');

    // A side branch in each repo, so "ancestor of the base" is genuinely false
    // there while remaining true for the base commit itself.
    for (const repo of [onMain, onMaster]) {
      repo.run(['checkout', '-q', '-b', 'side']);
      fs.writeFileSync(path.join(repo.dir, 'side.txt'), 'two\n');
      repo.run(['add', 'side.txt']);
      repo.run(['commit', '-qm', 'two']);
      repo.side = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
    }

    stampArchive(onMain.dir, 'merged', onMain.head);
    stampArchive(onMain.dir, 'unmerged', onMain.side);
    stampArchive(onMaster.dir, 'merged', onMaster.head);
    stampArchive(onMaster.dir, 'unmerged', onMaster.side);
    stampArchive(notARepo, 'merged', onMain.head);

    // Interleaved deliberately: a cache keyed on anything but cwd would leak
    // the first repo's base into the second call and mask the difference.
    const order = [
      [onMain.dir, 'merged', 'done'],
      [onMaster.dir, 'merged', 'done'],
      [notARepo, 'merged', 'inconclusive'],
      [onMaster.dir, 'unmerged', 'awaiting-merge'],
      [onMain.dir, 'unmerged', 'awaiting-merge'],
      [notARepo, 'merged', 'inconclusive'],
      [onMain.dir, 'merged', 'done'],
      [onMaster.dir, 'unmerged', 'awaiting-merge']
    ];
    for (const [dir, slug, expected] of order) {
      assert.equal(archiveMergeStatus(dir, slug), expected, `${dir} / ${slug}`);
    }
  });

  it('resolves the base ref a constant number of times regardless of row count', { skip: !gitAvailable }, () => {
    // The property behind the memoisation is not elapsed time but that
    // `git rev-parse` calls do not grow with the number of archived rows.
    // A PATH shim counts them; `merge-base` is inherently once per row.
    const shimDir = tmp('pmbsf-shim-');
    const gitPath = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(shimDir, 'git'), `#!/bin/sh\necho "$@" >> "$GIT_CALL_LOG"\nexec ${gitPath} "$@"\n`);
    fs.chmodSync(path.join(shimDir, 'git'), 0o755);

    const counts = [3, 25].map(n => {
      const repo = initRepo('main');
      const slugs = [];
      const rows = [];
      for (let i = 0; i < n; i++) {
        const slug = `arch-${i}`;
        slugs.push(slug);
        stampArchive(repo.dir, slug, repo.head);
        rows.push(`| I${i} | P0 | todo | ${slug} | s |`);
      }
      const roadmap = '## Backlog\n\n| Item | Priority | Status | Ship feature | Source |\n|---|---|---|---|---|\n' + rows.join('\n') + '\n';

      const log = path.join(shimDir, `log-${n}`);
      fs.writeFileSync(log, '');
      // A child process, so the module-level cache starts empty for each run.
      const script = `
        process.env.GIT_CALL_LOG = ${JSON.stringify(log)};
        process.env.PATH = ${JSON.stringify(shimDir)} + ':' + process.env.PATH;
        const pm = require(${JSON.stringify(SCRIPT_PATH)});
        const r = pm.applyStatusUpdates(${JSON.stringify(roadmap)}, ${JSON.stringify(repo.dir)}, ${JSON.stringify(slugs)});
        console.log(pm.parseRoadmap(r.content).filter(x => x.cells.Status === 'done').length);
      `;
      const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }).trim();
      assert.equal(Number(out), n, 'every stamped, merged archive should reconcile to done');
      const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
      return calls.filter(c => c.startsWith('rev-parse')).length;
    });

    assert.equal(counts[0], counts[1], `rev-parse count grew with row count: ${counts.join(' vs ')}`);
  });
});

describe('pm-blind-spots fix round — the derived Lane cell can never delete a row', () => {
  const roadmap = '## Backlog\n\n' +
    '| Item | Priority | Status | Lane | Ship feature | Source |\n' +
    '|---|---|---|---|---|---|\n' +
    '| A | P0 | todo | — | slug-a | s |\n' +
    '| B | P0 | todo | — | slug-b | s |\n';

  const labels = [
    'feat|pipe @ /repo|x',
    'br\nnewline @ /p',
    'br\r\ncrlf @ /p',
    '| | | | | | |',
    'ünïcode @ /påth',
    'tab\there @ /p',
    '',
    '—',
    'x'.repeat(400),
    '|',
    '||||'
  ];

  it('preserves the parsed row count and the line count for every hostile lane label', () => {
    const baseline = parseRoadmap(roadmap).length;
    const baselineLines = roadmap.split('\n').length;
    for (const label of labels) {
      const result = applyLaneColumn(roadmap, new Map([['slug-a', label]]));
      const rows = parseRoadmap(result.content);
      assert.equal(rows.length, baseline, `row destroyed by label ${JSON.stringify(label)}`);
      assert.equal(result.content.split('\n').length, baselineLines, `line count changed for ${JSON.stringify(label)}`);
      assert.ok(!rows[0].cells.Lane.includes('|'), `pipe survived into the cell for ${JSON.stringify(label)}`);
    }
  });

  it('is idempotent — writing the same sanitised label twice changes nothing the second time', () => {
    for (const label of labels) {
      const once = applyLaneColumn(roadmap, new Map([['slug-a', label]]));
      const twice = applyLaneColumn(once.content, new Map([['slug-a', label]]));
      assert.equal(twice.content, once.content, `not idempotent for ${JSON.stringify(label)}`);
      assert.equal(twice.changed, false, `second pass reported a change for ${JSON.stringify(label)}`);
    }
  });
});

describe('pm-blind-spots fix round — a re-harvest that learns nothing rewrites nothing', () => {
  const HEADERS = ['Feature', 'Shipped', 'Profile', 'Outcome', 'Verify', 'Verify note', 'Unresolved carried', 'Plan rounds', 'Fix rounds', 'Findings (C/H/M/L)', 'Phases', 'Artifacts'];

  function ledgerFixture(rows) {
    return `---\nupdated: "2026-01-01"\n---\n\n# Ledger\n\nnote\n\n| ${HEADERS.join(' | ')} |\n|${HEADERS.map(() => '---').join('|')}|\n${rows.join('\n')}\n`;
  }

  it('preserves every recorded cell but Verify / Verify note / Outcome, across three different run dates', () => {
    const root = tmp('pmbsf-rh-');
    fs.mkdirSync(path.join(root, '.project-manager'), { recursive: true });
    // Deliberately unreadable: the re-harvest re-admits the row and still
    // learns nothing, which is the exact case that used to relabel Shipped.
    stampArchive(root, 'stuck', null);
    fs.writeFileSync(path.join(root, '.planning', 'archive', 'stuck', 'VERIFY.md'), '# nothing recognisable\n');
    const recorded = '| stuck | 2026-01-01 | thorough | shipped | unknown | none | 3 | 2 | 1 | 1/2/3/4 | 5 | CONTEXT.md; PLAN.md; REVIEW.md; VERIFY.md |';
    const ledger = path.join(root, '.project-manager', 'LEDGER.md');
    fs.writeFileSync(ledger, ledgerFixture([recorded]));

    runHarvest(root, root, [], '2026-06-06');
    const first = fs.readFileSync(ledger, 'utf8');
    runHarvest(root, root, [], '2026-07-07');
    const second = fs.readFileSync(ledger, 'utf8');
    runHarvest(root, root, [], '2027-01-01');
    const third = fs.readFileSync(ledger, 'utf8');

    const row = second.split('\n').find(l => l.startsWith('| stuck '));
    const cells = row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const by = name => cells[HEADERS.indexOf(name)];

    assert.equal(by('Shipped'), '2026-01-01', 'a recorded ship date was relabelled to the run date');
    assert.equal(by('Profile'), 'thorough');
    assert.equal(by('Unresolved carried'), '3');
    assert.equal(by('Plan rounds'), '2');
    assert.equal(by('Fix rounds'), '1');
    assert.equal(by('Findings (C/H/M/L)'), '1/2/3/4');
    assert.equal(by('Phases'), '5');
    assert.equal(by('Artifacts'), 'CONTEXT.md; PLAN.md; REVIEW.md; VERIFY.md');
    assert.equal(cells.length, HEADERS.length, 'the rewritten row lost or gained a cell');

    assert.equal(first, second, 'not idempotent across two run dates');
    assert.equal(second, third, 'not idempotent across three run dates');
  });

  it('never re-admits a recorded row whose Verify is already a real verdict, even when the artifact now says otherwise', () => {
    const root = tmp('pmbsf-rh2-');
    fs.mkdirSync(path.join(root, '.project-manager'), { recursive: true });
    stampArchive(root, 'settled', null);
    fs.writeFileSync(path.join(root, '.planning', 'archive', 'settled', 'VERIFY.md'), '**Overall Status:** FAIL\n');
    const recorded = '| settled | 2026-01-01 | quick | shipped | PASS | none | 0 | 1 | 0 | 0/0/0/0 | 1 | a; b; c; d |';
    const ledger = path.join(root, '.project-manager', 'LEDGER.md');
    fs.writeFileSync(ledger, ledgerFixture([recorded]));
    const before = fs.readFileSync(ledger, 'utf8');

    runHarvest(root, root, [], '2026-09-09');

    const after = fs.readFileSync(ledger, 'utf8');
    assert.ok(after.includes(recorded), 'a settled row was rewritten — append-only is relaxed only for unknown / in-progress');
    assert.equal(after, before, 'the ledger changed for a row nothing was allowed to touch');
  });
});

describe('pm-blind-spots fix round — parseHandoff and handoffFailureReason never disagree', () => {
  const fixtures = [
    '',
    'no frontmatter at all\n',
    '---\n---\n',
    '---\nfeature:\n---\n',
    '---\nfeature:\napplied: no\n---\n',
    '---\nfeature: \t\napplied: no\n---\n',
    '---\nlane: main\napplied: no\n---\n',
    '---\nFEATURE: x\n---\n',
    '---\n feature: x\n---\n',
    '---\nfeature: x',
    '---\nfeature: x\n---\n',
    '---\nfeature: "x"\napplied: yes\n---\n',
    '---\nfeature: "x"\napplied:\n---\n',
    '---\r\nfeature: x\r\n---\r\n'
  ];

  it('a handoff parses if and only if it has no failure reason', () => {
    for (const content of fixtures) {
      const parsed = parseHandoff(content);
      const reason = handoffFailureReason(content);
      assert.equal(
        parsed === null,
        reason !== null,
        `disagreement for ${JSON.stringify(content)}: parsed=${JSON.stringify(parsed)} reason=${JSON.stringify(reason)}`
      );
      if (reason !== null) assert.equal(typeof reason, 'string');
    }
  });

  it('no frontmatter field value can absorb the following line', () => {
    // `\s*` in the field regex used to match a newline, so an empty value
    // swallowed the next key and the sweep reported an invented feature name
    // as a well-formed handoff.
    const parsed = parseHandoff('---\nfeature:\napplied: no\nraised: "2026-01-01"\n---\n');
    assert.equal(parsed, null, 'an empty feature: value absorbed the next line');

    const emptyApplied = parseHandoff('---\nfeature: real-slug\napplied:\nraised: "2026-01-01"\n---\n');
    assert.notEqual(emptyApplied, null, 'a valid feature with an empty applied: should still parse');
    assert.notEqual(emptyApplied.applied, 'raised: "2026-01-01"', 'applied: absorbed the following line');
    assert.equal(emptyApplied.feature, 'real-slug');
  });
});
