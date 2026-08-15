/**
 * PM handoff — the deferred-to-PM outcome for lanes that cannot write shared
 * .project-manager/ state.
 *
 * Two halves:
 *
 * - **Mechanical** — parseHandoff/laneHandoffs unit coverage, plus a live
 *   two-worktree sweep proving pendingHandoffs is collected across lanes and
 *   survives the case a deferred feature creates: status `done`, which
 *   scanFeatures drops.
 * - **Doctrine** — the DEFERRED verdict must never become a FAIL or a Fix
 *   Task, the handoff must always be written, and the record must not be
 *   pruned away with its lane.
 *
 * Scoped to the canonical `skills/`, `agents/`, and `ship/` trees only —
 * never the legacy `.claude/` mirrors.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { parseHandoff, laneHandoffs, sweep } = require(path.join(ROOT, 'ship', 'lane-sweep.cjs'));

// Normalize CRLF so line-based assertions hold on Windows checkouts.
const readSrc = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const gitAvailable = (() => {
  try {
    return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
  } catch (e) {
    return false;
  }
})();

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed:\n${r.stderr}`);
  return r.stdout;
}

/** A well-formed handoff document. */
function handoffDoc({ feature, applied = 'no', edits = 1 }) {
  const blocks = [];
  for (let i = 1; i <= edits; i++) {
    blocks.push(
      `### ${i}. Add backlog row ${i}\n\n` +
      `- **File:** .project-manager/ROADMAP.md\n` +
      `- **Criterion:** acceptance criterion ${i}\n` +
      `- **Intent:** record the shipped capability\n` +
      `- **Proposed content:** | Item ${i} | in-progress | P1 | M | — | src | ${feature} |\n`
    );
  }
  return (
    `---\nfeature: ${feature}\nlane: feat/${feature} @ /lanes/${feature}\n` +
    `head: ${'a'.repeat(40)}\nraised: 2026-08-15\napplied: ${applied}\n---\n\n` +
    `# PM Handoff — ${feature}\n\n## Requested Edits\n\n${blocks.join('\n')}`
  );
}

// ---------------------------------------------------------------------------
// parseHandoff
// ---------------------------------------------------------------------------

describe('pm-handoff — parseHandoff', () => {
  it('parses a well-formed pending handoff', () => {
    const parsed = parseHandoff(handoffDoc({ feature: 'alpha', edits: 2 }));
    assert.ok(parsed, 'a well-formed handoff must parse');
    assert.equal(parsed.feature, 'alpha');
    assert.equal(parsed.applied, false);
    assert.equal(parsed.raised, '2026-08-15');
    assert.deepEqual(parsed.summaries, ['Add backlog row 1', 'Add backlog row 2']);
  });

  it('treats only the literal `yes` as applied', () => {
    assert.equal(parseHandoff(handoffDoc({ feature: 'a', applied: 'yes' })).applied, true);

    // Anything else is pending — a malformed stamp must never hide real work.
    for (const value of ['Yes', 'YES', 'true', 'applied', 'y', '']) {
      assert.equal(
        parseHandoff(handoffDoc({ feature: 'a', applied: value })).applied,
        false,
        `applied: "${value}" must count as pending, not applied`
      );
    }
  });

  it('a missing `applied` key is pending, not applied', () => {
    const doc = `---\nfeature: alpha\nraised: 2026-08-15\n---\n\n### 1. Something\n`;
    const parsed = parseHandoff(doc);
    assert.ok(parsed);
    assert.equal(parsed.applied, false, 'absent stamp defaults to pending');
  });

  it('rejects documents that are not handoffs', () => {
    assert.equal(parseHandoff(''), null, 'empty content is not a handoff');
    assert.equal(parseHandoff(null), null, 'null content is not a handoff');
    assert.equal(parseHandoff('# Just a heading\n'), null, 'no frontmatter is not a handoff');
    assert.equal(
      parseHandoff('---\nlane: x\napplied: no\n---\n'),
      null,
      'frontmatter without `feature` is not a handoff'
    );
  });

  it('tolerates CRLF and quoted frontmatter values', () => {
    const doc = '---\r\nfeature: "alpha"\r\napplied: \'no\'\r\n---\r\n\r\n### 1. Row\r\n';
    const parsed = parseHandoff(doc);
    assert.ok(parsed, 'CRLF frontmatter must parse');
    assert.equal(parsed.feature, 'alpha', 'surrounding quotes are stripped');
    assert.equal(parsed.applied, false);
    assert.deepEqual(parsed.summaries, ['Row']);
  });

  it('ignores headings that are not numbered edit blocks', () => {
    const doc =
      '---\nfeature: alpha\napplied: no\n---\n\n' +
      '### Notes\n\n### 1. Real edit\n\n#### 2. Too deep\n\n### 2. Second edit\n';
    assert.deepEqual(parseHandoff(doc).summaries, ['Real edit', 'Second edit']);
  });
});

// ---------------------------------------------------------------------------
// laneHandoffs
// ---------------------------------------------------------------------------

describe('pm-handoff — laneHandoffs', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-handoff-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeHandoff = (kind, feature, opts) => {
    const featureDir = path.join(dir, '.planning', kind, feature);
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(
      path.join(featureDir, 'PM-HANDOFF.md'),
      handoffDoc({ feature, ...opts })
    );
  };

  it('returns nothing when there is no .planning tree', () => {
    assert.deepEqual(laneHandoffs(dir), []);
  });

  it('collects handoffs from both features/ and archive/', () => {
    writeHandoff('features', 'alpha', {});
    writeHandoff('archive', 'beta', { applied: 'yes' });

    const found = laneHandoffs(dir);
    assert.equal(found.length, 2);

    const alpha = found.find((h) => h.feature === 'alpha');
    const beta = found.find((h) => h.feature === 'beta');
    assert.equal(alpha.archived, false);
    assert.equal(alpha.applied, false);
    assert.equal(beta.archived, true, 'archive/ entries are flagged archived');
    assert.equal(beta.applied, true);
  });

  it('skips feature directories with no handoff', () => {
    fs.mkdirSync(path.join(dir, '.planning', 'features', 'plain'), { recursive: true });
    writeHandoff('features', 'alpha', {});
    assert.deepEqual(laneHandoffs(dir).map((h) => h.feature), ['alpha']);
  });

  it('skips a PM-HANDOFF.md that does not parse rather than throwing', () => {
    const featureDir = path.join(dir, '.planning', 'features', 'broken');
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, 'PM-HANDOFF.md'), 'not a handoff at all\n');
    assert.deepEqual(laneHandoffs(dir), []);
  });

  it('reports forward-slash paths', () => {
    writeHandoff('features', 'alpha', {});
    assert.ok(
      laneHandoffs(dir)[0].path.includes('/.planning/features/alpha/PM-HANDOFF.md'),
      'paths are normalized to forward slashes'
    );
  });
});

// ---------------------------------------------------------------------------
// sweep — pendingHandoffs across live worktrees
// ---------------------------------------------------------------------------

describe('pm-handoff — sweep collects pendingHandoffs across lanes', { skip: !gitAvailable }, () => {
  let base, main, lane;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-handoff-sweep-'));
    main = path.join(base, 'main');
    lane = path.join(base, 'lane');

    fs.mkdirSync(main, { recursive: true });
    git(main, 'init');
    git(main, 'config', 'user.email', 'test@example.com');
    git(main, 'config', 'user.name', 'Ship Test');
    git(main, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(main, '.gitignore'), '.planning/\n.project-manager/\n');
    git(main, 'add', '.gitignore');
    git(main, 'commit', '-m', 'init');
    git(main, 'worktree', 'add', '-b', 'feat/alpha', lane);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  const addFeature = (dir, name, status, handoffOpts) => {
    const featureDir = path.join(dir, '.planning', 'features', name);
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(
      path.join(featureDir, 'CONTEXT.md'),
      `---\nfeature: "${name}"\nstatus: ${status}\n---\n\n## Problem\n\nTest.\n`
    );
    if (handoffOpts) {
      fs.writeFileSync(
        path.join(featureDir, 'PM-HANDOFF.md'),
        handoffDoc({ feature: name, ...handoffOpts })
      );
    }
  };

  it('surfaces a pending handoff raised in a linked lane', () => {
    addFeature(lane, 'alpha', 'built', { edits: 2 });

    const result = sweep(main);
    assert.equal(result.pendingHandoffs.length, 1);

    const pending = result.pendingHandoffs[0];
    assert.equal(pending.feature, 'alpha');
    assert.equal(pending.branch, 'feat/alpha');
    assert.equal(pending.isMain, false, 'the handoff is attributed to the lane, not main');
    assert.equal(pending.summaries.length, 2);
  });

  it('still reports a handoff on a feature whose status is done', () => {
    // This is the whole point: DEFERRED sets CONTEXT.md status to `done`, and
    // scanFeatures drops done features. Keying handoff discovery off the
    // feature scan would hide exactly the case this exists to surface.
    addFeature(lane, 'alpha', 'done', { edits: 1 });

    const result = sweep(main);
    const laneRecord = result.lanes.find((l) => l.branch === 'feat/alpha');
    assert.equal(laneRecord.features.length, 0, 'a done feature is not an active feature');
    assert.equal(result.pendingHandoffs.length, 1, 'but its pending handoff is still reported');
    assert.equal(result.pendingHandoffs[0].feature, 'alpha');
  });

  it('omits handoffs already stamped applied', () => {
    addFeature(lane, 'alpha', 'done', { applied: 'yes' });

    const result = sweep(main);
    assert.equal(result.pendingHandoffs.length, 0, 'applied handoffs are not pending');
    assert.equal(
      result.lanes.find((l) => l.branch === 'feat/alpha').handoffs.length,
      1,
      'but the lane still records it'
    );
  });

  it('collects handoffs from several lanes at once', () => {
    const second = path.join(base, 'lane2');
    git(main, 'worktree', 'add', '-b', 'feat/beta', second);
    addFeature(lane, 'alpha', 'done', { edits: 1 });
    addFeature(second, 'beta', 'built', { edits: 3 });
    addFeature(main, 'gamma', 'built', { edits: 1 });

    const features = sweep(main).pendingHandoffs.map((h) => h.feature).sort();
    assert.deepEqual(features, ['alpha', 'beta', 'gamma']);
  });

  it('degrades to an empty pendingHandoffs list outside a git repo', () => {
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-nonrepo-'));
    try {
      const result = sweep(nonRepo);
      assert.deepEqual(result.pendingHandoffs, [], 'never undefined — callers iterate it directly');
      assert.ok(result.error, 'the degrade is reported');
    } finally {
      fs.rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Doctrine — the verifier's DEFERRED verdict
// ---------------------------------------------------------------------------

describe('pm-handoff doctrine — ship-verifier', () => {
  const verifier = readSrc('agents/ship-verifier.md');

  it('defines DEFERRED as a per-criterion verdict', () => {
    assert.ok(verifier.includes('DEFERRED'), 'the verifier must define the DEFERRED verdict');
    assert.match(verifier, /\*\*DEFERRED\*\*/, 'DEFERRED is listed among the criterion verdicts');
  });

  it('forbids writing a Fix Task for a deferred criterion', () => {
    assert.match(
      verifier,
      /Never write a Fix Task for a DEFERRED criterion/,
      'the no-fix-task rule is the point of the verdict — it must be stated outright'
    );
  });

  it('obliges the verifier to write PM-HANDOFF.md', () => {
    assert.ok(verifier.includes('PM-HANDOFF.md'), 'a deferral must produce a handoff record');
    assert.match(
      verifier,
      /Deferral without a record is a criterion silently dropped/,
      'the handoff obligation must be justified, not merely listed'
    );
  });

  it('narrows the trigger so DEFERRED cannot be a fallback for hard work', () => {
    assert.match(verifier, /trigger is narrow/i, 'the verifier must bound the trigger');
    assert.ok(
      verifier.includes('pm-update.cjs'),
      'mechanical reconciliation must be excluded — it runs from any lane'
    );
  });

  it('routes DEFERRED to status done, not plan-verified', () => {
    assert.match(
      verifier,
      /PASS, INCONCLUSIVE, or DEFERRED → `status: done`/,
      'a deferred feature is built; it must not be sent back for a fix round'
    );
  });

  it('ranks DEFERRED below INCONCLUSIVE in the overall status precedence', () => {
    const inconclusive = verifier.indexOf('- **INCONCLUSIVE** — no FAIL');
    const deferred = verifier.indexOf('- **DEFERRED** — no FAIL and no INCONCLUSIVE');
    assert.ok(inconclusive !== -1 && deferred !== -1, 'both overall-status rules must exist');
    assert.ok(inconclusive < deferred, 'INCONCLUSIVE is the weaker guarantee and must win first');
  });

  it('carries criteria_deferred and pm_handoff in the result schema', () => {
    assert.ok(verifier.includes('criteria_deferred'), 'the count must be reportable');
    assert.ok(verifier.includes('pm_handoff'), 'the handoff pointer must be reportable');
  });
});

// ---------------------------------------------------------------------------
// Doctrine — the structured-output schema agrees with the agent
// ---------------------------------------------------------------------------

describe('pm-handoff doctrine — go workflow schema', () => {
  const workflow = readSrc('ship/workflows/go.workflow.js');

  it('accepts DEFERRED in both the overall and per-criterion enums', () => {
    const enums = workflow.match(/enum: \['PASS', 'FAIL', 'INCONCLUSIVE'[^\]]*\]/g) || [];
    assert.equal(enums.length, 2, 'the verify schema has exactly two verdict enums');
    for (const e of enums) {
      assert.ok(e.includes("'DEFERRED'"), `enum must accept DEFERRED: ${e}`);
    }
  });

  it('carries criteria_deferred and pm_handoff properties', () => {
    assert.ok(workflow.includes('criteria_deferred'), 'schema must accept the deferred count');
    assert.ok(workflow.includes('pm_handoff'), 'schema must accept the handoff pointer');
  });

  it('the schema stays closed to unknown keys', () => {
    // additionalProperties: false is what makes a schema mismatch visible
    // instead of silently dropping a field the agent emitted.
    const start = workflow.indexOf('const VERIFY_SCHEMA');
    assert.ok(start !== -1, 'VERIFY_SCHEMA must exist');
    assert.ok(
      workflow.slice(start, start + 400).includes('additionalProperties: false'),
      'VERIFY_SCHEMA stays closed'
    );
  });
});

// ---------------------------------------------------------------------------
// Doctrine — builder, finish, PM layer, template, headless
// ---------------------------------------------------------------------------

describe('pm-handoff doctrine — ship-builder defers instead of retrying', () => {
  const builder = readSrc('agents/ship-builder.md');

  it('tells the builder not to fight a .project-manager/ write', () => {
    assert.ok(builder.includes('.project-manager/'), 'the builder must name the shared state');
    assert.match(builder, /Do not retry the write/, 'retrying a structural wall wastes the round');
  });

  it('excludes the deviation rules from applying to it', () => {
    assert.match(
      builder,
      /Rule 2 verify failure/,
      'the builder must be told this is not a debuggable verify failure'
    );
  });

  it('routes the request into PM-HANDOFF.md', () => {
    assert.ok(builder.includes('PM-HANDOFF.md'), 'the builder records rather than drops the edit');
  });

  it('still allows the mechanical updater', () => {
    assert.ok(
      builder.includes('pm-update.cjs'),
      'running pm-update is not a deferral — it works from any lane'
    );
  });
});

describe('pm-handoff doctrine — finish carries but never applies', () => {
  const finish = readSrc('skills/finish/SKILL.md');

  it('has no write tools, so it structurally cannot apply a handoff', () => {
    const frontmatter = finish.match(/^---\n([\s\S]*?)\n---/)[1];
    const tools = frontmatter.match(/^allowed-tools:\s*(.*)$/m)[1];
    assert.ok(!/\bWrite\b/.test(tools), 'finish must not hold Write');
    assert.ok(!/\bEdit\b/.test(tools), 'finish must not hold Edit');
  });

  it('surfaces a pending handoff in its report', () => {
    assert.ok(finish.includes('PM-HANDOFF.md'), 'finish must check for a handoff');
    assert.ok(finish.includes('/ship:pm apply'), 'and name who applies it');
  });

  it('warns that keep-as-is leaves the handoff in the lane', () => {
    assert.match(
      finish,
      /still sitting in this worktree/,
      'an unfinished lane can be removed with its handoff — say so'
    );
  });
});

describe('pm-handoff doctrine — PM layer applies', () => {
  const pmSkill = readSrc('skills/pm/SKILL.md');
  const pmAgent = readSrc('agents/ship-pm.md');
  const pmState = readSrc('skills/pm-state/SKILL.md');

  it('the pm skill routes an `apply` verb', () => {
    assert.match(pmSkill, /`status`, `groom`, `check`, `apply`, `handover`/, 'apply joins the verb list');
    assert.match(pmSkill, /> \*\*apply\*\*/, 'the skill carries an apply brief for the agent');
  });

  it('the pm agent implements the apply verb', () => {
    assert.ok(pmAgent.includes('### apply'), 'the agent must own an apply section');
    assert.ok(pmAgent.includes('pendingHandoffs'), 'it reads the sweep for pending handoffs');
  });

  it('treats the applied stamp as the idempotence key', () => {
    assert.match(
      pmAgent,
      /already reads `applied: yes`/,
      're-applying a handoff would duplicate roadmap rows'
    );
  });

  it('keeps proposed content advisory, not a patch', () => {
    assert.match(
      pmAgent,
      /proposal, not a patch/,
      'the PM applies judgment — priority and placement are its call'
    );
  });

  it('guards the prune against lanes holding pending handoffs', () => {
    const start = pmAgent.indexOf('### handover');
    const handover = pmAgent.slice(start);
    assert.match(
      handover,
      /no lane holding a pending handoff/,
      'a deferred feature is done, so feature status alone is not a sufficient prune guard'
    );
  });

  it('pm-state records the handoff format and the deferral rule', () => {
    assert.ok(pmState.includes('## PM-HANDOFF.md'), 'pm-state owns the file format');
    assert.match(pmState, /\*\*Deferral, not failure:\*\*/, 'the doctrine is a numbered hard rule');
    assert.match(pmState, /applied` is the idempotence key/i, 'the stamp semantics are specified');
  });
});

describe('pm-handoff doctrine — VERIFY.md template', () => {
  const template = readSrc('ship/templates/VERIFY.md');

  it('offers DEFERRED as an overall and per-criterion verdict', () => {
    assert.match(template, /PASS \| FAIL \| INCONCLUSIVE \| DEFERRED/, 'overall status line');
    assert.ok(template.includes('PASS, FAIL, INCONCLUSIVE, DEFERRED'), 'per-criterion legend');
  });

  it('carries a PM Handoff section that cannot be silently empty', () => {
    assert.ok(template.includes('## PM Handoff'), 'the template must hold the section');
    assert.match(
      template,
      /An empty table must never mean a DEFERRED criterion went unrecorded/,
      'an empty section must be explicitly "none", never a skipped check'
    );
  });
});

describe('pm-handoff doctrine — headless contract', () => {
  const doc = readSrc('ship/docs/headless.md');
  const go = readSrc('skills/go/SKILL.md');

  it('adds `deferred` as a distinct outcome row', () => {
    assert.match(doc, /^\| `deferred` \|/m, 'the outcome table must row `deferred`');
  });

  it('leaves CONTEXT.md status done for a deferred run', () => {
    const row = doc.match(/^\| `deferred` \|.*$/m)[0];
    assert.ok(row.includes('`done`'), 'deferred work is built — its status is done');
  });

  it('documents handoff_file as deferred-only', () => {
    assert.ok(doc.includes('handoff_file'), 'callers need the path to the handoff');
    const row = doc.match(/^\| `handoff_file` \|.*$/m)[0];
    assert.match(row, /only on `deferred`/, 'handoff_file is deferred-only, like questions_file');
  });

  it('the go skill maps a DEFERRED verdict to the deferred outcome, never done', () => {
    assert.match(go, /\| Verdict DEFERRED \| `deferred`/, 'the terminal table must route it');
    assert.match(
      go,
      /a caller that reads `done` archives the lane and the handoff rots/,
      'the reason for a distinct outcome must be recorded where it can be reversed knowingly'
    );
  });

  it('the go skill refuses to retry a deferral', () => {
    assert.match(
      go,
      /never re-run the workflow to "fix" it/,
      'a retry burns a full build→verify cycle and changes nothing'
    );
  });
});
