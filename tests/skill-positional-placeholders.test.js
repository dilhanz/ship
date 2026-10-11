/**
 * Skill bodies must not contain `$<digit>`.
 *
 * Claude Code substitutes `$0`, `$1`, … in a skill body with the
 * whitespace-split invocation arguments before the model reads it, exactly as
 * it does `$ARGUMENTS`. A `$1` regex backreference in a code example therefore
 * arrives as whatever the second argument word happened to be. In the field,
 * `/ship:finish verify-checklist-gate — user chose: create PR …` turned the
 * finish skill's `"$1\npr: "` into `"—\npr: "`, which would have overwritten
 * CONTEXT.md's `status:` line with a dash. Shell `$1` and awk `$1` are hit the
 * same way. Use a replacer function or a named variable instead.
 *
 * Tests that execute a skill's snippet read the bytes on disk, before
 * substitution, so they cannot catch this; this scan is the guard.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS = path.join(__dirname, '..', 'skills');

describe('skill bodies carry no positional placeholders', () => {
  const files = fs
    .readdirSync(SKILLS)
    .map((d) => path.join(SKILLS, d, 'SKILL.md'))
    .filter((f) => fs.existsSync(f));

  it('finds the skills to scan', () => {
    assert.ok(files.length > 0, 'expected skills/*/SKILL.md files');
  });

  for (const file of files) {
    it(path.relative(path.join(SKILLS, '..'), file), () => {
      const hits = fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /\$\d/.test(line))
        .map(({ line, n }) => `${n}: ${line.trim()}`);
      assert.deepEqual(
        hits,
        [],
        'the skill loader replaces $<digit> with an invocation argument word'
      );
    });
  }
});
