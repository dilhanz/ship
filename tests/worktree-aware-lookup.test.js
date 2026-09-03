/**
 * Worktree-aware lookup — the contract pins.
 *
 * 5.22.0 gave `/ship:ledger`, `/ship:status`, and `/ship:resume` one shared
 * helper (`ship/find-features.cjs`) that derives every feature's location from
 * `git worktree list --porcelain` on each read, so a feature whose directory
 * `/ship:start` moved into a worktree is visible from main and the ledger is
 * visible from the worktree. Two regressions would be invisible without an
 * assertion:
 *
 * 1. A consumer skill quietly reverting to a cwd-only glob — the prose still
 *    reads fine, the skill still works in the main checkout, and the blindness
 *    this release fixed comes back for exactly the sessions that build in a
 *    worktree.
 * 2. A hook becoming fleet-wide — `guide.cjs` and `post-compact.cjs` inject
 *    the state of the checkout the session is in; routing them through the
 *    helper would describe every worktree's features to every session.
 *
 * The behavioral coverage lives in `tests/find-features.test.js`; this file
 * pins the wiring and the boundaries around it.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(repoRoot, rel));
const allowedTools = (rel) => {
  const m = /^allowed-tools:\s*(.+)$/m.exec(readSrc(rel));
  assert.ok(m, `${rel} must declare allowed-tools`);
  return m[1];
};

// ---------------------------------------------------------------------------
// The helper
// ---------------------------------------------------------------------------

describe('worktree-aware lookup — the helper exists and mirrors resolve-profile', () => {
  const helper = 'ship/find-features.cjs';

  it('ship/find-features.cjs is present', () => {
    assert.ok(exists(helper), 'the three consumer skills shell out to this path');
  });

  it('never calls process.exit — stdout to a pipe can truncate on an explicit exit', () => {
    const code = readSrc(helper)
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    assert.ok(!/process\.exit\(/.test(code),
      'the skills read one JSON line through a pipe; the resolve-profile doctrine applies');
  });

  it('reuses scanFeatures for progress enrichment instead of re-parsing PLAN.md', () => {
    assert.match(readSrc(helper), /require\([^)]*scan-features\.cjs/,
      'task counts, current phase, and goal come from the one parser the hooks already trust');
  });

  it('does not read the vestigial lane field', () => {
    const c = readSrc(helper);
    assert.ok(!/parseLaneField/.test(c), 'parseLaneField has had no writer since 5.20.0');
    assert.ok(!/lane:/.test(c), 'location is derived from git, never from a stored lane');
  });

  it('does not resurrect the deleted lane machinery', () => {
    assert.ok(!/lane-sweep|pm-update|resolve-state-root/.test(readSrc(helper)),
      '5.20.0 removed these scripts; the helper is their replacement, not their revival');
  });
});

// ---------------------------------------------------------------------------
// The consumers
// ---------------------------------------------------------------------------

describe('worktree-aware lookup — three consumers call the helper', () => {
  const consumers = ['skills/ledger/SKILL.md', 'skills/status/SKILL.md', 'skills/resume/SKILL.md'];

  for (const rel of consumers) {
    it(`${rel} shells out to find-features.cjs`, () => {
      assert.match(readSrc(rel), /find-features\.cjs/,
        'a cwd-only glob cannot see a feature whose directory /ship:start moved into a worktree');
    });

    it(`${rel} declares Bash so it can run the helper`, () => {
      assert.ok(/\bBash\b/.test(allowedTools(rel)), 'the helper is a shell-out; there is no other way to call it');
    });
  }
});

describe('worktree-aware lookup — ledger', () => {
  const c = readSrc('skills/ledger/SKILL.md');

  it('resolves the main root through --git-common-dir', () => {
    assert.match(c, /--git-common-dir/, 'the same idiom /ship:finish uses; one ledger, at the main root');
  });

  it('targets $LEDGER for every read and edit', () => {
    assert.match(c, /\$LEDGER/, 'a relative .planning/LEDGER.md would be a worktree-local copy');
  });

  it('renders a remote feature as [{status} · {branch}]', () => {
    assert.match(c, /\[\{status\} · \{branch\}\]/, 'here-false rows carry the branch so the reader knows where the work is');
  });

  it('renders an ambiguous feature with its copy count', () => {
    assert.match(c, /copies/, 'several checkouts and no rule picking one is reported, never guessed');
  });

  it('forbids creating a second LEDGER.md in a linked worktree', () => {
    assert.match(c, /never create .*LEDGER\.md.* worktree/i, 'a second copy is a second ordering');
  });
});

describe('worktree-aware lookup — resume', () => {
  const rel = 'skills/resume/SKILL.md';
  const c = readSrc(rel);

  it('declares AskUserQuestion and EnterWorktree', () => {
    const tools = allowedTools(rel);
    assert.ok(/\bAskUserQuestion\b/.test(tools), 'the hop is offered, so the skill must be able to ask');
    assert.ok(/\bEnterWorktree\b/.test(tools), 'and able to relocate the session on yes');
  });

  it('offers EnterWorktree and never enters automatically', () => {
    assert.match(c, /EnterWorktree/, 'a feature in another worktree is entered through the tool, not by cd');
    assert.match(c, /never enter automatically/i, 'relocating the session is a side effect a read-shaped command must ask about');
  });
});

describe('worktree-aware lookup — status', () => {
  const rel = 'skills/status/SKILL.md';

  it('shows a Location column', () => {
    assert.match(readSrc(rel), /Location/, 'a feature in another worktree must say so, not blend in');
  });

  it('stays read-only', () => {
    assert.ok(!/\b(Write|Edit)\b/.test(allowedTools(rel)), 'status gained Bash for the helper and nothing that writes');
  });
});

describe('worktree-aware lookup — start', () => {
  const c = readSrc('skills/start/SKILL.md');

  it('writes the ledger row to the main root', () => {
    assert.match(c, /\$MAIN_ROOT\/\.planning\/LEDGER\.md/, 'the ledger indexes the project, not the branch');
  });

  it('derives MAIN_ROOT through --git-common-dir', () => {
    assert.match(c, /--git-common-dir/, 'one idiom across start, ledger, and finish');
  });

  it('still compares MAIN_ROOT to CWD_ROOT to skip the offer inside a worktree', () => {
    assert.match(c, /`MAIN_ROOT` != `CWD_ROOT`/, 'the worktree-inside-worktree guard survives the idiom change');
  });

  it('no longer derives the main root with the porcelain-awk pipeline', () => {
    assert.ok(!/worktree list --porcelain \| awk/.test(c), 'replaced by --git-common-dir; two idioms would drift');
  });
});

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

describe('worktree-aware lookup — hooks stay per-lane', () => {
  for (const rel of ['hooks/guide.cjs', 'hooks/post-compact.cjs']) {
    it(`${rel} calls scanFeatures(cwd) and not the helper`, () => {
      const c = readSrc(rel);
      assert.match(c, /scanFeatures\(/, 'the injected state describes the checkout the session is in');
      assert.ok(!/find-features/.test(c), 'routing a hook through the helper would make it fleet-wide');
    });
  }

  it('hooks/scan-features.cjs knows nothing about worktrees', () => {
    const c = readSrc('hooks/scan-features.cjs');
    assert.ok(!/find-features/.test(c), 'the dependency points one way: helper → scanFeatures');
    assert.ok(!/worktree list/.test(c), 'scanFeatures(cwd) is per-checkout by contract');
  });
});

describe('worktree-aware lookup — the three-writers boundary holds', () => {
  it('no skill or agent outside start/ledger/finish/help mentions LEDGER.md', () => {
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
          `${rel} must not touch LEDGER.md — status and resume read state through the helper, never the ledger file`);
      }
    }
  });
});

describe('worktree-aware lookup — CLAUDE.md documents the helper', () => {
  it('CLAUDE.md names ship/find-features.cjs', () => {
    assert.match(readSrc('CLAUDE.md'), /ship\/find-features\.cjs/, 'the Supporting Files block is the map of ship/');
  });

  it('the CHANGELOG has the 5.22.0 section', () => {
    assert.match(readSrc('CHANGELOG.md'), /^## 5\.22\.0/m, 'the release workflow extracts this section as the release notes');
  });
});
