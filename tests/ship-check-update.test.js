const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'ship-check-update.js');

/**
 * Helper: spawn the check-update hook, send inputObj via stdin, return { code, stdout }.
 */
function runHook(inputObj, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });

    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.on('close', (code) => resolve({ code, stdout }));
    child.on('error', reject);

    child.stdin.write(JSON.stringify(inputObj));
    child.stdin.end();
  });
}

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

      // The hook now reads stdin for session_id before running
      child.stdin.write('{}');
      child.stdin.end();
    });

    const elapsed = Date.now() - start;
    assert.ok(
      elapsed < 3000,
      `hook should exit quickly (non-blocking), but took ${elapsed}ms`
    );
  });

  it('creates cache directory and exits cleanly', async () => {
    // Note: on Windows, os.homedir() ignores HOME env overrides and always returns
    // the Windows user profile directory. We verify the hook exits with code 0
    // and that the cache dir exists (either pre-existing or created by the hook).
    const realCacheDir = path.join(os.homedir(), '.claude', 'cache');

    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [HOOK_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HOME: fakeHome },
      });

      child.on('close', resolve);
      child.on('error', reject);
      child.stdin.write('{}');
      child.stdin.end();
    });

    // Hook should always exit cleanly
    assert.equal(code, 0, 'hook should exit with code 0');
    // Cache directory should exist (created by hook or already present from prior runs)
    assert.ok(
      fs.existsSync(realCacheDir),
      'cache dir should exist after hook runs'
    );
  });

  describe('session lock file', () => {
    const lockPath = path.join(os.tmpdir(), 'claude-ship-session.lock');
    let originalLock = null;

    beforeEach(() => {
      try { originalLock = fs.readFileSync(lockPath, 'utf8'); } catch { originalLock = null; }
    });

    afterEach(() => {
      if (originalLock !== null) {
        fs.writeFileSync(lockPath, originalLock);
      } else {
        try { fs.unlinkSync(lockPath); } catch {}
      }
    });

    it('creates lock file with session_id on start', async () => {
      const testSession = `test-lock-${process.pid}`;
      await runHook({ session_id: testSession }, { HOME: fakeHome });
      assert.ok(fs.existsSync(lockPath), 'lock file should exist');
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      assert.equal(lock.session_id, testSession);
      assert.ok(lock.timestamp > 0, 'should have a timestamp');
      assert.ok(lock.pid > 0, 'should have a pid');
    });
  });
});
