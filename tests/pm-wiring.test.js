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

const shipPm = 'agents/ship-pm.md';

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

  it('pm carries the widened verb boundary and pm-sync can interview', () => {
    const pmTools = frontmatterField(readSrc(PM_SKILLS.pm), 'allowed-tools')
      .split(',').map((t) => t.trim());
    for (const tool of ['Write', 'Edit', 'Bash', 'Agent']) {
      assert.ok(pmTools.includes(tool), `pm allowed-tools includes ${tool}`);
    }

    const pmSyncTools = frontmatterField(readSrc(PM_SKILLS.pmSync), 'allowed-tools')
      .split(',').map((t) => t.trim());
    assert.ok(pmSyncTools.includes('AskUserQuestion'), 'pm-sync allowed-tools includes AskUserQuestion');
  });

  it('pm routes the four verbs and delegates to the ship-pm agent', () => {
    const c = readSrc(PM_SKILLS.pm);
    assert.ok(c.includes('ship-pm'), 'pm delegates to the ship-pm agent');
    for (const verb of ['status', 'groom', 'check', 'handover']) {
      assert.ok(c.includes(verb), `pm documents the ${verb} verb`);
    }
  });

  it('pm-sync documents the legacy growth path', () => {
    const c = readSrc(PM_SKILLS.pmSync);
    assert.ok(c.includes('Growth path'), 'pm-sync documents the Growth path');
    assert.ok(c.includes('STATUS.md'), 'pm-sync writes STATUS.md');
    assert.ok(c.includes('CONVENTIONS.md'), 'pm-sync writes CONVENTIONS.md');
  });

  it('both skills state the no-implementation rule and the .project-manager write boundary', () => {
    for (const rel of [PM_SKILLS.pm, PM_SKILLS.pmSync]) {
      const c = readSrc(rel);
      assert.ok(/never (begin|start) implementation/i.test(c), `${rel} forbids implementation work`);
      assert.ok(c.includes('.project-manager'), `${rel} states the .project-manager write boundary`);
    }
  });
});

describe('pm wiring — ship-pm agent', () => {
  it('agents/ship-pm.md exists with name, tools, and a Use-when description', () => {
    assert.ok(fs.existsSync(path.join(repoRoot, shipPm)), `${shipPm} exists`);
    const c = readSrc(shipPm);
    assert.ok(/^name:\s*ship-pm$/m.test(c), 'ship-pm declares name: ship-pm');
    const tools = frontmatterField(c, 'tools');
    assert.ok(tools, 'ship-pm has a tools: line');
    for (const tool of ['Write', 'Edit', 'Bash']) {
      assert.ok(tools.split(',').map((t) => t.trim()).includes(tool), `ship-pm tools include ${tool}`);
    }
    const description = frontmatterField(c, 'description');
    assert.ok(description && description.includes('Use when'), 'ship-pm description uses "Use when" trigger format');
  });

  it('ship-pm states the write boundary and the history rules', () => {
    const c = readSrc(shipPm);
    for (const glob of ['.project-manager/**', '.planning/**', '.claude/**']) {
      assert.ok(c.includes(glob), `ship-pm states the ${glob} write boundary`);
    }
    assert.ok(/never edit application source/i.test(c), 'ship-pm forbids editing application source');
    assert.ok(/push --force/.test(c), 'ship-pm forbids push --force');
    assert.ok(/rebase/.test(c), 'ship-pm forbids rebase');
    assert.ok(/never invent status/i.test(c), 'ship-pm states the never-invent-status rule');
  });

  it('ship-pm follows the PM convention — reads pm-state, never implements', () => {
    const c = readSrc(shipPm);
    assert.ok(c.includes('pm-state/SKILL.md'), 'ship-pm reads pm-state/SKILL.md');
    assert.ok(/never begin implementation/i.test(c), 'ship-pm forbids implementation work');
  });

  it('the check verb states its output contract in both the skill and the agent', () => {
    for (const rel of [PM_SKILLS.pm, shipPm]) {
      const c = readSrc(rel);
      assert.ok(c.includes('PROVEN'), `${rel} states the PROVEN outcome`);
      assert.ok(c.includes('UNPROVEN'), `${rel} states the UNPROVEN outcome`);
    }
    const agent = readSrc(shipPm);
    assert.ok(/verification debt/i.test(agent), 'ship-pm files unproven criteria as verification debt');
    assert.ok(agent.includes('P0') && agent.includes('P1'), 'ship-pm files that debt at P0 or P1');
  });
});

describe('pm wiring — dashboard template', () => {
  it('template exists with all seven PM: placeholders', () => {
    const c = readSrc('ship/templates/dashboard.html');
    for (const name of ['PROJECT', 'UPDATED', 'NEXT', 'INFLIGHT', 'MILESTONES', 'BLOCKERS', 'DECISIONS']) {
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
  it('pm-state carries the exact backlog table header', () => {
    const c = readSrc(PM_SKILLS.pmState);
    assert.ok(
      c.includes('| Item | Status | Priority | Size | Depends on | Source | Ship feature |'),
      'pm-state documents the exact backlog table header'
    );
  });

  it('pm-state bans time estimates while permitting effort sizing', () => {
    const c = readSrc(PM_SKILLS.pmState);
    assert.ok(c.includes('no time estimates'), 'pm-state still bans time estimates');
    assert.ok(c.includes('S | M | L | XL'), 'pm-state permits S/M/L/XL effort sizing');
  });

  it('pm-state documents the five-file enriched format', () => {
    const c = readSrc(PM_SKILLS.pmState);
    assert.ok(c.includes('STATUS.md'), 'pm-state documents STATUS.md');
    assert.ok(c.includes('CONVENTIONS.md'), 'pm-state documents CONVENTIONS.md');
    assert.ok(c.includes('decisions/'), 'pm-state documents the decisions/ spill directory');
    assert.ok(c.includes('#### '), 'pm-state documents the #### item detail-section convention');
    assert.ok(c.includes('## Backwards compatibility'), 'pm-state documents backwards compatibility');
  });

  it('pm-state states the P0–P3 priority key', () => {
    const c = readSrc(PM_SKILLS.pmState);
    for (const tier of ['P0', 'P1', 'P2', 'P3']) {
      assert.ok(c.includes(tier), `pm-state states the ${tier} tier`);
    }
  });
});

const ENRICHED_HEADER =
  '| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane | Blast radius | Confidence | First seen |';

describe('pm wiring — pm-sync grows a table to the enriched shape', () => {
  const skill = readSrc(PM_SKILLS.pmSync);

  it('bootstrap writes the enriched 11-column table, not the 8-column one', () => {
    const write = skill.slice(skill.indexOf('4. **Write state**'), skill.indexOf('## Reconcile flow'));
    assert.ok(write.includes(ENRICHED_HEADER), 'the bootstrap names the enriched header verbatim');
    assert.ok(
      !/8-column backlog table/.test(write),
      'the bootstrap no longer stops at the 8-column shape'
    );
  });

  it('the growth path targets the enriched header and names every narrower shape', () => {
    const growth = skill.slice(skill.indexOf('3. **Growth path'), skill.indexOf('4. **Interview only'));
    assert.ok(growth.includes(ENRICHED_HEADER), 'growth rewrites to the enriched header');
    for (const shape of ['5-column', '7-column', '8-column', '10-column']) {
      assert.ok(growth.includes(shape), `the growth path detects the ${shape} shape`);
    }
  });

  it('the derived columns are marked never-authored, and only pm-sync widens a table', () => {
    const growth = skill.slice(skill.indexOf('3. **Growth path'), skill.indexOf('4. **Interview only'));
    assert.match(growth, /First seen/);
    assert.match(growth, /never author|never by the user|never hand/i);
    assert.match(growth, /only path that widens|never adds a column on its own/i);
  });

  it('the interview asks for blast radius and confidence, and allows an unsure answer', () => {
    const interview = skill.slice(
      skill.indexOf('3. **Interview via AskUserQuestion**'),
      skill.indexOf('4. **Write state**')
    );
    assert.match(interview, /blast radius/i);
    assert.match(interview, /confidence/i);
    assert.match(interview, /`—` is a legitimate answer|unsure/i);
    assert.match(interview, /[Nn]ever infer confidence/);
  });

  it('pm-sync knows LEDGER.md exists and that it never authors it', () => {
    assert.match(skill, /LEDGER\.md/);
    assert.match(skill, /`LEDGER\.md` is never authored here/);
  });

  it('every optional column pm-sync writes is one pm-state defines', () => {
    const state = readSrc(PM_SKILLS.pmState);
    for (const column of ['Blast radius', 'Confidence', 'First seen']) {
      assert.ok(state.includes(`**${column}**`), `pm-state defines ${column}`);
      assert.ok(skill.includes(column), `pm-sync knows ${column}`);
    }
    assert.ok(state.includes(ENRICHED_HEADER), 'both skills name the same enriched header');
  });
});
