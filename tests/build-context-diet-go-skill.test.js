'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'go', 'SKILL.md'), 'utf8');

function section(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  assert.ok(end > start, `missing ${endMarker}`);
  return text.slice(start, end);
}

describe('build-context-diet — go skill wiring', () => {
  it('accepts and resolves --build-mode', () => {
    assert.ok(skill.includes('--build-mode'));
    const fm = skill.match(/^---\n([\s\S]*?)\n---/)[1];
    assert.match(fm, /argument-hint:.*\[--build-mode <per-task\|per-phase>\]/);
    const s1b = section(skill, '## 1b.', '## 1c.');
    assert.match(s1b, /resolve-profile\.cjs" \{name\} --build-mode \{value\}/);
    assert.ok(s1b.includes('SHIP_BUILD_MODE'), 'the env rollback must be documented');
    assert.match(s1b, /`--build-mode` flag > `SHIP_BUILD_MODE` env > `per-task`/);
  });

  it('builds the pending phase list with plan-tasks.cjs and keeps a fallback', () => {
    const s4 = section(skill, '## 4.', '## 5.');
    assert.ok(s4.includes('plan-tasks.cjs'));
    assert.match(s4, /fall back/i);
    assert.match(s4, /without\*\* `tasks`/);
  });

  it('passes buildMode and shipRoot in the section-5 args block', () => {
    const s5 = section(skill, '## 5.', '## 6.');
    const block = s5.slice(s5.indexOf('Workflow({'), s5.indexOf('})'));
    assert.match(block, /buildMode: "\{buildMode\}"/);
    assert.match(block, /shipRoot: "\$\{CLAUDE_PLUGIN_ROOT\}"/);
    assert.match(block, /phases: \[ \{id, name, tasks\}/);
  });

  it('records builder evidence in REVIEW.md', () => {
    const s6 = section(skill, '## 6.', '## 6b.');
    assert.ok(s6.includes('Builder evidence:'));
    assert.match(s6, /Builder evidence: \{K\} task\(s\) — \{P\} exit 0, \{F\} non-zero/);
  });

  it('the unsubstantiated condition counts builderEvidence', () => {
    const line = skill.split('\n').find((l) => l.includes('Unsubstantiated review verdicts'));
    assert.ok(line);
    assert.ok(line.includes('builderEvidence'));
    assert.match(line, /NOT `SKIPPED_BY_PROFILE`/);
  });

  it('reports the per-phase rollback in GO COMPLETE', () => {
    assert.ok(skill.includes('[If buildMode is per-phase:] Build mode: per-phase (rollback path)'));
  });
});
