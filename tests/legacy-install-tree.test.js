/**
 * Legacy `.claude/` install-tree guard.
 *
 * This repo once tracked the output of a v3.0.1 `npx github:dilhanz/ship` run:
 * `.claude/agents/`, `.claude/hooks/`, `.claude/skills/`, `.claude/ship/` and a
 * `.claude/settings.json` that registered five hooks by relative path plus a
 * statusLine. Those project-level definitions loaded alongside the installed
 * plugin's, so a session dogfooding Ship here exercised v3 while believing it
 * exercised v5. The tree was deleted — but `install.js` is still functional and
 * would restore it, so this test exists to fail loudly if it ever returns.
 *
 * Two deliberate omissions, so a later editor does not "fix" them for symmetry:
 *   - `.claude/settings.local.json` is NOT asserted. Claude Code recreates that
 *     file whenever a permission is granted in this repo and it is not
 *     gitignored, so a disk-absence assertion would go permanently red on any
 *     working copy. Its one-time removal was checked at deletion time instead.
 *   - The agent-memory survival case is conditional on `.claude/` existing at
 *     all. `.claude/` is gitignored and nothing under it is tracked any more,
 *     so a CI checkout has no such directory and an unconditional assertion
 *     would fail every run — the same reason the sibling
 *     `ship-ship-replanner/` and `ship-ship-reviewer/` directories were never
 *     asserted on. What survives the narrowing is the thing worth guarding: a
 *     careless `.claude*` glob that empties a tree which *is* present.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const exists = (rel) => fs.existsSync(path.join(repoRoot, rel));

// The four directories the v3.0.1 installer wrote. Add a fifth here if the
// installer's output ever grows.
const legacyDirs = [
  '.claude/agents',
  '.claude/hooks',
  '.claude/skills',
  '.claude/ship',
];

describe('legacy .claude/ install tree stays gone', () => {
  for (const rel of legacyDirs) {
    it(`${rel} is absent`, () => {
      assert.ok(
        !exists(rel),
        `${rel} is the v3.0.1 install output — it must not be committed; did install.js run in this repo?`,
      );
    });
  }

  it('.claude/settings.json is absent', () => {
    assert.ok(
      !exists('.claude/settings.json'),
      '.claude/settings.json is the activation mechanism — it registered five legacy hooks by relative path plus a statusLine; its presence re-enables the v3.0.1 tree',
    );
  });

  it('.claude/agent-memory/ship-ship-verifier survives', () => {
    // No `.claude/` at all is the CI shape, and nothing can have been lost
    // from a tree that is not there. Only a present-but-pruned tree is a
    // finding.
    if (!exists('.claude')) return;
    const rel = '.claude/agent-memory/ship-ship-verifier';
    const abs = path.join(repoRoot, rel);
    assert.ok(exists(rel), `${rel} is live plugin-era agent memory, not fossil — it must be preserved`);
    assert.ok(fs.statSync(abs).isDirectory(), `${rel} must be a directory`);
  });

  it('.claude-plugin/plugin.json is untouched', () => {
    // `.claude-plugin/` is a DIFFERENT directory from `.claude/` — the adjacent
    // path a careless `.claude*` glob would take out.
    assert.ok(exists('.claude-plugin/plugin.json'), '.claude-plugin/plugin.json is the live plugin manifest');
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude-plugin/plugin.json'), 'utf8'));
    assert.equal(manifest.name, 'ship', 'plugin manifest still names the ship plugin');
  });
});
