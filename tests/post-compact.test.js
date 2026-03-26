const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'post-compact.cjs');

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

    // PostCompact input is minimal — just pass empty object
    child.stdin.write(JSON.stringify({}));
    child.stdin.end();
  });
}

/**
 * Create a feature directory under tmpDir/.planning/features/{name}/
 * with a CONTEXT.md and optionally a PLAN.md.
 *
 * opts:
 *   tasks: array of { id, status, name } — adds task elements to PLAN.md
 *   goal: string — adds goal frontmatter to PLAN.md
 *   phase: { id, name, status } — adds a phase element to PLAN.md
 *   decisions: array of strings — adds a Decisions section to CONTEXT.md
 *   decisionsFollowedBy: string — section name to follow Decisions (default: 'Scope')
 */
function createFeature(tmpDir, name, status, opts = {}) {
  const featureDir = path.join(tmpDir, '.planning', 'features', name);
  fs.mkdirSync(featureDir, { recursive: true });

  // Build CONTEXT.md
  let contextContent = `---\nfeature: "${name}"\nstatus: ${status}\n---\n\n## Problem\n\nTest feature.\n`;

  if (opts.decisions && opts.decisions.length > 0) {
    const followedBy = opts.decisionsFollowedBy || 'Scope';
    contextContent += `\n## Decisions\n\n`;
    for (const d of opts.decisions) {
      contextContent += `${d}\n`;
    }
    contextContent += `\n## ${followedBy}\n\nTest scope.\n`;
  }

  fs.writeFileSync(path.join(featureDir, 'CONTEXT.md'), contextContent);

  // Build PLAN.md if tasks or goal is provided
  if (opts.tasks || opts.goal || opts.phase) {
    let planContent = `---\nfeature: "${name}"\n`;
    if (opts.goal) planContent += `goal: "${opts.goal}"\n`;
    planContent += `---\n\n`;

    if (opts.phase) {
      planContent += `<phase id="${opts.phase.id}" name="${opts.phase.name}" status="${opts.phase.status}">\n`;
    }

    if (opts.tasks) {
      for (const t of opts.tasks) {
        planContent += `<task id="${t.id}" status="${t.status}"><name>${t.name}</name></task>\n`;
      }
    }

    if (opts.phase) {
      planContent += `</phase>\n`;
    }

    fs.writeFileSync(path.join(featureDir, 'PLAN.md'), planContent);
  }
}

describe('post-compact hook', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-post-compact-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('re-injects feature state for active feature', async () => {
    createFeature(tmpDir, 'my-feature', 'building', {
      tasks: [
        { id: 1, status: 'done', name: 'First task' },
        { id: 2, status: 'done', name: 'Second task' },
        { id: 3, status: 'pending', name: 'Third task' },
      ],
    });

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'should produce output for active feature');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('my-feature'), 'should include feature name');
    assert.ok(msg.includes('building'), 'should include status');
    assert.ok(msg.includes('2/3 done'), 'should include task counts');
    assert.ok(msg.includes('1 pending'), 'should include pending count');
  });

  it('includes goal from PLAN.md', async () => {
    createFeature(tmpDir, 'goal-feature', 'planned', {
      goal: 'test goal',
      tasks: [{ id: 1, status: 'pending', name: 'Task one' }],
    });

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'should produce output');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('test goal'), 'should include goal from PLAN.md');
  });

  it('includes current phase name', async () => {
    createFeature(tmpDir, 'phased-feature', 'building', {
      goal: 'phased goal',
      phase: { id: '1', name: 'Core setup', status: 'building' },
      tasks: [{ id: 1, status: 'pending', name: 'Some task' }],
    });

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'should produce output');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('Core setup'), 'should include current phase name');
  });

  it('skips features with status done', async () => {
    createFeature(tmpDir, 'done-feature', 'done');
    createFeature(tmpDir, 'active-feature', 'building', {
      tasks: [{ id: 1, status: 'pending', name: 'Task one' }],
    });

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'should produce output for active feature');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(!msg.includes('done-feature'), 'should not mention done feature');
    assert.ok(msg.includes('active-feature'), 'should mention active feature');
  });

  it('no output when no features directory exists', async () => {
    // tmpDir has no .planning/features/ directory

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.equal(output, null, 'should produce no output when no features directory');
  });

  it('no output when all features are done', async () => {
    createFeature(tmpDir, 'done-feature-1', 'done');
    createFeature(tmpDir, 'done-feature-2', 'done');

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.equal(output, null, 'should produce no output when all features are done');
  });

  it('includes key decisions', async () => {
    createFeature(tmpDir, 'decisions-feature', 'building', {
      decisions: [
        '- Use PostgreSQL for persistence',
        '- JWT tokens for authentication',
      ],
      decisionsFollowedBy: 'Scope',
    });

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'should produce output');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('Use PostgreSQL for persistence'), 'should include first decision');
    assert.ok(msg.includes('JWT tokens for authentication'), 'should include second decision');
  });

  it('handles multiple active features', async () => {
    createFeature(tmpDir, 'feature-alpha', 'building', {
      tasks: [{ id: 1, status: 'pending', name: 'Task one' }],
    });
    createFeature(tmpDir, 'feature-beta', 'planned');

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'should produce output for multiple active features');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('feature-alpha'), 'should mention first active feature');
    assert.ok(msg.includes('feature-beta'), 'should mention second active feature');
  });
});
