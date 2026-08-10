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
 * table built from rows: array of { item, status, priority, depends, slug }.
 */
function createRoadmap(tmpDir, rows) {
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
    '| Item | Status | Priority | Depends on | Ship feature |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.item} | ${r.status} | ${r.priority || 'P1'} | ${r.depends || '—'} | ${r.slug || '—'} |`
    );
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

  it('recorded pending but feature is building → nudge with slug and /ship:pm-sync', async () => {
    createFeature(tmpDir, 'auth-feature', 'building');
    createRoadmap(tmpDir, [
      { item: 'Auth', status: 'pending', slug: 'auth-feature' },
    ]);

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'should produce output on drift');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('auth-feature'), 'should include the drifted slug');
    assert.ok(msg.includes('/ship:pm-sync'), 'should recommend /ship:pm-sync');
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
