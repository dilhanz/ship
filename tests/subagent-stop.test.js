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

/** Helper: build a fenced build_result JSON block */
function buildResultJson(obj) {
  return '```build_result\n' + JSON.stringify(obj, null, 2) + '\n```';
}

describe('subagent-stop hook — JSON format', () => {
  it('passes through valid COMPLETE JSON result', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: buildResultJson({
        feature: 'my-feature',
        scope: 'all',
        status: 'COMPLETE',
        tasks_completed: 3,
        tasks_total: 3,
        commits: ['abc1234', 'def5678', 'ghi9012'],
        deviations: [],
        concerns: [],
        missing: null,
        stopped_at: null,
        reason: null,
        recommendation: null
      }),
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'valid COMPLETE should not inject recovery');
  });

  it('passes through valid COMPLETE_WITH_CONCERNS JSON result', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: buildResultJson({
        feature: 'my-feature',
        scope: 'phase:1',
        status: 'COMPLETE_WITH_CONCERNS',
        tasks_completed: 3,
        tasks_total: 3,
        commits: ['abc1234'],
        deviations: [],
        concerns: ['fragile test in auth module'],
        missing: null,
        stopped_at: null,
        reason: null,
        recommendation: null
      }),
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'valid COMPLETE_WITH_CONCERNS should not inject recovery');
  });

  it('passes through valid NEEDS_CONTEXT JSON result', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: buildResultJson({
        feature: 'my-feature',
        scope: 'phase:2',
        status: 'NEEDS_CONTEXT',
        tasks_completed: 1,
        tasks_total: 3,
        commits: ['abc1234'],
        deviations: [],
        concerns: [],
        missing: 'need database URL for migration',
        stopped_at: null,
        reason: null,
        recommendation: null
      }),
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'valid NEEDS_CONTEXT should not inject recovery');
  });

  it('passes through valid CHECKPOINT JSON result', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: buildResultJson({
        feature: 'my-feature',
        scope: 'phase:1',
        status: 'CHECKPOINT',
        tasks_completed: 1,
        tasks_total: 4,
        commits: ['abc1234'],
        deviations: ['Task 2 requires GraphQL but plan assumes REST'],
        concerns: [],
        missing: null,
        stopped_at: '2 — add API endpoint',
        reason: 'architectural conflict',
        recommendation: 'replan with GraphQL approach'
      }),
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'valid CHECKPOINT should not inject recovery');
  });

  it('handles JSON embedded in surrounding text', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message:
        'I have completed all tasks in the phase. Here is my result:\n\n' +
        buildResultJson({
          feature: 'my-feature',
          scope: 'all',
          status: 'COMPLETE',
          tasks_completed: 2,
          tasks_total: 2,
          commits: ['abc1234'],
          deviations: [],
          concerns: [],
          missing: null,
          stopped_at: null,
          reason: null,
          recommendation: null
        }) +
        '\n\nAll done!',
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'JSON in surrounding text should be valid');
  });

  it('injects recovery for invalid JSON status', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: buildResultJson({
        feature: 'my-feature',
        status: 'UNKNOWN_STATUS',
        tasks_completed: 0,
        tasks_total: 3,
      }),
    });
    assert.equal(code, 0);
    assert.ok(output, 'should inject recovery for unknown status');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('BUILDER AGENT STOPPED WITHOUT VALID RESULT'));
  });
});

describe('subagent-stop hook — legacy Markdown fallback', () => {
  it('passes through legacy BUILD RESULT Markdown format', async () => {
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
    assert.equal(output, null, 'legacy Markdown format should still be accepted');
  });

  it('passes through legacy CHECKPOINT Markdown format', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: [
        '## BUILD RESULT',
        '',
        'Feature: my-feature',
        'Stopped at: Task 2',
        'Status: CHECKPOINT',
      ].join('\n'),
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'legacy CHECKPOINT should still be accepted');
  });
});

describe('subagent-stop hook — failure cases', () => {
  it('injects recovery for missing result', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: 'I was working on task 3 but ran out of turns',
    });
    assert.equal(code, 0);
    assert.ok(output, 'should inject recovery message');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('BUILDER AGENT STOPPED WITHOUT VALID RESULT'));
    assert.ok(msg.includes('RECOVERY'));
  });

  it('injects recovery for empty last_assistant_message', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: '',
    });
    assert.equal(code, 0);
    assert.ok(output, 'should inject recovery for empty message');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('BUILDER AGENT STOPPED WITHOUT VALID RESULT'));
  });

  it('injects recovery for malformed JSON in build_result block', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: '```build_result\n{not valid json\n```',
    });
    assert.equal(code, 0);
    assert.ok(output, 'should inject recovery for malformed JSON');
  });

  it('ignores non-builder agents', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-brainstormer',
      last_assistant_message: 'No build result here at all',
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'non-builder agents should be ignored');
  });

  it('handles missing agent_name', async () => {
    const { code, output } = await runHook({
      last_assistant_message: 'Some message without agent_name',
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'missing agent_name should exit silently');
  });
});
