/**
 * The ledger, and the PM layer it replaced.
 *
 * 5.20.0 removed ~6,000 lines of `.project-manager/` machinery — two skills, a
 * reference skill, an agent, three scripts, a hook, a dashboard template — and
 * put one ordered markdown file in its place. Two things need locking down:
 *
 * 1. The ledger's own contract: position is priority, a row carries a slug and
 *    a one-liner and nothing else, and exactly three writers touch the file
 *    (`/ship:ledger`, `/ship:start`, `/ship:finish`) with `/ship:finish` going
 *    through Bash because it has no Write or Edit tool.
 * 2. That the removal stayed removed. A PM reference reintroduced anywhere in
 *    the spine is the failure mode this guards — the deletion touched eight
 *    files that had no business knowing about a project manager, and a later
 *    edit restoring one line of it would go unnoticed without an assertion.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(repoRoot, rel));

const SECTIONS = ['## Now', '## Next', '## Someday', '## Shipped'];

// ---------------------------------------------------------------------------
// The ledger skill
// ---------------------------------------------------------------------------

describe('ledger — the skill exists and is user-invocable', () => {
  it('skills/ledger/SKILL.md is present with a bare name', () => {
    assert.ok(exists('skills/ledger/SKILL.md'), 'the ledger skill must exist');
    const c = readSrc('skills/ledger/SKILL.md');
    assert.match(c, /^name:\s*ledger\s*$/m, 'name must be the bare directory name — the loader adds the ship: prefix');
  });

  it('the description is trigger-shaped so semantic matching finds it', () => {
    const c = readSrc('skills/ledger/SKILL.md');
    const m = /^description:\s*(.+)$/m.exec(c);
    assert.ok(m, 'a description is required');
    assert.match(m[1], /Use when/i, 'descriptions use the "Use when..." trigger-condition format');
  });

  it('it declares the tools it actually needs and nothing that writes code', () => {
    const tools = /^allowed-tools:\s*(.+)$/m.exec(readSrc('skills/ledger/SKILL.md'))[1];
    for (const t of ['Read', 'Write', 'Edit', 'Glob']) {
      assert.ok(tools.includes(t), `ledger needs ${t}`);
    }
    assert.ok(!/\bAgent\b/.test(tools),
      'the ledger is a one-file edit — delegating it to a subagent is the weight this release removed');
  });
});

describe('ledger — format contract', () => {
  const c = readSrc('skills/ledger/SKILL.md');

  it('specifies the four fixed sections in priority order', () => {
    let cursor = -1;
    for (const heading of SECTIONS) {
      const i = c.indexOf(heading, cursor + 1);
      assert.ok(i > cursor, `${heading} must appear, after the section before it`);
      cursor = i;
    }
  });

  it('states that position is priority — there is no priority column', () => {
    assert.match(c, /\*\*Position is priority\.\*\*/,
      'the whole point of the file is that reordering is a line move');
    assert.ok(!/\bP0\b|\bP1\b|\bP2\b|\bP3\b/.test(c),
      'a P0-P3 key is the thing the ledger replaced — reintroducing it recreates the drift');
    assert.ok(!/\| Priority \|/.test(c), 'no priority column');
  });

  it('bans a status cell and reads status live from the feature folder instead', () => {
    assert.match(c, /\*\*No status cells\.\*\*/, 'the no-status-cell rule must be stated');
    assert.match(c, /CONTEXT\.md/, 'status comes from the feature folder frontmatter');
    assert.match(c, /Glob `\.planning\/features\/\*\/CONTEXT\.md`/,
      'the render step must glob the folders rather than trust the file');
  });

  it('sees features that /ship:start moved into a worktree, and edits the main-root ledger', () => {
    assert.match(c, /find-features\.cjs/,
      'status is resolved through the shared helper — a cwd-only glob cannot see a moved feature directory');
    assert.match(c, /\$LEDGER/, 'every read and edit targets the one resolved ledger path');
    assert.match(c, /--git-common-dir/,
      'the main root is derived from git on every call, the same idiom /ship:finish uses');
    assert.match(c, /\[\{status\} · \{branch\}\]/,
      'a feature living in another worktree renders its branch, not a bare status or a path');
  });

  it('names .planning/LEDGER.md as the one file it writes', () => {
    assert.match(c, /\.planning\/LEDGER\.md/, 'the path must be explicit');
    assert.match(c, /\*\*Write only `\.planning\/LEDGER\.md`\.\*\*/,
      'the write boundary is one file — that is what makes this cheap');
  });

  it('carries no time concepts', () => {
    assert.match(c, /\*\*No time concepts\.\*\*/, 'the no-time rule survives from pm-state');
    assert.ok(!/deadline|sprint|velocity|estimate/i.test(c.replace(/No time concepts.*/i, '')),
      'no deadlines, sprints, velocity, or estimates outside the rule that bans them');
  });

  it('a missing ledger is not an error, and an orphan is reported not fixed', () => {
    assert.match(c, /A missing `\.planning\/LEDGER\.md` is not an error/,
      'a project that has planned nothing has no ledger, which is correct');
    assert.match(c, /orphan/i, 'a folder with no row must be surfaced');
    assert.match(c, /never fix one silently/i,
      'silently adopting a stray folder would invent an ordering the user did not choose');
  });

  it('add lands at the bottom of ## Next, not the top of ## Now', () => {
    const add = c.slice(c.indexOf('**`add {text}`**'));
    assert.match(add.slice(0, 400), /bottom of `## Next`/,
      'new work is not assumed urgent — the user promotes it');
  });
});

// ---------------------------------------------------------------------------
// The three writers
// ---------------------------------------------------------------------------

describe('ledger — exactly three writers', () => {
  it('/ship:start puts the new feature at the top of ## Now', () => {
    const c = readSrc('skills/start/SKILL.md');
    assert.match(c, /## Ledger Row/, 'start must have its own ledger step');
    assert.match(c, /top of `## Now`/, 'a feature you just brainstormed is what you are working on now');
    assert.match(c, /leave its one-liner alone/,
      'an existing row was written by the user — brainstorming does not license rewriting it');
  });

  it('/ship:finish moves the row to ## Shipped through Bash, having no Write or Edit', () => {
    const c = readSrc('skills/finish/SKILL.md');
    const tools = /^allowed-tools:\s*(.+)$/m.exec(c)[1];
    assert.ok(!/\bWrite\b/.test(tools) && !/\bEdit\b/.test(tools),
      'finish is deliberately write-less; if that changes, the Bash ledger edit should change with it');
    assert.match(c, /## Close the Ledger Row/, 'finish must close the row it opened');
    assert.match(c, /top of `## Shipped`/, 'Shipped is ordered by recency');
    assert.match(c, /\$MAIN_ROOT\/\.planning\/LEDGER\.md/,
      'the ledger lives at the main root — a linked worktree must not write its own copy');
    assert.match(c, /On \*\*Option 3 \(keep as-is\)\*\*/,
      'a feature kept in flight has not shipped and its row must not move');
  });

  it('no other skill or agent writes LEDGER.md', () => {
    const roots = ['skills', 'agents'];
    const allowed = new Set([
      'skills/ledger/SKILL.md',
      'skills/start/SKILL.md',
      'skills/finish/SKILL.md',
      'skills/help/SKILL.md', // names the command; does not write the file
    ]);
    for (const root of roots) {
      const dir = path.join(repoRoot, root);
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(d, e.name);
        return e.isDirectory() ? walk(full) : [full];
      });
      for (const full of walk(dir)) {
        if (!full.endsWith('.md')) continue;
        const rel = path.relative(repoRoot, full);
        if (allowed.has(rel)) continue;
        assert.ok(!/LEDGER\.md/.test(fs.readFileSync(full, 'utf8')),
          `${rel} must not touch LEDGER.md — the ordering has three writers and no more`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Brainstorm in main, build in a worktree
// ---------------------------------------------------------------------------

describe('start — the worktree handoff', () => {
  const c = readSrc('skills/start/SKILL.md');

  it('offers the worktree once CONTEXT.md exists', () => {
    assert.match(c, /## Offer the Worktree/, 'the handoff point is after brainstorming, before planning');
    assert.ok(c.indexOf('## Ledger Row') < c.indexOf('## Offer the Worktree'),
      'the ledger row is written before the session leaves for the worktree');
  });

  it('declares the tools the offer needs', () => {
    const tools = /^allowed-tools:\s*(.+)$/m.exec(c)[1];
    assert.ok(/AskUserQuestion/.test(tools), 'the offer is a question, not an assumption');
    assert.ok(/EnterWorktree/.test(tools), 'entering the worktree needs the tool');
  });

  it('skips itself when already inside a worktree', () => {
    assert.match(c, /MAIN_ROOT.*!=.*CWD_ROOT|MAIN_ROOT` != `CWD_ROOT/,
      'a session already in a lane must not nest another worktree');
  });

  it('only removes the source directory when it is entirely untracked', () => {
    assert.match(c, /every line begins `\?\?`/,
      'the rm is safe only against an untracked directory — otherwise copy');
    assert.match(c, /copy without removing/,
      'a tracked feature directory keeps its copy in the main checkout');
  });

  it('leaves the ledger in the main checkout', () => {
    assert.match(c, /stays in the main checkout and is \*\*not\*\* carried across/,
      'the ledger indexes the project, not the branch');
  });
});

// ---------------------------------------------------------------------------
// The PM layer stayed removed
// ---------------------------------------------------------------------------

describe('5.20.0 — the PM layer is gone and stays gone', () => {
  const REMOVED = [
    'skills/pm/SKILL.md',
    'skills/pm-sync/SKILL.md',
    'skills/pm-state/SKILL.md',
    'agents/ship-pm.md',
    'ship/pm-update.cjs',
    'ship/lane-sweep.cjs',
    'ship/resolve-state-root.cjs',
    'hooks/pm-sync-nudge.cjs',
    'ship/templates/dashboard.html',
  ];

  it('every PM file is absent from the tree', () => {
    for (const rel of REMOVED) {
      assert.ok(!exists(rel), `${rel} was removed in 5.20.0 and must not return`);
    }
  });

  it('the agent roster is six, with no ship-pm', () => {
    const agents = fs.readdirSync(path.join(repoRoot, 'agents')).filter((f) => f.endsWith('.md')).sort();
    assert.equal(agents.length, 6, 'six agents survive the PM removal');
    assert.ok(!agents.includes('ship-pm.md'), 'the PM agent is gone');
  });

  it('the hook registration drops pm-sync-nudge but keeps the other four', () => {
    const hooks = JSON.parse(readSrc('hooks/hooks.json'));
    const commands = JSON.stringify(hooks);
    assert.ok(!/pm-sync-nudge/.test(commands), 'the nudge hook is unregistered');
    for (const h of ['guide.cjs', 'context-monitor.cjs', 'safety-gate.cjs', 'post-compact.cjs', 'statusline.cjs']) {
      assert.ok(commands.includes(h), `${h} must still be registered`);
    }
  });

  it('no PM vocabulary survives anywhere in the shipped tree', () => {
    const roots = ['skills', 'agents', 'ship', 'hooks'];
    // `.project-manager` and its verbs. Matched as whole tokens so an unrelated
    // word containing "pm" (or a legitimate `/ship:plan`) never trips this.
    const banned = /\.project-manager|pm-update|pm-sync|lane-sweep|resolve-state-root|PM-HANDOFF|ship-pm|\/ship:pm\b/;
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(d, e.name);
      return e.isDirectory() ? walk(full) : [full];
    });
    for (const root of roots) {
      for (const full of walk(path.join(repoRoot, root))) {
        if (!/\.(md|js|cjs|json|html)$/.test(full)) continue;
        const rel = path.relative(repoRoot, full);
        const c = fs.readFileSync(full, 'utf8');
        const m = banned.exec(c);
        assert.ok(!m, `${rel} still references the removed PM layer ("${m && m[0]}")`);
      }
    }
  });
});

describe('5.20.0 — the DEFERRED verdict went with it', () => {
  it('the verifier has three verdicts, not four', () => {
    const c = readSrc('agents/ship-verifier.md');
    assert.ok(!/DEFERRED/.test(c), 'DEFERRED existed only to route around shared PM state');
    for (const v of ['PASS', 'FAIL', 'INCONCLUSIVE']) {
      assert.ok(c.includes(v), `${v} must survive`);
    }
    assert.ok(!/pm_handoff/.test(c), 'the handoff field is gone from the result shape');
  });

  it('the go workflow schema enumerates three verdicts', () => {
    const c = readSrc('ship/workflows/go.workflow.js');
    assert.match(c, /status: \{ enum: \['PASS', 'FAIL', 'INCONCLUSIVE'\] \}/,
      'the overall verdict enum must be exactly the three');
    assert.match(c, /verdict: \{ enum: \['PASS', 'FAIL', 'INCONCLUSIVE'\] \}/,
      'the per-criterion enum must match');
    assert.ok(!/pm_handoff|criteria_deferred/.test(c), 'no deferral fields survive in the schema');
  });

  it('the VERIFY.md template offers three verdicts and no PM Handoff section', () => {
    const c = readSrc('ship/templates/VERIFY.md');
    assert.ok(!/DEFERRED/.test(c), 'the template must not offer a verdict the verifier cannot emit');
    assert.ok(!/## PM Handoff/.test(c), 'the handoff table is gone');
    assert.match(c, /### Carried Review Findings/,
      'the carried-findings table is unrelated to the PM removal and must survive');
  });

  it('the headless contract lists 11 outcomes with deferred removed', () => {
    const c = readSrc('ship/docs/headless.md');
    assert.match(c, /exactly one of these 11 outcomes/, 'the count moves with the vocabulary');
    assert.ok(!/^\| `deferred` \|/m.test(c), 'the deferred outcome row is gone');
    assert.ok(!/handoff_file/.test(c), 'the handoff field is gone from OUTCOME.json');
    assert.match(c, /One of the 11 outcome words above\./, 'the field description agrees with the table');
  });

  it('the builder no longer carries a shared-PM-state escape hatch', () => {
    const c = readSrc('agents/ship-builder.md');
    assert.ok(!/Shared PM State/.test(c), 'the defer-dont-fight section is gone');
    assert.match(c, /## Fix Scope Boundary/, 'the section that followed it must survive the cut');
    assert.match(c, /## Turn Budget/, 'and the one before it');
  });
});

describe('5.22.0 — version agreement', () => {
  it('VERSION, package.json, and plugin.json all read 5.22.0', () => {
    assert.equal(readSrc('ship/VERSION').trim(), '5.22.0');
    assert.equal(JSON.parse(readSrc('package.json')).version, '5.22.0');
    assert.equal(JSON.parse(readSrc('.claude-plugin/plugin.json')).version, '5.22.0');
  });

  it('the CHANGELOG documents the release', () => {
    const c = readSrc('CHANGELOG.md');
    assert.match(c, /^## 5\.22\.0/m, 'the release workflow extracts this section as the release notes');
  });
});
