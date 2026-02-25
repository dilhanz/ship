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

describe('ship-context-monitor hook', () => {
  beforeEach(() => cleanup(SESSION));
  afterEach(() => cleanup(SESSION));

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
    // Don't create metrics file -- just run with a session_id
    const { code, output } = await runHook({
      session_id: `${SESSION}-nonexistent`,
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'missing metrics should produce no output');
  });
});
