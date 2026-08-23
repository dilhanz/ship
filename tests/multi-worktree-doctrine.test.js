/**
 * Multi-worktree PM doctrine invariants.
 *
 * Locks in the fleet-aware PM layer: the lane sweep and collision foresight
 * in ship-pm and /ship:pm, the prune guard replacing the unconditional
 * handover prune, the 8-column Lane roadmap spec and fleet hard rules in
 * pm-state, Lane growth + tracked-state degrade in pm-sync, the main-root
 * archive in finish, the dashboard Lanes placeholder, and the lane-ownership
 * binding doctrine (unowned, ownedBy, the CONTEXT.md lane stamp).
 *
 * Scoped to the canonical `skills/`, `agents/`, and `ship/templates/` trees
 * only — never the legacy `.claude/` mirrors.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
// Normalize CRLF so line-based assertions hold on Windows checkouts.
const readSrc = (rel) =>
  fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------
// ship-pm agent — fleet sweep, collision foresight, prune guard
// ---------------------------------------------------------------------------

describe('multi-worktree — ship-pm agent doctrine', () => {
  const agent = readSrc('agents/ship-pm.md');

  it('runs the lane sweep as part of the mechanical arm', () => {
    assert.ok(agent.includes('lane-sweep'), 'ship-pm must invoke lane-sweep for the fleet view');
  });

  it('states the never-force-remove rule', () => {
    assert.ok(agent.includes('remove --force'),
      'ship-pm must name git worktree remove --force as forbidden');
    assert.ok(/never suggest or run.*remove --force/i.test(agent),
      'the remove --force mention must be a prohibition, not an instruction');
  });

  it('handover prune is guarded, not unconditional', () => {
    assert.ok(!agent.includes('Prune stale worktrees (git worktree prune)'),
      'the old unconditional handover prune step must be gone');

    // Extract the handover section and require a guard condition on its prune.
    const start = agent.indexOf('### handover');
    assert.ok(start !== -1, 'ship-pm must keep the handover verb');
    const rest = agent.slice(start + '### handover'.length);
    const nextHeading = rest.search(/\n#{2,3} /);
    const handover = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

    assert.ok(handover.includes('worktree prune'), 'handover still covers worktree prune');
    assert.ok(/prune guard/i.test(handover) && /only after/i.test(handover),
      'handover prune must carry a guard condition (sweep-confirmed, only after)');
  });

  it('degrades explicitly when .project-manager/ is tracked', () => {
    assert.ok(/cannot/.test(agent) && /tracked/.test(agent),
      'ship-pm must say it cannot aggregate when .project-manager/ is tracked');
    assert.ok(/never fake a shared view/i.test(agent),
      'the tracked-state degrade must forbid faking a fleet view');
  });

  it('populates the ROADMAP Lane column from sweep data', () => {
    assert.ok(agent.includes('Lane'), 'ship-pm must own the Lane column');
  });
});

// ---------------------------------------------------------------------------
// /ship:pm skill — Lanes brief and collision warnings
// ---------------------------------------------------------------------------

describe('multi-worktree — pm skill doctrine', () => {
  const skill = readSrc('skills/pm/SKILL.md');

  it('brief includes Lanes reporting', () => {
    assert.ok(skill.includes('Lanes'), 'the bare brief must carry a Lanes bullet');
  });

  it('brief surfaces overlap collision warnings', () => {
    assert.ok(/overlap/i.test(skill), 'the brief must warn on in-flight plan file overlaps');
  });
});

// ---------------------------------------------------------------------------
// pm-sync skill — Lane growth and tracked-state degrade
// ---------------------------------------------------------------------------

describe('multi-worktree — pm-sync skill doctrine', () => {
  const skill = readSrc('skills/pm-sync/SKILL.md');

  it('growth path adds the Lane column on a confirmed reconcile', () => {
    assert.ok(skill.includes('Lane'), 'pm-sync must grow the Lane column');
    assert.ok(skill.includes('8-column'), 'pm-sync growth targets the 8-column header');
  });

  it('states the tracked-state degrade message', () => {
    assert.ok(skill.includes('tracked'),
      'pm-sync must note the fleet view is unavailable while .project-manager/ is tracked');
  });
});

// ---------------------------------------------------------------------------
// pm-state skill — 8-column spec, Lanes section, fleet hard rules
// ---------------------------------------------------------------------------

describe('multi-worktree — pm-state spec', () => {
  const skill = readSrc('skills/pm-state/SKILL.md');

  it('mandatory backlog header is the 8-column shape ending in | Lane |', () => {
    const header = '| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane |';
    assert.ok(skill.includes(header), 'pm-state must carry the 8-column header literal');

    // Pin the shape by design: the mandatory-header line itself ends with
    // "| Lane |", so the 7-column literal passing includes() by prefix
    // accident can never satisfy this.
    const anchor = skill.indexOf('The table header must be exactly:');
    assert.ok(anchor !== -1, 'pm-state must keep the mandatory-header anchor');
    const after = skill.slice(anchor).split('\n');
    const headerLine = after.find((l) => l.trimStart().startsWith('| Item |'));
    assert.ok(headerLine, 'a header line must follow the mandatory-header anchor');
    assert.ok(headerLine.trimEnd().endsWith('| Lane |'),
      'the mandatory header line must end with | Lane |');
  });

  it('STATUS.md gains the ## Lanes section', () => {
    assert.ok(skill.includes('## Lanes'), 'pm-state must specify the STATUS.md Lanes section');
  });

  it('carries the writer-ownership hard rule', () => {
    assert.ok(skill.includes('Writer ownership'),
      'pm-state must state that lanes write only their own .planning and the PM owns shared state');
  });

  it('carries the fleet-view-requires-gitignored hard rule', () => {
    assert.ok(skill.includes('Fleet view requires gitignored state'),
      'pm-state must state the fleet view exists only when .project-manager/ is gitignored');
  });
});

// ---------------------------------------------------------------------------
// finish skill — archive to the main worktree root
// ---------------------------------------------------------------------------

describe('multi-worktree — finish archives to the canonical root', () => {
  const skill = readSrc('skills/finish/SKILL.md');

  it('resolves the main root via git-common-dir before archiving', () => {
    assert.ok(skill.includes('git-common-dir'),
      'finish must resolve the main worktree root via git rev-parse --git-common-dir');
    assert.ok(skill.includes('MAIN_ROOT'), 'finish must archive into the resolved main root');
    assert.ok(skill.includes('archive'), 'finish must keep the archive move');
  });
});

// ---------------------------------------------------------------------------
// dashboard template — Lanes placeholder
// ---------------------------------------------------------------------------

describe('multi-worktree — dashboard template', () => {
  it('carries the PM:LANES placeholder', () => {
    assert.ok(readSrc('ship/templates/dashboard.html').includes('<!-- PM:LANES -->'),
      'dashboard.html must carry the Lanes panel placeholder');
  });
});

// ---------------------------------------------------------------------------
// Lane ownership binding — the sweep reports each slug under one lane only
// ---------------------------------------------------------------------------

describe('multi-worktree — lane ownership doctrine', () => {
  it('ship-pm describes ownership binding and the unowned list', () => {
    const agent = readSrc('agents/ship-pm.md');
    assert.ok(agent.includes('unowned'), 'ship-pm must name the fleet-level unowned list');
    assert.ok(agent.includes('ownedBy'), 'ship-pm must name the ownedBy ownership reason');
    assert.ok(/at most one owning lane/i.test(agent),
      'the sweep bullet must state that a slug binds to at most one lane');
  });

  it('ship-pm forbids guessing an owner in the fleet view', () => {
    const agent = readSrc('agents/ship-pm.md');
    assert.ok(/never guess an owner/i.test(agent),
      'an unresolvable slug is reported unowned, never attributed to a lane');
    assert.ok(/unowned[\s\S]{0,400}Lane/i.test(agent),
      'the unowned reporting rule must tie back to the ROADMAP Lane column');
  });

  it('/ship:pm reports unowned features separately from lane rows', () => {
    const skill = readSrc('skills/pm/SKILL.md');
    assert.ok(skill.includes('unowned'), 'the brief must report unowned entries');
    assert.ok(/bound to at most one lane/i.test(skill),
      'per-lane rows must state the one-lane-per-slug binding, not merely mention ownership');
    assert.ok(/Only \*\*owned\*\* in-flight claims count/i.test(skill),
      'file-overlap judgement must be restricted to owned claims');
  });

  it('pm-state documents the CONTEXT.md lane stamp and its precedence', () => {
    const skill = readSrc('skills/pm-state/SKILL.md');
    assert.ok(skill.includes('lane: {branch} @ {worktree-path}'),
      'pm-state must document the CONTEXT.md lane stamp format');
    assert.ok(/branch match outranks it/i.test(skill),
      'a branch is a fleet-unique fact; the stamp is self-testimony and ranks below it');
    assert.ok(/pm-update\.cjs/.test(skill), 'pm-state must name the stamp writer');
  });

  it('pm-state keeps the Lane column blank for an unowned feature', () => {
    const skill = readSrc('skills/pm-state/SKILL.md');
    assert.ok(/unowned[\s\S]{0,200}never guess an owner/i.test(skill),
      'the Lane column definition must stay `—` for an unowned feature rather than guessing');
  });

  it('CLAUDE.md describes the ownership chain', () => {
    const claude = readSrc('CLAUDE.md');
    assert.ok(/binds each feature slug to at most one owning lane/i.test(claude),
      'the project-manager bullet must describe ownership binding');
    assert.ok(claude.includes('unowned') && claude.includes('ownedBy'),
      'CLAUDE.md must name both the unowned array and the ownedBy reason');
  });
});
