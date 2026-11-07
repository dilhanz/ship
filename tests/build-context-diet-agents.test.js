'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : '';
}

describe('build-context-diet — builder agent', () => {
  const c = readSrc('agents/ship-builder.md');

  it('carries brief mode, the tick script, output discipline and verify evidence', () => {
    assert.ok(c.includes('Brief mode'), 'brief mode must be described');
    assert.ok(c.includes('ship/tick.cjs'), 'the tick script must be named');
    assert.match(c, /^## Output Discipline$/m, 'an Output Discipline section must exist');
    assert.ok(c.includes('verify_evidence'), 'the build_result example must carry verify_evidence');
  });

  it('brief mode replaces PLAN.md, CONTEXT.md and the checklist', () => {
    const start = c.indexOf('**Brief mode.**');
    assert.ok(start >= 0);
    const para = c.slice(start, c.indexOf('\n\n', start));
    assert.match(para, /PLAN\.md, CONTEXT\.md and the checklist file/);
    assert.match(para, /do not read those/);
  });

  it('step 5 runs the tick command before any Edit fallback', () => {
    const start = c.indexOf('5. **Mark done**');
    assert.ok(start >= 0, 'step 5 must exist');
    const end = c.indexOf('\n6. ', start);
    const step = c.slice(start, end);
    const tick = step.indexOf('ship/tick.cjs');
    const edit = step.indexOf('with Edit');
    assert.ok(tick >= 0, 'step 5 must give the tick command');
    assert.ok(edit > tick, 'the hand-edit path is a fallback after the tick command');
    assert.match(step, /Only if the script itself is missing/);
    assert.match(step, /Never `sed` PLAN\.md/);
    assert.match(step, /Never set `status="done"` on a task while any task in its `depends` list is still pending/,
      'the depends rule sentence is kept');
  });

  it('output discipline sits after Turn Budget and before Fix Scope Boundary', () => {
    const tb = c.indexOf('## Turn Budget');
    const od = c.indexOf('## Output Discipline');
    const fs2 = c.indexOf('## Fix Scope Boundary');
    assert.ok(tb < od && od < fs2);
    const section = c.slice(od, fs2);
    assert.match(section, /tail/);
    assert.match(section, /Never `cat`/);
    assert.match(section, /re-reads the whole accumulated context/);    assert.match(section, /set -o pipefail; \{cmd\} 2>&1 \| tail -40/, 'truncation keeps the exit status');
    assert.doesNotMatch(section, /or `2>&1 \| tail -40`/, 'no bare tail pipeline that masks exit codes');
  });

  it('frontmatter maxTurns: 60 is unchanged', () => {
    assert.match(frontmatter(c), /^maxTurns: 60$/m);
  });
});

describe('build-context-diet — reviewer agent', () => {
  const c = readSrc('agents/ship-reviewer.md');

  it('carries package mode, the package script and output discipline', () => {
    assert.ok(c.includes('Package mode'), 'package mode must be described');
    assert.ok(c.includes('review-package.cjs'), 'the package script must be named');
    assert.match(c, /^## Output Discipline$/m, 'an Output Discipline section must exist');
  });

  it('Step 1b still runs in package mode', () => {
    const start = c.indexOf('**Package mode.**');
    assert.ok(start >= 0);
    const block = c.slice(start, c.indexOf('## Step 0', start));
    assert.match(block, /Step 1b still runs in package mode/);
    assert.match(block, /do not re-run any verify command the evidence shows exiting 0/);
    assert.match(block, /`verify_runs` holds only commands you ran/);
    assert.match(block, /run the coverage check below \*\*first\*\*, then run the package command once with the final range/);
    assert.match(block, /plus any task an earlier run finished/);
    const od = c.slice(c.indexOf('## Output Discipline'), c.indexOf('## Re-Reviews'));
    assert.match(od, /set -o pipefail;/, 'reviewer truncation keeps the exit status');
  });

  it('the HARD-GATE allows the package file as the only other write', () => {
    const gate = c.slice(c.indexOf('<HARD-GATE>'), c.indexOf('</HARD-GATE>'));
    assert.match(gate, /package-\{scope\}\.md/);
  });

  it('frontmatter maxTurns: 60 is unchanged', () => {
    assert.match(frontmatter(c), /^maxTurns: 60$/m);
  });
});
