const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'subagent-stop.cjs');

/**
 * Helper: spawn the hook as a child process, pipe JSON via stdin,
 * capture stdout/stderr, and return parsed output (or null if empty).
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

describe('subagent-stop hook', () => {
  it('passes through valid COMPLETE result', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: [
        '## BUILD RESULT',
        '',
        'Feature: my-feature',
        'Tasks completed: 3 / 3',
        'Status: COMPLETE',
      ].join('\n'),
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'valid COMPLETE should not inject recovery');
  });

  it('passes through valid COMPLETE_WITH_CONCERNS result', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: [
        '## BUILD RESULT',
        '',
        'Feature: my-feature',
        'Tasks completed: 3 / 3',
        'Status: COMPLETE_WITH_CONCERNS',
      ].join('\n'),
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'valid COMPLETE_WITH_CONCERNS should not inject recovery');
  });

  it('passes through valid NEEDS_CONTEXT result', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: [
        '## BUILD RESULT',
        '',
        'Feature: my-feature',
        'Tasks completed: 1 / 3',
        'Missing: need database URL',
        'Status: NEEDS_CONTEXT',
      ].join('\n'),
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'valid NEEDS_CONTEXT should not inject recovery');
  });

  it('passes through valid CHECKPOINT result', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: [
        '## BUILD RESULT',
        '',
        'Feature: my-feature',
        'Stopped at: Task 2 — complex migration',
        'Status: CHECKPOINT',
      ].join('\n'),
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'valid CHECKPOINT should not inject recovery');
  });

  it('injects recovery for missing BUILD RESULT', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: 'I was working on task 3 but ran out of turns',
    });
    assert.equal(code, 0);
    assert.ok(output, 'should inject recovery message');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(
      msg.includes('BUILDER AGENT STOPPED WITHOUT VALID RESULT'),
      'should include main recovery header'
    );
    assert.ok(msg.includes('RECOVERY'), 'should include RECOVERY section');
  });

  it('injects recovery for malformed BUILD RESULT with unknown status', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: [
        '## BUILD RESULT',
        '',
        'Status: UNKNOWN_STATUS',
      ].join('\n'),
    });
    assert.equal(code, 0);
    assert.ok(output, 'should inject recovery for malformed result');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(
      msg.includes('BUILDER AGENT STOPPED WITHOUT VALID RESULT'),
      'should include main recovery header for malformed status'
    );
  });

  it('ignores non-builder agents', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-brainstormer',
      last_assistant_message: 'No BUILD RESULT here at all',
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'non-builder agents should be ignored');
  });

  it('handles empty last_assistant_message', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: '',
    });
    assert.equal(code, 0);
    assert.ok(output, 'should inject recovery for empty message');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(
      msg.includes('BUILDER AGENT STOPPED WITHOUT VALID RESULT'),
      'should include recovery header for empty message'
    );
  });

  it('handles missing agent_name', async () => {
    const { code, output } = await runHook({
      last_assistant_message: 'Some message without agent_name',
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'missing agent_name should exit silently');
  });
});
