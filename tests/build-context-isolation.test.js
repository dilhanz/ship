const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
function readSrc(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

describe('build skill — delegated digest', () => {
  it('delegates pre-build file read to the Explore agent', () => {
    const content = readSrc('skills/build/SKILL.md');
    assert.ok(content.includes('Explore'), 'build skill should reference the Explore agent');
    assert.ok(content.includes('Do NOT Read the candidate file bodies'), 'build skill should instruct not to read file bodies directly');
    assert.ok(content.includes('digest is an optimization, never a gate'), 'build skill should state the digest is never a gate');
    assert.ok(content.includes('from Explore digest'), 'build skill should label the Key File Context as from Explore digest');
  });

  it('does not contain the old direct-read instruction', () => {
    const content = readSrc('skills/build/SKILL.md');
    assert.ok(!content.includes('Read up to 8 of those existing files'), 'build skill must not instruct direct reading of candidate files');
  });
});

describe('build skill — bounded verify capture', () => {
  it('uses exit-code-based pass/fail with 5-line tail on success', () => {
    const content = readSrc('skills/build/SKILL.md');
    assert.ok(content.includes('Decide pass/fail on the exit code alone'), 'build skill should decide pass/fail on exit code alone');
    assert.ok(content.includes('last 5 lines'), 'build skill should retain only the last 5 lines on success');
    assert.ok(content.includes('re-pull full output only when a verify fails'), 'build skill should re-pull full output only on failure');
  });

  it('does not contain the old 50-line truncation instruction', () => {
    const content = readSrc('skills/build/SKILL.md');
    assert.ok(!content.includes('truncated to last 50 lines'), 'build skill must not truncate to last 50 lines');
  });
});

describe('builder agent — JSON-only handoff', () => {
  it('requires the final message to be the fenced build_result block only', () => {
    const content = readSrc('agents/ship-builder.md');
    assert.ok(content.includes('final message must be the fenced'), 'ship-builder should state the final message constraint');
    assert.ok(content.includes('build_result'), 'ship-builder should reference the build_result block');
    assert.ok(content.includes('no trailing prose'), 'ship-builder should forbid trailing prose');
  });
});

describe('reviewer agent — JSON-only handoff', () => {
  it('requires the final message to be the fenced review_result block only', () => {
    const content = readSrc('agents/ship-reviewer.md');
    assert.ok(content.includes('final message must be the fenced'), 'ship-reviewer should state the final message constraint');
    assert.ok(content.includes('review_result'), 'ship-reviewer should reference the review_result block');
    assert.ok(content.includes('no trailing prose'), 'ship-reviewer should forbid trailing prose');
  });
});
