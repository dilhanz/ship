/**
 * Skill namespacing invariant.
 *
 * The plugin system derives a skill's slash command from the plugin name plus
 * the SKILL.md `name:` field. A `ship:` prefix in that field is applied twice —
 * once by the author, once by the loader — and the command surfaces as
 * `/ship:ship-go` instead of `/ship:go`. The name must be the bare directory
 * name and nothing else.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const skillDirs = fs.readdirSync(path.join(repoRoot, 'skills'))
  .filter((d) => fs.existsSync(path.join(repoRoot, 'skills', d, 'SKILL.md')));

const nameField = (dir) => {
  const c = fs.readFileSync(path.join(repoRoot, 'skills', dir, 'SKILL.md'), 'utf8');
  const m = c.match(/^name:\s*(.+)$/m);
  return m ? m[1].trim() : null;
};

describe('skill namespacing', () => {
  it('every skill carries a name: field', () => {
    assert.ok(skillDirs.length >= 17, 'skills/ holds the full skill set');
    for (const dir of skillDirs) {
      assert.ok(nameField(dir), `skills/${dir}/SKILL.md has a name: line`);
    }
  });

  it('no skill name carries the plugin prefix — the loader adds it', () => {
    for (const dir of skillDirs) {
      const name = nameField(dir);
      assert.ok(!name.startsWith('ship:'), `skills/${dir}/SKILL.md name "${name}" must not be prefixed with "ship:"`);
      assert.ok(!name.includes(':'), `skills/${dir}/SKILL.md name "${name}" must not contain a namespace separator`);
    }
  });

  it('every skill name matches its directory', () => {
    for (const dir of skillDirs) {
      assert.equal(nameField(dir), dir, `skills/${dir}/SKILL.md name matches its directory`);
    }
  });
});
