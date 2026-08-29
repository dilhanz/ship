const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'pm-sync-nudge.cjs');

/**
 * Helper: spawn the hook as a child process with a given cwd,
 * pipe minimal JSON via stdin, capture stdout, return parsed output (or null).
 */
function runHook(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));

    child.on('close', (code) => {
      if (stdout.trim()) {
        try {
          resolve({ code, output: JSON.parse(stdout), raw: stdout });
        } catch (e) {
          resolve({ code, output: null, raw: stdout });
        }
      } else {
        resolve({ code, output: null, raw: stdout });
      }
    });

    child.on('error', reject);

    child.stdin.write(JSON.stringify({ cwd }));
    child.stdin.end();
  });
}

/**
 * Create a feature directory under tmpDir/.planning/features/{name}/
 * with a CONTEXT.md carrying the given status.
 */
function createFeature(tmpDir, name, status) {
  const featureDir = path.join(tmpDir, '.planning', 'features', name);
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(
    path.join(featureDir, 'CONTEXT.md'),
    `---\nfeature: "${name}"\nstatus: ${status}\n---\n\n## Problem\n\nTest feature.\n`
  );
}

/**
 * Create an archived feature at tmpDir/.planning/archive/{name}/
 * with a done CONTEXT.md.
 */
function createArchivedFeature(tmpDir, name) {
  const archiveDir = path.join(tmpDir, '.planning', 'archive', name);
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(
    path.join(archiveDir, 'CONTEXT.md'),
    `---\nfeature: "${name}"\nstatus: done\n---\n\n## Problem\n\nArchived feature.\n`
  );
}

/**
 * Write .project-manager/ROADMAP.md with a milestone heading and a backlog
 * table built from rows: array of { item, status, priority, size, depends, source, slug, lane }.
 *
 * shape: 'v7' (default) emits the enriched header with Size and Source;
 *        'v5' emits the legacy v5.3.0 header, which must keep parsing;
 *        'v8' appends the Lane column, which must also keep parsing.
 */
function createRoadmap(tmpDir, rows, shape = 'v7') {
  const pmDir = path.join(tmpDir, '.project-manager');
  fs.mkdirSync(pmDir, { recursive: true });

  const lines = [
    '---',
    'project: "Test Project"',
    'updated: "2026-08-10"',
    '---',
    '',
    '## Milestones',
    '',
    '### M1 — Test milestone (status: active)',
    '',
    'Goal: exercise the nudge hook',
    '',
  ];
  if (shape === 'v5') {
    lines.push('| Item | Status | Priority | Depends on | Ship feature |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const r of rows) {
      lines.push(
        `| ${r.item} | ${r.status} | ${r.priority || 'P1'} | ${r.depends || '—'} | ${r.slug || '—'} |`
      );
    }
  } else if (shape === 'v8') {
    lines.push('| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) {
      lines.push(
        `| ${r.item} | ${r.status} | ${r.priority || 'P1'} | ${r.size || '—'} | ${r.depends || '—'} | ${r.source || 'test fixture'} | ${r.slug || '—'} | ${r.lane || '—'} |`
      );
    }
  } else {
    lines.push('| Item | Status | Priority | Size | Depends on | Source | Ship feature |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) {
      lines.push(
        `| ${r.item} | ${r.status} | ${r.priority || 'P1'} | ${r.size || '—'} | ${r.depends || '—'} | ${r.source || 'test fixture'} | ${r.slug || '—'} |`
      );
    }
  }
  fs.writeFileSync(path.join(pmDir, 'ROADMAP.md'), lines.join('\n') + '\n');
}

describe('pm-sync-nudge hook', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pm-nudge-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('no .project-manager/ directory → exit 0, no output', async () => {
    createFeature(tmpDir, 'some-feature', 'building');

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.equal(output, null, 'should produce no output without a roadmap');
  });

  it('roadmap in sync with reality → no output', async () => {
    createFeature(tmpDir, 'auth-feature', 'building');
    createRoadmap(tmpDir, [
      { item: 'Auth', status: 'in-progress', slug: 'auth-feature' },
    ]);

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.equal(output, null, 'should produce no output when in sync');
  });

  it('recorded pending but feature is building → nudge names pm-update.cjs with the slug', async () => {
    createFeature(tmpDir, 'auth-feature', 'building');
    createRoadmap(tmpDir, [
      { item: 'Auth', status: 'pending', slug: 'auth-feature' },
    ]);

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'should produce output on drift');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('auth-feature'), 'should include the drifted slug');
    assert.ok(msg.includes('pm-update.cjs'), 'should recommend the updater script');
    assert.match(msg, /pm-update\.cjs" auth-feature/, 'should pass the drifted slug to the script');
    assert.ok(msg.includes('/ship:pm-sync'), 'should reserve /ship:pm-sync for structural drift');
  });

  it('recorded in-progress but feature archived → flagged as actually done', async () => {
    createArchivedFeature(tmpDir, 'shipped-feature');
    createRoadmap(tmpDir, [
      { item: 'Shipped', status: 'in-progress', slug: 'shipped-feature' },
    ]);

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'should produce output on drift');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('shipped-feature'), 'should include the drifted slug');
    assert.ok(msg.includes('done'), 'should flag the item as actually done');
  });

  it('debounce: same drift nudges once and persists .nudge-state.json', async () => {
    createFeature(tmpDir, 'auth-feature', 'building');
    createRoadmap(tmpDir, [
      { item: 'Auth', status: 'pending', slug: 'auth-feature' },
    ]);

    const first = await runHook(tmpDir);
    assert.equal(first.code, 0);
    assert.ok(first.output, 'first run should emit a nudge');

    const statePath = path.join(tmpDir, '.project-manager', '.nudge-state.json');
    assert.ok(fs.existsSync(statePath), '.nudge-state.json should exist after first run');

    const second = await runHook(tmpDir);
    assert.equal(second.code, 0);
    assert.equal(second.output, null, 'second run on same drift should be silent');
  });

  it('recorded blocked with active feature → no output', async () => {
    createFeature(tmpDir, 'stuck-feature', 'building');
    createRoadmap(tmpDir, [
      { item: 'Stuck', status: 'blocked', slug: 'stuck-feature' },
    ]);

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.equal(output, null, 'blocked is a PM judgment, never drift');
  });

  it('slug that exists nowhere → no output', async () => {
    createRoadmap(tmpDir, [
      { item: 'Ghost', status: 'pending', slug: 'ghost-feature' },
    ]);

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.equal(output, null, 'unknown slugs are never flagged');
  });

  it('malformed ROADMAP.md → exit 0, no output, no crash', async () => {
    const pmDir = path.join(tmpDir, '.project-manager');
    fs.mkdirSync(pmDir, { recursive: true });
    fs.writeFileSync(
      path.join(pmDir, 'ROADMAP.md'),
      'garbage content\nno table here\n||| broken ||\n'
    );
    createFeature(tmpDir, 'auth-feature', 'building');

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.equal(output, null, 'should produce no output on malformed roadmap');
  });
});

describe('pm-sync-nudge hook — legacy 5-column roadmap', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pm-nudge-v5-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('recorded pending but feature is building → nudge names pm-update.cjs with the slug', async () => {
    createFeature(tmpDir, 'auth-feature', 'building');
    createRoadmap(tmpDir, [{ item: 'Auth', status: 'pending', slug: 'auth-feature' }], 'v5');

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'legacy table should still produce output on drift');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('auth-feature'), 'should include the drifted slug');
    assert.match(msg, /pm-update\.cjs" auth-feature/, 'should pass the drifted slug to the script');
    assert.ok(msg.includes('/ship:pm-sync'), 'should reserve /ship:pm-sync for structural drift');
  });

  it('recorded in-progress but feature archived → flagged as actually done', async () => {
    createArchivedFeature(tmpDir, 'shipped-feature');
    createRoadmap(tmpDir, [{ item: 'Shipped', status: 'in-progress', slug: 'shipped-feature' }], 'v5');

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'legacy table should still produce output on drift');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('shipped-feature'), 'should include the drifted slug');
    assert.ok(msg.includes('done'), 'should flag the item as actually done');
  });

  it('recorded blocked with active feature → no output', async () => {
    createFeature(tmpDir, 'stuck-feature', 'building');
    createRoadmap(tmpDir, [{ item: 'Stuck', status: 'blocked', slug: 'stuck-feature' }], 'v5');

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.equal(output, null, 'blocked is a PM judgment, never drift');
  });
});

describe('pm-sync-nudge hook — v8 Lane-bearing roadmap', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pm-nudge-v8-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('drift still detected with a populated Lane column, nudge names the slug', async () => {
    createFeature(tmpDir, 'auth-feature', 'building');
    createRoadmap(
      tmpDir,
      [{ item: 'Auth', status: 'pending', slug: 'auth-feature', lane: 'feature/auth @ C:/lanes/auth' }],
      'v8'
    );

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'Lane-bearing table should still produce output on drift');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('auth-feature'), 'should include the drifted slug');
    assert.match(msg, /pm-update\.cjs" auth-feature/, 'should pass the drifted slug to the script');
  });
});

describe('pm-sync-nudge hook — awaiting-merge is agreement, not drift', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pm-nudge-awaiting-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('recorded awaiting-merge against an archived feature → no nudge at all', async () => {
    createArchivedFeature(tmpDir, 'shipped-feature');
    createRoadmap(tmpDir, [
      { item: 'Shipped', status: 'awaiting-merge', slug: 'shipped-feature' },
    ]);

    const { code, output, raw } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.equal(raw.trim(), '', 'nudging here would recommend the script that wrote the value');
    assert.equal(output, null);

    // No drift was recorded either — the debounce file is only written when
    // there is drift to remember (or stale drift to clear).
    const statePath = path.join(tmpDir, '.project-manager', '.nudge-state.json');
    if (fs.existsSync(statePath)) {
      assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).lastDrift || '', '');
    }
  });

  it('matches the status case-insensitively', async () => {
    createArchivedFeature(tmpDir, 'shipped-feature');
    createRoadmap(tmpDir, [
      { item: 'Shipped', status: 'Awaiting-Merge', slug: 'shipped-feature' },
    ]);

    const { code, raw } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.equal(raw.trim(), '');
  });

  it('the exemption is narrow — pending and in-progress against that same archive still nudge', async () => {
    for (const recorded of ['pending', 'in-progress']) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pm-nudge-narrow-'));
      try {
        createArchivedFeature(dir, 'shipped-feature');
        createRoadmap(dir, [{ item: 'Shipped', status: recorded, slug: 'shipped-feature' }]);

        const { code, output } = await runHook(dir);
        assert.equal(code, 0);
        assert.ok(output, `recorded ${recorded} against an archive is still drift`);
        assert.ok(output.hookSpecificOutput.additionalContext.includes('shipped-feature'));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('recorded awaiting-merge on an active, unarchived feature → no nudge either', async () => {
    createFeature(tmpDir, 'auth-feature', 'building');
    createRoadmap(tmpDir, [
      { item: 'Auth', status: 'awaiting-merge', slug: 'auth-feature' },
    ]);

    const { code, raw } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.equal(raw.trim(), '', 'awaiting-merge is not in the in-progress branch trigger set');
  });

  it('a mixed table nudges about the genuinely drifted slug only', async () => {
    createArchivedFeature(tmpDir, 'shipped-feature');
    createArchivedFeature(tmpDir, 'stale-feature');
    createRoadmap(tmpDir, [
      { item: 'Shipped', status: 'awaiting-merge', slug: 'shipped-feature' },
      { item: 'Stale', status: 'pending', slug: 'stale-feature' },
    ]);

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'the real drift still nudges');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('stale-feature'), 'names the drifted slug');
    assert.ok(!msg.includes('shipped-feature'), 'says nothing about the exempted row');
    assert.match(msg, /pm-update\.cjs" stale-feature\b/, 'passes only the drifted slug to the script');
  });
});
