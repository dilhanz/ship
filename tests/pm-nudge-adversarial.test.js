const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'pm-sync-nudge.cjs');

/**
 * Spawn the hook with a given cwd. stdinData defaults to the standard
 * PostToolUse JSON payload; pass a string to send arbitrary stdin.
 */
function runHook(cwd, stdinData) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    });

    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', () => {});

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

    child.stdin.write(stdinData === undefined ? JSON.stringify({ cwd }) : stdinData);
    child.stdin.end();
  });
}

function createFeature(tmpDir, name, status) {
  const featureDir = path.join(tmpDir, '.planning', 'features', name);
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(
    path.join(featureDir, 'CONTEXT.md'),
    `---\nfeature: "${name}"\nstatus: ${status}\n---\n\n## Problem\n\nTest feature.\n`
  );
}

function createArchivedFeature(tmpDir, name) {
  const archiveDir = path.join(tmpDir, '.planning', 'archive', name);
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(
    path.join(archiveDir, 'CONTEXT.md'),
    `---\nfeature: "${name}"\nstatus: done\n---\n\n## Problem\n\nArchived feature.\n`
  );
}

function roadmapContent(rows, eol = '\n') {
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
    '| Item | Status | Priority | Depends on | Ship feature |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.item} | ${r.status} | ${r.priority || 'P1'} | ${r.depends || '—'} | ${r.slug || '—'} |`
    );
  }
  return lines.join(eol) + eol;
}

function createRoadmap(tmpDir, rows, eol = '\n') {
  const pmDir = path.join(tmpDir, '.project-manager');
  fs.mkdirSync(pmDir, { recursive: true });
  fs.writeFileSync(path.join(pmDir, 'ROADMAP.md'), roadmapContent(rows, eol));
}

describe('pm-sync-nudge hook — adversarial edges', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pm-nudge-adv-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('debounce keys on the drift set: new drift alongside a persisting one re-nudges', async () => {
    createFeature(tmpDir, 'feature-a', 'building');
    createRoadmap(tmpDir, [
      { item: 'A', status: 'pending', slug: 'feature-a' },
      { item: 'B', status: 'pending', slug: 'feature-b' }, // feature-b does not exist yet
    ]);

    const first = await runHook(tmpDir);
    assert.ok(first.output, 'first run should nudge on feature-a drift');

    // feature-b appears while feature-a drift persists → drift set changes
    createFeature(tmpDir, 'feature-b', 'building');

    const second = await runHook(tmpDir);
    assert.ok(second.output, 'changed drift set should re-nudge despite debounce');
    const msg = second.output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('feature-b'), 'new drift should be listed');
    assert.ok(msg.includes('feature-a'), 'persisting drift should still be listed');
  });

  it('drift resolved then the same drift reappears → nudges again (state cleared)', async () => {
    createFeature(tmpDir, 'auth-feature', 'building');
    createRoadmap(tmpDir, [{ item: 'Auth', status: 'pending', slug: 'auth-feature' }]);

    const first = await runHook(tmpDir);
    assert.ok(first.output, 'initial drift should nudge');

    // Resolve: roadmap now matches reality
    createRoadmap(tmpDir, [{ item: 'Auth', status: 'in-progress', slug: 'auth-feature' }]);
    const resolved = await runHook(tmpDir);
    assert.equal(resolved.output, null, 'in-sync run should be silent');

    // Same drift reappears (e.g. user reverts the roadmap edit)
    createRoadmap(tmpDir, [{ item: 'Auth', status: 'pending', slug: 'auth-feature' }]);
    const again = await runHook(tmpDir);
    assert.ok(again.output, 'reappearing drift should nudge again after state clear');
  });

  it('CRLF line endings in ROADMAP.md → drift still detected', async () => {
    createFeature(tmpDir, 'auth-feature', 'building');
    createRoadmap(tmpDir, [{ item: 'Auth', status: 'pending', slug: 'auth-feature' }], '\r\n');

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'CRLF roadmap should still be parsed');
    assert.ok(
      output.hookSpecificOutput.additionalContext.includes('auth-feature'),
      'drifted slug should be reported'
    );
  });

  it('recorded blocked but feature archived → drifts to done (blocked shield only guards in-progress)', async () => {
    createArchivedFeature(tmpDir, 'stuck-feature');
    createRoadmap(tmpDir, [{ item: 'Stuck', status: 'blocked', slug: 'stuck-feature' }]);

    const { output } = await runHook(tmpDir);
    assert.ok(output, 'blocked item whose feature completed should nudge');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('stuck-feature'), 'slug should be reported');
    assert.ok(msg.includes('actually done'), 'should report actual status done');
  });

  it('recorded done but feature still active → drift back to in-progress', async () => {
    createFeature(tmpDir, 'reopened-feature', 'building');
    createRoadmap(tmpDir, [{ item: 'Reopened', status: 'done', slug: 'reopened-feature' }]);

    const { output } = await runHook(tmpDir);
    assert.ok(output, 'done-recorded item with an active feature should nudge');
    assert.ok(
      output.hookSpecificOutput.additionalContext.includes('reopened-feature'),
      'slug should be reported'
    );
  });

  it('malformed .nudge-state.json → treated as no prior drift, still nudges, no crash', async () => {
    createFeature(tmpDir, 'auth-feature', 'building');
    createRoadmap(tmpDir, [{ item: 'Auth', status: 'pending', slug: 'auth-feature' }]);
    fs.writeFileSync(
      path.join(tmpDir, '.project-manager', '.nudge-state.json'),
      '{not json at all'
    );

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'corrupt debounce state should not suppress the nudge');
  });

  it('garbage stdin (non-JSON) → falls back to process cwd and still detects drift', async () => {
    createFeature(tmpDir, 'auth-feature', 'building');
    createRoadmap(tmpDir, [{ item: 'Auth', status: 'pending', slug: 'auth-feature' }]);

    const { code, output } = await runHook(tmpDir, 'not-json-at-all');
    assert.equal(code, 0);
    assert.ok(output, 'hook should fall back to spawn cwd on unparseable stdin');
    assert.ok(
      output.hookSpecificOutput.additionalContext.includes('auth-feature'),
      'drift should still be reported'
    );
  });

  it('row with an extra pipe in the item name is skipped; other rows still processed', async () => {
    createFeature(tmpDir, 'auth-feature', 'building');
    const pmDir = path.join(tmpDir, '.project-manager');
    fs.mkdirSync(pmDir, { recursive: true });
    const content = [
      '## Milestones',
      '',
      '### M1 — Test (status: active)',
      '',
      'Goal: pipes',
      '',
      '| Item | Status | Priority | Depends on | Ship feature |',
      '| --- | --- | --- | --- | --- |',
      '| Bad | item | pending | P1 | — | other-feature |', // 6 cells → skipped
      '| Auth | pending | P1 | — | auth-feature |',
    ].join('\n');
    fs.writeFileSync(path.join(pmDir, 'ROADMAP.md'), content);

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'well-formed rows should still be evaluated');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('auth-feature'), 'valid row drift should be reported');
    assert.ok(!msg.includes('other-feature'), 'malformed row must not be reported');
  });
});
