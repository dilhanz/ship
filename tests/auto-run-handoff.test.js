'use strict';

// Doctrine tests for the auto-run handoff blocks: the short sections in the go
// and finish skills that apply only when /ship:auto invoked them. They assert
// on skill text, and on the surrounding text that must stay as it was.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readSrc = (rel) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

// The text from a line-anchored start marker up to (not including) the next
// line that matches `until`, or to the end of the file.
function sliceFrom(text, startRe, untilRe) {
  const start = text.search(startRe);
  if (start === -1) return '';
  const rest = text.slice(start);
  const firstBreak = rest.indexOf('\n');
  const tail = rest.slice(firstBreak + 1);
  const end = untilRe ? tail.search(untilRe) : -1;
  return end === -1 ? rest : rest.slice(0, firstBreak + 1 + end);
}

describe('auto-run handoff — go', () => {
  const go = readSrc('skills/go/SKILL.md');
  const lines = go.split('\n');
  const block = lines.find((l) => l.startsWith('**Auto run (`/ship:auto` only).**')) || '';
  const section6b = sliceFrom(go, /^## 6b\. Headless Fix Rounds$/m, /^## /m);
  const section7 = sliceFrom(go, /^## 7\. Finish \(interactive\)$/m, /^\$ARGUMENTS$/m);
  const section7Sentence =
    section7.split('\n').find((l) => /auto run/i.test(l) && l.includes('## Route')) || '';

  it('the block exists, after the --headless intro and before the workflow wait', () => {
    assert.notEqual(block, '', 'no paragraph headed **Auto run (`/ship:auto` only).**');
    const at = go.indexOf(block);
    assert.ok(at > go.indexOf('Pass `--headless` for unattended runs'));
    assert.ok(at < go.indexOf('### Headless workflow wait'));
  });

  it('is gated on invocation by the auto skill plus the run record', () => {
    assert.match(block, /`\/ship:auto` skill invoked this skill in this session/);
    assert.match(block, /\.planning\/features\/\{name\}\/AUTO\.json/);
    assert.match(block, /No flag selects it/);
  });

  it('states a direct /ship:go never enters it', () => {
    assert.match(block, /a direct `\/ship:go` never enters it/);
  });

  it('records and clears the workflow in the run record', () => {
    assert.ok(
      block.includes(
        'node "${CLAUDE_PLUGIN_ROOT}/ship/auto-run.cjs" workflow {name} {plan|build} {task-id}'
      )
    );
    assert.ok(
      block.includes('node "${CLAUDE_PLUGIN_ROOT}/ship/auto-run.cjs" workflow {name} clear')
    );
  });

  it('stays an interactive --auto run: no headless files, NEEDS_INPUT still asked', () => {
    assert.match(block, /interactive `--auto` run/);
    assert.match(block, /no OUTCOME\.json/);
    assert.match(block, /no QUESTIONS\.md/);
    assert.match(block, /`NEEDS_INPUT` is still asked/);
  });

  it('makes no finish offer and hands the ending to the auto skill Route section', () => {
    assert.match(block, /section 7 makes no offer/);
    assert.match(block, /`\/ship:finish` is not invoked from here/);
    assert.match(block, /`## Route`/);
    assert.match(block, /do not end on a recommendation/);
  });

  it('a manual-mode builder NEEDS_CONTEXT is a stop, not a question', () => {
    assert.match(block, /No-prompt rule/);
    assert.match(block, /builder `NEEDS_CONTEXT` is not asked/);
  });

  it('leaves section 6b headless-only', () => {
    assert.match(block, /Section 6b stays headless-only/);
    assert.ok(section6b.includes('Applies only under `--headless`'));
    assert.ok(section6b.includes('Interactive runs skip this section'));
    assert.doesNotMatch(section6b, /ship:auto|AUTO\.json|auto run/i);
  });

  it('adds no flag: the argument hint is unchanged', () => {
    const hint = lines.find((l) => l.startsWith('argument-hint:'));
    assert.equal(
      hint,
      'argument-hint: "[feature-name] [--auto] [--headless] [--profile <quick|standard|thorough>] [--fix-rounds <n>] [--build-mode <per-task|per-phase>]"'
    );
    assert.doesNotMatch(hint, /--resume|--auto-run|--from-auto/);
    assert.doesNotMatch(go, /--resume\b/);
  });

  it('section 7 keeps its go-ahead rule and gains the auto-run sentence', () => {
    assert.ok(section7.includes("Do not finish automatically without the user's go-ahead"));
    assert.notEqual(section7Sentence, '', 'section 7 has no auto-run sentence naming ## Route');
    assert.match(section7Sentence, /make no offer/);
  });

  it('the whole addition is under 1,500 bytes', () => {
    const bytes = Buffer.byteLength(block, 'utf8') + Buffer.byteLength(section7Sentence, 'utf8');
    assert.ok(bytes > 0);
    assert.ok(bytes < 1500, `auto-run text is ${bytes} bytes`);
  });
});
