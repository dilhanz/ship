const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'ship-safety-gate.cjs');

function runHook(inputObj) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.on('error', reject);
    child.stdin.write(JSON.stringify(inputObj));
    child.stdin.end();
  });
}

describe('ship-safety-gate hook', () => {
  it('blocks git add .', async () => {
    const { code, stderr } = await runHook({ tool_input: { command: 'git add .' } });
    assert.equal(code, 2);
    assert.ok(stderr.includes('BLOCKED'));
  });

  it('blocks git add -A', async () => {
    const { code, stderr } = await runHook({ tool_input: { command: 'git add -A' } });
    assert.equal(code, 2);
    assert.ok(stderr.includes('BLOCKED'));
  });

  it('blocks git add --all', async () => {
    const { code, stderr } = await runHook({ tool_input: { command: 'git add --all' } });
    assert.equal(code, 2);
    assert.ok(stderr.includes('BLOCKED'));
  });

  it('blocks git add . in chained command', async () => {
    const { code, stderr } = await runHook({ tool_input: { command: 'git add . && git commit -m "test"' } });
    assert.equal(code, 2);
    assert.ok(stderr.includes('BLOCKED'));
  });

  it('allows git add with specific files', async () => {
    const { code } = await runHook({ tool_input: { command: 'git add src/foo.ts src/bar.ts' } });
    assert.equal(code, 0);
  });

  it('allows non-git commands', async () => {
    const { code } = await runHook({ tool_input: { command: 'npm test' } });
    assert.equal(code, 0);
  });

  it('allows empty input gracefully', async () => {
    const { code } = await runHook({});
    assert.equal(code, 0);
  });
});
