/**
 * Project-manager wiring — static assertions over the PM skills, the
 * dashboard template, and the nudge-hook registration. No spawning;
 * plain fs reads only.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const PM_SKILLS = {
  pm: 'skills/pm/SKILL.md',
  pmSync: 'skills/pm-sync/SKILL.md',
  pmState: 'skills/pm-state/SKILL.md',
};

function frontmatterField(content, field) {
  const m = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

describe('pm wiring — skill files', () => {
  it('pm, pm-sync, and pm-state skill files all exist', () => {
    for (const rel of Object.values(PM_SKILLS)) {
      assert.ok(fs.existsSync(path.join(repoRoot, rel)), `${rel} exists`);
    }
  });

  it('pm and pm-sync carry name, Use-when description, and allowed-tools', () => {
    for (const rel of [PM_SKILLS.pm, PM_SKILLS.pmSync]) {
      const c = readSrc(rel);
      assert.ok(/^name:\s*ship:/m.test(c), `${rel} has a name: line`);
      const description = frontmatterField(c, 'description');
      assert.ok(description && description.includes('Use when'), `${rel} description uses "Use when" trigger format`);
      assert.ok(/^allowed-tools:\s*.+$/m.test(c), `${rel} has an allowed-tools: line`);
    }
  });

  it('pm and pm-sync bodies both reference the pm-state reference skill', () => {
    for (const rel of [PM_SKILLS.pm, PM_SKILLS.pmSync]) {
      assert.ok(readSrc(rel).includes('pm-state/SKILL.md'), `${rel} reads pm-state/SKILL.md`);
    }
  });

  it('pm is read-mostly (no Edit, no Bash) and pm-sync can interview', () => {
    const pmTools = frontmatterField(readSrc(PM_SKILLS.pm), 'allowed-tools')
      .split(',').map((t) => t.trim());
    assert.ok(!pmTools.includes('Edit'), 'pm allowed-tools must not include Edit');
    assert.ok(!pmTools.includes('Bash'), 'pm allowed-tools must not include Bash');

    const pmSyncTools = frontmatterField(readSrc(PM_SKILLS.pmSync), 'allowed-tools')
      .split(',').map((t) => t.trim());
    assert.ok(pmSyncTools.includes('AskUserQuestion'), 'pm-sync allowed-tools includes AskUserQuestion');
  });

  it('both skills state the no-implementation rule and the .project-manager write boundary', () => {
    for (const rel of [PM_SKILLS.pm, PM_SKILLS.pmSync]) {
      const c = readSrc(rel);
      assert.ok(/never (begin|start) implementation/i.test(c), `${rel} forbids implementation work`);
      assert.ok(c.includes('.project-manager'), `${rel} states the .project-manager write boundary`);
    }
  });
});

describe('pm wiring — dashboard template', () => {
  it('template exists with all six PM: placeholders', () => {
    const c = readSrc('ship/templates/dashboard.html');
    for (const name of ['PROJECT', 'UPDATED', 'NEXT', 'MILESTONES', 'BLOCKERS', 'DECISIONS']) {
      assert.ok(c.includes(`<!-- PM:${name} -->`), `template contains the PM:${name} placeholder`);
    }
  });

  it('template is self-contained — no external references', () => {
    const c = readSrc('ship/templates/dashboard.html');
    assert.ok(!c.includes('http://'), 'template contains no http:// substring');
    assert.ok(!c.includes('https://'), 'template contains no https:// substring');
    assert.ok(!/<script src/i.test(c), 'template contains no <script src');
    assert.ok(!/<link/i.test(c), 'template contains no <link');
  });
});

describe('pm wiring — hook registration', () => {
  it('hooks.json registers pm-sync-nudge on PostToolUse Write|Edit', () => {
    const hooks = JSON.parse(readSrc('hooks/hooks.json'));
    const entry = hooks.hooks.PostToolUse.find(
      (e) => e.hooks.some((h) => h.command.includes('pm-sync-nudge.cjs'))
    );
    assert.ok(entry, 'a PostToolUse entry references pm-sync-nudge.cjs');
    assert.equal(entry.matcher, 'Write|Edit', 'nudge hook matcher is Write|Edit');
  });
});

describe('pm wiring — state format contract', () => {
  it('pm-state carries the exact backlog table header and the no-estimates rule', () => {
    const c = readSrc(PM_SKILLS.pmState);
    assert.ok(
      c.includes('| Item | Status | Priority | Depends on | Ship feature |'),
      'pm-state documents the exact backlog table header'
    );
    assert.ok(c.includes('no estimates'), 'pm-state states the no-estimates rule');
  });
});
