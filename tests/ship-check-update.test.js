const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'ship-check-update.js');

describe('ship-check-update hook', () => {
  // We use a fake HOME so the hook creates its cache dir in a temp location
  // instead of touching the real ~/.claude/cache.
  let fakeHome;

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-check-update-test-'));
  });

  afterEach(() => {
    // Cleanup temp directory
    try {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it('does not block -- parent process exits quickly (< 3s)', async () => {
    const start = Date.now();

    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [HOOK_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HOME: fakeHome },
      });

      child.on('close', (code) => {
        resolve(code);
      });
      child.on('error', reject);

      // The hook reads nothing from stdin for check-update;
      // it just spawns a background process and exits.
      child.stdin.end();
    });

    const elapsed = Date.now() - start;
    assert.ok(
      elapsed < 3000,
      `hook should exit quickly (non-blocking), but took ${elapsed}ms`
    );
  });

  it('creates cache directory if it does not exist', async () => {
    const cacheDir = path.join(fakeHome, '.claude', 'cache');
    assert.ok(!fs.existsSync(cacheDir), 'cache dir should not exist before hook runs');

    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [HOOK_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HOME: fakeHome },
      });

      child.on('close', resolve);
      child.on('error', reject);
      child.stdin.end();
    });

    assert.ok(
      fs.existsSync(cacheDir),
      'cache dir should be created by the hook'
    );
  });
});
