const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'ship-context-monitor.js');

/**
 * Helper: spawn the hook as a child process, pipe JSON via stdin,
 * capture stdout, and return parsed output (or null if empty).
 */
function runHook(inputObj) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
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

    child.stdin.write(JSON.stringify(inputObj));
    child.stdin.end();
  });
}

/**
 * Write a bridge metrics file that the context monitor reads.
 */
function writeMetrics(sessionId, { remaining_percentage, used_pct, timestamp }) {
  const metricsPath = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
  fs.writeFileSync(
    metricsPath,
    JSON.stringify({
      session_id: sessionId,
      remaining_percentage,
      used_pct,
      timestamp: timestamp ?? Math.floor(Date.now() / 1000),
    })
  );
  return metricsPath;
}

/**
 * Remove bridge and warn files for a given session.
 */
function cleanup(sessionId) {
  const tmpDir = os.tmpdir();
  for (const f of [
    `claude-ctx-${sessionId}.json`,
    `claude-ctx-${sessionId}-warned.json`,
  ]) {
    try {
      fs.unlinkSync(path.join(tmpDir, f));
    } catch {
      // already gone
    }
  }
}

// Use a unique session prefix for tests to avoid collisions
const SESSION = `test-ctx-monitor-${process.pid}`;

// Lock file path (may exist from another session -- save/restore around tests)
const LOCK_PATH = path.join(os.tmpdir(), 'claude-ship-session.lock');

describe('ship-context-monitor hook', () => {
  let savedLock = null;

  beforeEach(() => {
    // Save any existing lock file so our tests don't interfere with real sessions
    try { savedLock = fs.readFileSync(LOCK_PATH, 'utf8'); } catch { savedLock = null; }
    // Write a lock claiming our test session so context-monitor sees "same session"
    // and doesn't fire a concurrent session warning during the base threshold tests.
    // (The concurrent session tests will overwrite this in their own bodies.)
    try {
      fs.writeFileSync(LOCK_PATH, JSON.stringify({
        session_id: SESSION,
        timestamp: Math.floor(Date.now() / 1000),
        pid: process.pid
      }));
    } catch {}
    cleanup(SESSION);
  });

  afterEach(() => {
    // Restore or clean up the lock file
    if (savedLock !== null) {
      fs.writeFileSync(LOCK_PATH, savedLock);
    } else {
      try { fs.unlinkSync(LOCK_PATH); } catch {}
    }
    // Clean up lock-warned file for our test session
    try { fs.unlinkSync(path.join(os.tmpdir(), `claude-ctx-${SESSION}-lock-warned.json`)); } catch {}
    cleanup(SESSION);
  });

  // ───── Threshold tests ─────

  it('no warning when remaining > 35% (WARNING_THRESHOLD)', async () => {
    writeMetrics(SESSION, { remaining_percentage: 50, used_pct: 63 });
    const { code, output } = await runHook({ session_id: SESSION });
    assert.equal(code, 0);
    assert.equal(output, null, 'should produce no output');
  });

  it('WARNING message when remaining is between 25-35%', async () => {
    writeMetrics(SESSION, { remaining_percentage: 30, used_pct: 88 });
    const { code, output } = await runHook({ session_id: SESSION });
    assert.equal(code, 0);
    assert.ok(output, 'should produce output');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('WARNING'), 'message should contain WARNING');
    assert.ok(msg.includes('88%'), 'message should contain used_pct');
    assert.ok(msg.includes('30%'), 'message should contain remaining_percentage');
  });

  it('CRITICAL message when remaining <= 25%', async () => {
    writeMetrics(SESSION, { remaining_percentage: 20, used_pct: 100 });
    const { code, output } = await runHook({ session_id: SESSION });
    assert.equal(code, 0);
    assert.ok(output, 'should produce output');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('CRITICAL'), 'message should contain CRITICAL');
    assert.ok(msg.includes('100%'), 'message should contain used_pct');
    assert.ok(msg.includes('20%'), 'message should contain remaining_percentage');
  });

  // ───── Debounce tests ─────

  it('debounce: second call within 5 tool uses should NOT emit', async () => {
    writeMetrics(SESSION, { remaining_percentage: 30, used_pct: 88 });

    // First call should emit (firstWarn = true)
    const first = await runHook({ session_id: SESSION });
    assert.ok(first.output, 'first call should emit warning');

    // Second call (callsSinceWarn = 1 < 5, same severity) should be debounced
    const second = await runHook({ session_id: SESSION });
    assert.equal(second.output, null, 'second call should be debounced (no output)');
  });

  it('severity escalation WARNING->CRITICAL bypasses debounce', async () => {
    // First call: trigger WARNING
    writeMetrics(SESSION, { remaining_percentage: 30, used_pct: 88 });
    const first = await runHook({ session_id: SESSION });
    assert.ok(first.output, 'first call should emit warning');
    assert.ok(
      first.output.hookSpecificOutput.additionalContext.includes('WARNING'),
      'first call should be WARNING level'
    );

    // Second call: escalate to CRITICAL -- should bypass debounce
    writeMetrics(SESSION, { remaining_percentage: 20, used_pct: 100 });
    const second = await runHook({ session_id: SESSION });
    assert.ok(second.output, 'severity escalation should bypass debounce');
    assert.ok(
      second.output.hookSpecificOutput.additionalContext.includes('CRITICAL'),
      'escalated call should be CRITICAL level'
    );
  });

  // ───── Stale metrics ─────

  it('stale metrics (>60s old) are ignored', async () => {
    const staleTimestamp = Math.floor(Date.now() / 1000) - 120; // 2 minutes old
    writeMetrics(SESSION, {
      remaining_percentage: 10,
      used_pct: 100,
      timestamp: staleTimestamp,
    });
    const { code, output } = await runHook({ session_id: SESSION });
    assert.equal(code, 0);
    assert.equal(output, null, 'stale metrics should produce no output');
  });

  // ───── Missing metrics file ─────

  it('missing metrics file exits silently', async () => {
    // beforeEach calls cleanup(SESSION) which removes the metrics file,
    // so SESSION has no metrics file -- the hook should exit silently.
    const { code, output } = await runHook({
      session_id: SESSION,
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'missing metrics should produce no output');
  });

  // ---- Concurrent session detection ----

  describe('concurrent session detection', () => {
    const OTHER_SESSION = `test-other-session-${process.pid}`;

    it('warns when lock belongs to different session', async () => {
      // Write a lock file for a different session
      fs.writeFileSync(LOCK_PATH, JSON.stringify({
        session_id: OTHER_SESSION,
        timestamp: Math.floor(Date.now() / 1000),
        pid: 99999
      }));

      // Write normal metrics so the hook does not exit early for missing metrics
      writeMetrics(SESSION, { remaining_percentage: 50, used_pct: 63 });

      const { code, output } = await runHook({ session_id: SESSION });
      assert.equal(code, 0);
      assert.ok(output, 'should produce concurrent session warning');
      const msg = output.hookSpecificOutput.additionalContext;
      assert.ok(msg.includes('CONCURRENT SESSION'), 'message should mention concurrent session');
      assert.ok(msg.includes(OTHER_SESSION), 'message should include other session id');
    });

    it('no warning when lock belongs to same session', async () => {
      // Write a lock file for our own session
      fs.writeFileSync(LOCK_PATH, JSON.stringify({
        session_id: SESSION,
        timestamp: Math.floor(Date.now() / 1000),
        pid: process.pid
      }));

      writeMetrics(SESSION, { remaining_percentage: 50, used_pct: 63 });

      const { code, output } = await runHook({ session_id: SESSION });
      assert.equal(code, 0);
      assert.equal(output, null, 'should not warn for own session');
    });

    it('no warning when lock is stale (>4 hours old)', async () => {
      fs.writeFileSync(LOCK_PATH, JSON.stringify({
        session_id: OTHER_SESSION,
        timestamp: Math.floor(Date.now() / 1000) - (5 * 3600), // 5 hours ago
        pid: 99999
      }));

      writeMetrics(SESSION, { remaining_percentage: 50, used_pct: 63 });

      const { code, output } = await runHook({ session_id: SESSION });
      assert.equal(code, 0);
      assert.equal(output, null, 'stale lock should not trigger warning');
    });
  });
});
