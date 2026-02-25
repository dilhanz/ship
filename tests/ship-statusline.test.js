const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'ship-statusline.js');

/**
 * Helper: spawn the statusline hook, pipe JSON via stdin, capture raw stdout.
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
      resolve({ code, raw: stdout });
    });

    child.on('error', reject);

    child.stdin.write(JSON.stringify(inputObj));
    child.stdin.end();
  });
}

/**
 * Strip ANSI escape codes from a string for easier assertions.
 */
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('ship-statusline hook', () => {
  // ───── Context scaling math ─────

  describe('context scaling', () => {
    it('80% raw usage displays as 100%', async () => {
      // remaining=20 -> rawUsed=80 -> scaled = round((80/80)*100) = 100
      const { raw } = await runHook({
        model: { display_name: 'TestModel' },
        workspace: { current_dir: '/tmp/myproject' },
        context_window: { remaining_percentage: 20 },
      });
      const clean = stripAnsi(raw);
      assert.ok(clean.includes('100%'), `expected "100%" in: ${clean}`);
    });

    it('0% raw usage displays as 0%', async () => {
      // remaining=100 -> rawUsed=0 -> scaled = round((0/80)*100) = 0
      const { raw } = await runHook({
        model: { display_name: 'TestModel' },
        workspace: { current_dir: '/tmp/myproject' },
        context_window: { remaining_percentage: 100 },
      });
      const clean = stripAnsi(raw);
      assert.ok(clean.includes('0%'), `expected "0%" in: ${clean}`);
    });

    it('40% raw usage displays as 50%', async () => {
      // remaining=60 -> rawUsed=40 -> scaled = round((40/80)*100) = 50
      const { raw } = await runHook({
        model: { display_name: 'TestModel' },
        workspace: { current_dir: '/tmp/myproject' },
        context_window: { remaining_percentage: 60 },
      });
      const clean = stripAnsi(raw);
      assert.ok(clean.includes('50%'), `expected "50%" in: ${clean}`);
    });
  });

  // ───── Progress bar rendering ─────

  describe('progress bar rendering', () => {
    it('renders correct filled/empty segments for 50% scaled usage', async () => {
      // 50% scaled -> filled = floor(50/10) = 5
      const { raw } = await runHook({
        model: { display_name: 'TestModel' },
        workspace: { current_dir: '/tmp/myproject' },
        context_window: { remaining_percentage: 60 },
      });
      // 5 filled + 5 empty
      assert.ok(raw.includes('\u2588'.repeat(5) + '\u2591'.repeat(5)),
        'should have 5 filled and 5 empty segments');
    });

    it('renders all empty segments for 0% scaled usage', async () => {
      const { raw } = await runHook({
        model: { display_name: 'TestModel' },
        workspace: { current_dir: '/tmp/myproject' },
        context_window: { remaining_percentage: 100 },
      });
      // 0 filled + 10 empty
      assert.ok(raw.includes('\u2591'.repeat(10)),
        'should have 10 empty segments for 0% usage');
    });

    it('renders all filled segments for 100% scaled usage', async () => {
      const { raw } = await runHook({
        model: { display_name: 'TestModel' },
        workspace: { current_dir: '/tmp/myproject' },
        context_window: { remaining_percentage: 20 },
      });
      // 10 filled + 0 empty
      assert.ok(raw.includes('\u2588'.repeat(10)),
        'should have 10 filled segments for 100% usage');
    });
  });

  // ───── Color thresholds ─────

  describe('color thresholds', () => {
    it('green color for low usage (< 63% scaled)', async () => {
      // remaining=70 -> rawUsed=30 -> scaled=38 -> green (< 63)
      const { raw } = await runHook({
        model: { display_name: 'TestModel' },
        workspace: { current_dir: '/tmp/myproject' },
        context_window: { remaining_percentage: 70 },
      });
      assert.ok(raw.includes('\x1b[32m'), 'should use green ANSI code');
    });

    it('yellow color for medium usage (63-80% scaled)', async () => {
      // remaining=36 -> rawUsed=64 -> scaled=80 -> yellow (>= 63, < 81)
      const { raw } = await runHook({
        model: { display_name: 'TestModel' },
        workspace: { current_dir: '/tmp/myproject' },
        context_window: { remaining_percentage: 36 },
      });
      assert.ok(raw.includes('\x1b[33m'), 'should use yellow ANSI code');
    });

    it('orange color for high usage (81-94% scaled)', async () => {
      // remaining=26 -> rawUsed=74 -> scaled=93 -> orange (>= 81, < 95)
      const { raw } = await runHook({
        model: { display_name: 'TestModel' },
        workspace: { current_dir: '/tmp/myproject' },
        context_window: { remaining_percentage: 26 },
      });
      assert.ok(raw.includes('\x1b[38;5;208m'), 'should use orange ANSI code');
    });

    it('red blinking color for extreme usage (>= 95% scaled)', async () => {
      // remaining=20 -> rawUsed=80 -> scaled=100 -> red blink (>= 95)
      const { raw } = await runHook({
        model: { display_name: 'TestModel' },
        workspace: { current_dir: '/tmp/myproject' },
        context_window: { remaining_percentage: 20 },
      });
      assert.ok(raw.includes('\x1b[5;31m'), 'should use red blinking ANSI code');
    });
  });

  // ───── Model name display ─────

  describe('model name display', () => {
    it('displays provided model name', async () => {
      const { raw } = await runHook({
        model: { display_name: 'Claude Opus 4' },
        workspace: { current_dir: '/tmp/myproject' },
      });
      const clean = stripAnsi(raw);
      assert.ok(clean.includes('Claude Opus 4'), 'should display the model name');
    });

    it('defaults to "Claude" when model name is missing', async () => {
      const { raw } = await runHook({
        workspace: { current_dir: '/tmp/myproject' },
      });
      const clean = stripAnsi(raw);
      assert.ok(clean.includes('Claude'), 'should default to "Claude"');
    });
  });

  // ───── Directory basename display ─────

  describe('directory basename display', () => {
    it('displays basename of the current directory', async () => {
      const { raw } = await runHook({
        model: { display_name: 'TestModel' },
        workspace: { current_dir: '/home/user/projects/my-awesome-app' },
      });
      const clean = stripAnsi(raw);
      assert.ok(
        clean.includes('my-awesome-app'),
        `expected "my-awesome-app" in: ${clean}`
      );
      // Should NOT contain the full path
      assert.ok(
        !clean.includes('/home/user/projects/my-awesome-app'),
        'should not contain full directory path'
      );
    });
  });
});
