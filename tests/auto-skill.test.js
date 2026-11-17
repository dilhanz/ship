'use strict';

// Doctrine tests for the /ship:auto skill. The skill is a prompt, so these
// assert on its text and on the files it points at: a pointer that dangles
// (a renamed section, a moved reference) is the failure they exist to catch.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

// The text from a line-anchored heading up to (not including) the next line
// that matches `untilRe`, or to the end of the file.
function sliceFrom(text, startRe, untilRe) {
  const start = text.search(startRe);
  if (start === -1) return '';
  const rest = text.slice(start);
  const firstBreak = rest.indexOf('\n');
  const tail = rest.slice(firstBreak + 1);
  const end = untilRe ? tail.search(untilRe) : -1;
  return end === -1 ? rest : rest.slice(0, firstBreak + 1 + end);
}

function walkMarkdown(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const SKILL = 'skills/auto/SKILL.md';
const OVERRIDE_REASON =
  'automatic override by /ship:auto: the pull request is the review gate; the inconclusive criteria are listed in the PR body';

describe('/ship:auto skill — frontmatter and size', () => {
  const skill = readSrc(SKILL);
  const frontmatter = skill.slice(0, skill.indexOf('\n---', 4));

  it('is named auto with a "Use when" description', () => {
    assert.match(frontmatter, /^name: auto$/m);
    assert.match(frontmatter, /^description: Use when /m);
    assert.match(frontmatter, /^effort: high$/m);
  });

  it('has the tools the run needs', () => {
    assert.match(
      frontmatter,
      /^allowed-tools: Read, Write, Edit, WebSearch, WebFetch, Glob, Grep, Bash, AskUserQuestion, EnterWorktree, Skill, ToolSearch$/m
    );
  });

  it('the argument hint offers --profile and --fix-rounds, never --resume', () => {
    const hint = frontmatter.split('\n').find((l) => l.startsWith('argument-hint:'));
    assert.equal(
      hint,
      'argument-hint: "[\\"idea\\" | slug] [--profile <quick|standard|thorough>] [--fix-rounds <n>]"'
    );
    assert.doesNotMatch(hint, /--resume/);
  });

  it('stays under 20,000 bytes so it can be re-read whole after a compaction', () => {
    const bytes = Buffer.byteLength(skill, 'utf8');
    assert.ok(bytes < 20000, `skills/auto/SKILL.md is ${bytes} bytes`);
  });

  it('ends with the arguments placeholder', () => {
    assert.match(skill, /\n\$ARGUMENTS\n?$/);
  });
});

describe('/ship:auto skill — authorization', () => {
  const skill = readSrc(SKILL);

  it('states what invoking it authorizes', () => {
    assert.match(skill, /authorizes one push and one ready-for-review pull request/);
  });

  it('never merges, never force-pushes, never opens a draft', () => {
    assert.match(skill, /never merges/);
    assert.match(skill, /never force-pushes/);
    assert.match(skill, /never opens a draft/);
    assert.match(skill, /never pushes or opens a PR on a run that did not pass verification/);
  });

  it('says a harness permission prompt is outside its control', () => {
    assert.match(skill, /permission prompt on `git push` or `gh pr create`/);
    assert.match(skill, /outside this skill's control/);
  });
});

describe('/ship:auto skill — start, brainstorm, ledger, worktree', () => {
  const skill = readSrc(SKILL);
  const start = readSrc('skills/start/SKILL.md');
  const resolve = sliceFrom(skill, /^## Resolve the start$/m, /^## /m);
  const worktree = sliceFrom(skill, /^## New: worktree, no offer$/m, /^## /m);

  it('looks features up unfiltered across worktrees', () => {
    assert.ok(resolve.includes('node "${CLAUDE_PLUGIN_ROOT}/ship/find-features.cjs"'));
    assert.doesNotMatch(resolve, /find-features\.cjs" \{/);
  });

  it('covers the non-idea starts and the two dead ends', () => {
    assert.match(resolve, /in flight/i);
    assert.match(resolve, /`owner` is `ambiguous`/);
    assert.match(resolve, /`here` is false/);
    assert.match(resolve, /`EnterWorktree`/);
    assert.match(resolve, /one-liner verbatim/);
    assert.match(resolve, /already shipped/);
    assert.match(resolve, /not found/);
  });

  it('brainstorms inline from the shared reference, never in a subagent', () => {
    assert.ok(skill.includes('${CLAUDE_PLUGIN_ROOT}/skills/start/references/brainstorm.md'));
    assert.match(skill, /never in a subagent/i);
    assert.match(skill, /Do not create the feature directory before/);
    assert.ok(fs.existsSync(path.join(ROOT, 'skills/start/references/brainstorm.md')));
  });

  it('does not contain the ledger file name', () => {
    assert.ok(
      !skill.includes('LEDGER.md'),
      'skills/auto/SKILL.md names LEDGER.md — tests/ledger.test.js ("no other skill or agent ' +
        'writes LEDGER.md") and tests/worktree-aware-lookup.test.js ("the three-writers boundary ' +
        'holds") fail on any skill outside start / ledger / finish / help that contains it'
    );
  });

  it('no markdown file under skills/auto/ contains the ledger file name', () => {
    const offenders = walkMarkdown(path.join(ROOT, 'skills', 'auto'))
      .filter((f) => fs.readFileSync(f, 'utf8').includes('LEDGER.md'))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
    assert.deepEqual(offenders, []);
  });

  it("points at start's Ledger Row section, which still exists and still names the path", () => {
    assert.ok(skill.includes('skills/start/SKILL.md'));
    assert.ok(skill.includes('`## Ledger Row`'));
    const section = sliceFrom(start, /^## Ledger Row$/m, /^## /m);
    assert.notEqual(section, '', 'skills/start/SKILL.md lost its `## Ledger Row` heading');
    assert.ok(section.includes('$MAIN_ROOT/.planning/LEDGER.md'));
    assert.ok(section.includes('MAIN_ROOT=$(dirname "$(git rev-parse'));
  });

  it('gives the row format and the one difference from start', () => {
    assert.ok(skill.includes('- [ ] **{name}** — {one-line summary}'));
    assert.match(skill, /top of `## Now`/);
    assert.match(skill, /`## Shipped`[^\n]*without asking/);
  });

  it('creates the worktree with the same command as /ship:start', () => {
    const line = 'git worktree add -b feature/{name} "$MAIN_ROOT/.claude/worktrees/{name}" main';
    assert.ok(start.includes(line));
    assert.ok(worktree.includes(line));
  });

  it('asks nothing in the worktree section', () => {
    assert.notEqual(worktree, '');
    assert.doesNotMatch(worktree, /AskUserQuestion/);
    assert.match(worktree, /No question/);
    assert.match(worktree, /`\?\?`/);
    assert.match(worktree, /copy without removing/);
    assert.match(worktree, /open a session in the worktree and run `\/ship:auto \{name\}`/);
  });
});

describe('/ship:auto skill — run record, go, route, finish', () => {
  const skill = readSrc(SKILL);
  const go = readSrc('skills/go/SKILL.md');
  const finish = readSrc('skills/finish/SKILL.md');
  const noPrompt = sliceFrom(skill, /^## No-prompt rule$/m, /^## /m);
  const resume = sliceFrom(skill, /^## Resume a recorded workflow$/m, /^## /m);
  const route = sliceFrom(skill, /^## Route$/m, /^## /m);
  const finishSection = sliceFrom(skill, /^## Finish$/m, /^## /m);
  const stop = sliceFrom(skill, /^## Stop report$/m, /^## /m);

  it('records the run with the session id', () => {
    assert.ok(
      skill.includes(
        'node "${CLAUDE_PLUGIN_ROOT}/ship/auto-run.cjs" start {name} --session "${CLAUDE_SESSION_ID}"'
      )
    );
    assert.ok(fs.existsSync(path.join(ROOT, 'ship/auto-run.cjs')));
  });

  it('names NEEDS_INPUT as the only question', () => {
    assert.notEqual(noPrompt, '');
    assert.match(noPrompt, /only question[^\n]*`NEEDS_INPUT`/);
    assert.match(noPrompt, /Ready to build\?/);
    assert.match(noPrompt, /`NEEDS_CONTEXT`[^\n]*a stop/);
    assert.match(noPrompt, /Option 1 and `shipped`/);
    assert.match(noPrompt, /decided by `\/ship:auto`/);
  });

  it('invokes ship:go with --auto and never with --headless', () => {
    assert.match(skill, /`ship:go` with args `\{name\} --auto`/);
    assert.doesNotMatch(skill, /--headless/);
  });

  it('has a Route heading that go and finish both point at', () => {
    assert.match(skill, /^## Route$/m);
    assert.ok(go.includes('`## Route`'));
    assert.ok(finish.includes('`## Route`'));
  });

  it('decides fix rounds, plan rounds and the ending through the helper', () => {
    assert.ok(route.includes('auto-run.cjs" verdict {name} {count}'));
    assert.ok(route.includes('auto-run.cjs" bump {name} planRounds --cap 2'));
    assert.ok(stop.includes('auto-run.cjs" end {name}'));
  });

  it('Route checks stops before status, so a finish stop cannot loop back into Finish', () => {
    const stopRow = route.indexOf('**Stopped**');
    const doneRow = route.indexOf('**`done`**');
    assert.ok(stopRow !== -1 && doneRow !== -1);
    assert.ok(stopRow < doneRow);
    assert.match(route, /a finish stop/);
    assert.match(route, /null verdict/);
  });

  it('Route has the continue row', () => {
    assert.match(route, /`plan-verified` with no verify verdict yet/);
    assert.match(route, /`building` or `built`/);
    assert.match(route, /Run go/);
  });

  it('a lost build result on a done feature is set back to built', () => {
    assert.notEqual(resume, '');
    assert.match(resume, /do not launch another workflow/i);
    assert.match(resume, /already reads `done`, set it back to `built`/);
    assert.match(resume, /downgrade/);
  });

  it('reads the record before finish deletes it', () => {
    assert.ok(finishSection.includes('auto-run.cjs" get {name}'));
    assert.match(finishSection, /finish deletes the record/);
  });

  it('passes the automatic override reason to finish', () => {
    assert.ok(OVERRIDE_REASON.startsWith('automatic override by /ship:auto'));
    assert.ok(finishSection.includes(`--accept-inconclusive "${OVERRIDE_REASON}"`));
    assert.match(finish, /--accept-inconclusive "reason"/);
  });

  it('the final report carries the PR URL', () => {
    assert.match(finishSection, /## AUTO COMPLETE/);
    assert.match(finishSection, /PR: \{url\}/);
  });

  it('the stop report pushes nothing and says how to resume', () => {
    assert.match(stop, /## AUTO STOPPED/);
    assert.match(stop, /Push nothing/);
    assert.match(stop, /open no PR/);
    assert.match(stop, /Resume: \/ship:auto \{name\}/);
  });

  it('writes none of the headless files', () => {
    assert.doesNotMatch(skill, /OUTCOME\.json|QUESTIONS\.md/);
  });

  it('the headless contract still says finish is never invoked', () => {
    const contract = readSrc('ship/docs/headless.md');
    assert.match(contract, /^## 8\. Never-headless actions$/m);
    assert.ok(contract.includes('**`/ship:finish` is never invoked.**'));
  });
});
