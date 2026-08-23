const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scanFeatures } = require(path.join(__dirname, '..', 'hooks', 'scan-features.cjs'));

/**
 * Build a throwaway .planning/features/ tree and run scanFeatures over it.
 * `features` is a map of slug → CONTEXT.md content (verbatim, so a fixture can
 * omit frontmatter or write a status in mixed case).
 */
function withFeatures(features, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-scan-features-'));
  try {
    for (const [name, content] of Object.entries(features)) {
      const dir = path.join(root, '.planning', 'features', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'CONTEXT.md'), content);
    }
    fn(scanFeatures(root), root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const context = (body) => `---\n${body}\n---\n\n## Problem\n\nSomething.\n`;
const byName = (snapshots) => new Map(snapshots.map(s => [s.name, s]));

describe('scan-features: terminal status filter', () => {
  it('excludes every tombstone in the fixed set', () => {
    withFeatures({
      'a-done': context('feature: "a-done"\nstatus: done'),
      'b-superseded': context('feature: "b-superseded"\nstatus: superseded'),
      'c-abandoned': context('feature: "c-abandoned"\nstatus: abandoned'),
      'd-cancelled': context('feature: "d-cancelled"\nstatus: cancelled'),
    }, (snapshots) => {
      assert.deepEqual(snapshots, [], 'all four tombstones are terminal');
    });
  });

  it('tombstone matching is case-insensitive', () => {
    withFeatures({
      'shouty': context('feature: "shouty"\nstatus: Superseded'),
      'louder': context('feature: "louder"\nstatus:   DONE  '),
    }, (snapshots) => {
      assert.deepEqual(snapshots, [], 'field-written frontmatter is not guaranteed lowercase');
    });
  });

  it('includes an in-flight feature', () => {
    withFeatures({
      'live-one': context('feature: "live-one"\nstatus: building'),
    }, (snapshots) => {
      assert.equal(snapshots.length, 1);
      assert.equal(snapshots[0].name, 'live-one');
      assert.equal(snapshots[0].status, 'building');
    });
  });

  it('includes a feature with no status: line, as unknown', () => {
    withFeatures({
      'statusless': context('feature: "statusless"'),
    }, (snapshots) => {
      assert.equal(snapshots.length, 1);
      assert.equal(snapshots[0].status, 'unknown', 'absent status is not terminal');
    });
  });

  it('includes an unrecognised status rather than silently dropping it', () => {
    withFeatures({
      'typo-lane': context('feature: "typo-lane"\nstatus: frobnicated'),
    }, (snapshots) => {
      assert.equal(snapshots.length, 1);
      assert.equal(snapshots[0].status, 'frobnicated', 'the set is additive, not an allowlist');
    });
  });

  it('records the status verbatim — normalization is for the filter only', () => {
    withFeatures({
      'mixed': context('feature: "mixed"\nstatus: Building'),
    }, (snapshots) => {
      assert.equal(snapshots[0].status, 'Building');
    });
  });
});

describe('scan-features: lane stamp', () => {
  it('parses lane: from the frontmatter block', () => {
    withFeatures({
      'stamped': context('feature: "stamped"\nstatus: building\nlane: feature/stamped @ /repos/lanes/stamped'),
    }, (snapshots) => {
      assert.equal(snapshots[0].lane, 'feature/stamped @ /repos/lanes/stamped');
    });
  });

  it('strips one layer of surrounding quotes', () => {
    withFeatures({
      'quoted': context('feature: "quoted"\nstatus: building\nlane: "main @ /repos/main"'),
    }, (snapshots) => {
      assert.equal(snapshots[0].lane, 'main @ /repos/main');
    });
  });

  it('lane is null when the key is absent', () => {
    withFeatures({
      'bare': context('feature: "bare"\nstatus: building'),
    }, (snapshots) => {
      assert.equal(snapshots[0].lane, null);
      assert.ok('lane' in snapshots[0], 'the key is always set, so consumers need no presence check');
    });
  });

  it('lane is null when the value is empty', () => {
    withFeatures({
      'empty': context('feature: "empty"\nstatus: building\nlane:   '),
    }, (snapshots) => {
      assert.equal(snapshots[0].lane, null);
    });
  });

  it('ignores a lane: that appears only in the body prose', () => {
    const content = [
      '---',
      'feature: "prose"',
      'status: building',
      '---',
      '',
      '## Solution',
      '',
      'A stamp of the form',
      'lane: {branch} @ {worktree-path}',
      'is written into the frontmatter.',
      '',
    ].join('\n');
    withFeatures({ prose: content }, (snapshots) => {
      assert.equal(snapshots[0].lane, null, 'documentation is not testimony');
    });
  });

  it('lane is null when the file has no frontmatter block at all', () => {
    withFeatures({
      'nofm': '# No frontmatter here\n\nlane: main @ /repos/main\n',
    }, (snapshots) => {
      assert.equal(snapshots.length, 1, 'a status-less file is still in flight');
      assert.equal(snapshots[0].lane, null);
    });
  });

  it('is CRLF-tolerant', () => {
    withFeatures({
      'crlf': '---\r\nfeature: "crlf"\r\nstatus: building\r\nlane: main @ /repos/main\r\n---\r\n\r\nBody.\r\n',
    }, (snapshots) => {
      assert.equal(snapshots[0].lane, 'main @ /repos/main');
    });
  });
});

describe('scan-features: mixed fleet', () => {
  it('reports only the non-terminal features', () => {
    withFeatures({
      'alpha': context('status: building\nlane: feature/alpha @ /repos/lanes/alpha'),
      'beta': context('status: superseded'),
      'gamma': context('status: planned'),
      'delta': context('status: done'),
    }, (snapshots) => {
      const names = snapshots.map(s => s.name).sort();
      assert.deepEqual(names, ['alpha', 'gamma']);
      assert.equal(byName(snapshots).get('alpha').lane, 'feature/alpha @ /repos/lanes/alpha');
      assert.equal(byName(snapshots).get('gamma').lane, null);
    });
  });
});
