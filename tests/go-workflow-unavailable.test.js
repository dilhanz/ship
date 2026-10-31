/**
 * /ship:go manual mode — the session has no Workflow tool.
 *
 * Some sessions start without the Workflow tool (worktree sessions most
 * often). Without a written fallback each run improvised one: Ship agents
 * hand-run from the main conversation, a plan-loop Outcome block written by
 * hand. These tests pin the fallback to the manual skills.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const go = fs.readFileSync(path.join(__dirname, '..', 'skills', 'go', 'SKILL.md'), 'utf8');
const section = (() => {
  const start = go.indexOf('## 1c. Check the Workflow Tool');
  const end = go.indexOf('\n## ', start + 1);
  return start === -1 ? '' : go.slice(start, end);
})();

describe('go skill — Workflow tool unavailable', () => {
  it('has a check section before routing', () => {
    assert.ok(section, 'section 1c must exist');
    assert.ok(go.indexOf('## 1c.') < go.indexOf('## 2. Advance Pre-Build Steps'));
  });

  it('probes with ToolSearch before declaring manual mode', () => {
    assert.match(section, /`ToolSearch` with `select:Workflow`/);
    assert.match(section, /\*\*manual mode\*\*/);
  });

  it('falls back to the manual skills for the plan loop and the spine', () => {
    for (const skill of ['/ship:plan-verify', '/ship:build', '/ship:verify']) {
      assert.ok(section.includes(skill), `manual mode must name ${skill}`);
    }
  });

  it('maps every headless stop to a contract outcome', () => {
    for (const outcome of ['unresolved', 'verify-fail', 'needs-context', 'checkpoint', 'exhausted']) {
      assert.ok(section.includes(`\`${outcome}\``), `manual mode must name outcome ${outcome}`);
    }
  });

  it('forbids hand-running the workflows', () => {
    assert.match(section, /Never hand-run the workflows instead/);
  });

  it('ToolSearch is an allowed tool', () => {
    const fm = go.split('---')[1];
    assert.match(fm, /allowed-tools:.*\bToolSearch\b/);
  });
});
