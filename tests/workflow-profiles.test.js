/**
 * Workflow policy knobs — profile resolution.
 *
 * A feature's workflow profile (quick | standard | thorough) is the only place
 * policy varies: how much review gate, how many builder/plan rounds, how deep a
 * verify. The profile→knob table lives in ship/resolve-profile.cjs because the
 * workflow scripts cannot `require()` anything — which makes this file the only
 * thing standing between "cheaper run" and "silently skipped ceremony".
 *
 * Two invariants matter most:
 *   - `standard` is the pinned definition of *today* — every knob a caller omits
 *     must default to it, so existing features and old invocations are untouched.
 *   - Resolution degrades toward more ceremony, never less: an unknown value
 *     yields standard plus a warning, and the CLI never fails a go run.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const { PROFILES, resolveProfile, readProfileField } = require(path.join(repoRoot, 'ship', 'resolve-profile.cjs'));

// ---------------------------------------------------------------------------
// 1 — the profile table
// ---------------------------------------------------------------------------

describe('resolveProfile — knob bundles', () => {
  it('quick trades both bug-hunting layers and caps rounds at 2', () => {
    assert.deepEqual(resolveProfile('quick', null).knobs, {
      reviewGate: false,
      verifyDepth: 'criteria-only',
      maxBuildRounds: 2,
      maxPlanRounds: 2,
    });
  });

  it('standard is today: full gate, full verify, 5/5', () => {
    assert.deepEqual(resolveProfile('standard', null).knobs, {
      reviewGate: true,
      verifyDepth: 'full',
      maxBuildRounds: 5,
      maxPlanRounds: 5,
    });
  });

  it('thorough only widens the builder-round cap', () => {
    assert.deepEqual(resolveProfile('thorough', null).knobs, {
      reviewGate: true,
      verifyDepth: 'full',
      maxBuildRounds: 8,
      maxPlanRounds: 5,
    });
  });

  it('returns a copy of the knobs, not a reference to the table', () => {
    const result = resolveProfile('quick', null);
    result.knobs.maxBuildRounds = 99;
    assert.equal(PROFILES.quick.maxBuildRounds, 2);
    assert.equal(resolveProfile('quick', null).knobs.maxBuildRounds, 2);
  });
});

// ---------------------------------------------------------------------------
// 2 — precedence and degradation
// ---------------------------------------------------------------------------

describe('resolveProfile — precedence and degradation', () => {
  it('absent inputs resolve to standard from the default source, silently', () => {
    for (const [flag, frontmatter] of [[null, null], [undefined, undefined], ['', ''], ['  ', null]]) {
      const result = resolveProfile(flag, frontmatter);
      assert.equal(result.profile, 'standard');
      assert.equal(result.source, 'default');
      assert.equal(result.warning, null);
    }
  });

  it('an unrecognized frontmatter value warns and falls back to standard', () => {
    const result = resolveProfile(null, 'turbo');
    assert.equal(result.profile, 'standard');
    assert.equal(result.knobs.reviewGate, true);
    assert.ok(result.warning);
    assert.match(result.warning, /turbo/);
    assert.match(result.warning, /frontmatter/);
  });

  it('an unrecognized flag value warns naming the flag as the source', () => {
    const result = resolveProfile('fastest', null);
    assert.equal(result.profile, 'standard');
    assert.ok(result.warning);
    assert.match(result.warning, /fastest/);
    assert.match(result.warning, /flag/);
  });

  it('the flag beats the frontmatter', () => {
    const result = resolveProfile('thorough', 'quick');
    assert.equal(result.profile, 'thorough');
    assert.equal(result.source, 'flag');
    assert.equal(result.knobs.maxBuildRounds, 8);
  });

  it('tolerates case and surrounding quotes', () => {
    for (const raw of ['Quick', 'QUICK', ' quick ', '"quick"', "'quick'"]) {
      const result = resolveProfile(raw, null);
      assert.equal(result.profile, 'quick', `expected ${raw} to resolve to quick`);
      assert.equal(result.warning, null);
    }
  });
});

// ---------------------------------------------------------------------------
// 3 — frontmatter reading
// ---------------------------------------------------------------------------

describe('readProfileField', () => {
  const withFixture = (content, fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-profile-'));
    const file = path.join(dir, 'CONTEXT.md');
    fs.writeFileSync(file, content, 'utf8');
    try {
      fn(file);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('reads the field from the frontmatter block', () => {
    withFixture('---\nfeature: "x"\nstatus: planned\nprofile: quick\n---\n\n## Problem\n', (file) => {
      assert.equal(readProfileField(file), 'quick');
    });
  });

  it('returns null when the field is absent', () => {
    withFixture('---\nfeature: "x"\nstatus: planned\n---\n\n## Problem\n', (file) => {
      assert.equal(readProfileField(file), null);
    });
  });

  it('returns null when the file is absent, without throwing', () => {
    assert.equal(readProfileField(path.join(os.tmpdir(), 'ship-no-such-context-file.md')), null);
  });

  it('ignores a profile: line that appears only in the body', () => {
    withFixture('---\nfeature: "x"\n---\n\n## Notes\n\nprofile: quick\n', (file) => {
      assert.equal(readProfileField(file), null);
    });
  });
});

// ---------------------------------------------------------------------------
// 4 — the CLI never kills a go run
// ---------------------------------------------------------------------------

describe('resolve-profile CLI', () => {
  it('prints valid JSON and exits 0 for an unknown feature', () => {
    const stdout = execFileSync('node', ['ship/resolve-profile.cjs', 'no-such-feature'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const result = JSON.parse(stdout);
    assert.equal(result.profile, 'standard');
    assert.equal(result.knobs.maxBuildRounds, 5);
    assert.ok(result.warning);
  });
});

// ---------------------------------------------------------------------------
// 5 — doctrine: the knobs are actually wired, and default to today
// ---------------------------------------------------------------------------

const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const goWorkflow = () => readSrc('ship/workflows/go.workflow.js');
const planWorkflow = () => readSrc('ship/workflows/plan.workflow.js');
const goSkill = () => readSrc('skills/go/SKILL.md');
const verifier = () => readSrc('agents/ship-verifier.md');
const brainstormer = () => readSrc('agents/ship-brainstormer.md');

describe('doctrine — workflow scripts read knobs from args and default to today', () => {
  it('go.workflow.js takes the builder-round cap from args, defaulting to 5', () => {
    assert.match(goWorkflow(), /MAX_BUILD_ROUNDS\s*=\s*Number\(parsedArgs && parsedArgs\.maxBuildRounds\)\s*\|\|\s*5/,
      'a missing maxBuildRounds must fall back to today\'s 5, not to 0 or NaN');
  });

  it('plan.workflow.js takes the plan-loop cap from args, defaulting to 5', () => {
    assert.match(planWorkflow(), /MAX_PLAN_ROUNDS\s*=\s*Number\(parsedArgs && parsedArgs\.maxPlanRounds\)\s*\|\|\s*5/,
      'a missing maxPlanRounds must fall back to today\'s 5');
  });

  it('the review gate is disabled only by an explicit false — boolean or string', () => {
    const src = goWorkflow();
    assert.match(src, /parsedArgs\.reviewGate === false/,
      'the boolean form must disable the gate');
    assert.match(src, /parsedArgs\.reviewGate === 'false'/,
      'the string form must disable the gate too — the go skill hand-builds args from prose');
    assert.match(src, /const reviewGate = !\(/,
      'anything other than an explicit false must keep the gate on');
  });

  it('a profile-skipped review is a distinct status from a review that failed to run', () => {
    assert.ok(goWorkflow().includes('SKIPPED_BY_PROFILE'),
      'a deliberate skip must never be indistinguishable from a broken gate');
  });

  it('verify depth defaults to full and only criteria-only narrows it', () => {
    assert.match(goWorkflow(), /verifyDepth = \(parsedArgs && parsedArgs\.verifyDepth\) === 'criteria-only' \? 'criteria-only' : 'full'/,
      'any value other than criteria-only — including absent — must mean a full verification');
  });

  it('the criteria-only prompt block keeps carried review findings mandatory', () => {
    const src = goWorkflow();
    assert.ok(src.includes('Verification depth: criteria-only'),
      'the narrowing must be an explicit prompt instruction the verifier can recognize');
    assert.ok(src.includes('narrowing never waives'),
      'carried unresolved review findings stay mandatory Stage 2b targets at any depth');
    assert.ok(/remain mandatory/.test(src),
      'the exception must name the carried findings as mandatory, not merely encouraged');
  });

  it('neither workflow script contains CRLF line endings', () => {
    // The Workflow tool rejects CRLF scripts outright — a stray editor or git
    // setting that rewrites these files breaks every /ship:go run.
    assert.ok(!goWorkflow().includes('\r'), 'go.workflow.js must use LF endings');
    assert.ok(!planWorkflow().includes('\r'), 'plan.workflow.js must use LF endings');
  });
});

describe('doctrine — the go skill resolves the profile and passes every knob', () => {
  it('accepts --profile and shells out to the resolution helper', () => {
    const src = goSkill();
    assert.ok(src.includes('--profile'), 'the run-time override flag must be documented');
    assert.ok(src.includes('resolve-profile.cjs'),
      'the profile→knob table must be resolved by the helper, not re-derived in prose');
  });

  it('documents the precedence flag > frontmatter > standard', () => {
    assert.match(goSkill(), /flag > /,
      'precedence must be stated, not left to the reader');
  });

  it('passes maxPlanRounds on the re-invocation as well as the initial invocation', () => {
    const src = goSkill();
    const occurrences = src.split('maxPlanRounds').length - 1;
    assert.ok(occurrences >= 3,
      `maxPlanRounds must reach every plan.workflow invocation (initial, NEEDS_INPUT re-invocation, headless resume) — found ${occurrences} mentions`);
    const reinvocation = src.split('RE-INVOKE')[1];
    assert.ok(reinvocation, 'the NEEDS_INPUT re-invocation instruction must still exist');
    const argsLiteral = reinvocation.split('\n')[0];
    assert.ok(argsLiteral.includes('maxPlanRounds'),
      'a quick-profile loop that hits NEEDS_INPUT must resume at cap 2, not the default 5');
  });

  it('passes the three behavioral knobs plus the display name to the build workflow', () => {
    const src = goSkill();
    for (const knob of ['reviewGate', 'verifyDepth', 'maxBuildRounds', 'profile:']) {
      assert.ok(src.includes(knob), `section 5 args must carry ${knob}`);
    }
  });

  it('records a profile-skipped review distinctly in REVIEW.md', () => {
    assert.ok(goSkill().includes('SKIPPED (profile:'),
      'an audit must be able to tell a traded-away review from a broken one');
  });
});

describe('doctrine — agent contracts', () => {
  it('the verifier HARD-GATE binds to the stages in scope', () => {
    const gate = verifier().split('## Inputs')[0];
    assert.ok(gate.includes('every stage in scope'),
      'the HARD-GATE must not assert "both stages" unconditionally — criteria-only is a legal scope');
    assert.ok(gate.includes('criteria-only'),
      'the gate must name the only thing that may narrow it');
  });

  it('the verifier has a Verification Depth section that never waives carried findings', () => {
    const src = verifier();
    assert.ok(src.includes('## Verification Depth'),
      'the depth contract needs a home the prompt can point at');
    const section = src.split('## Verification Depth')[1].split('\n## ')[0];
    assert.match(section, /Narrowing never waives|narrowing never waives/,
      'carried unresolved review findings stay mandatory Stage 2b targets at criteria-only depth');
    assert.ok(section.includes('Stage 2 narrowed by profile'),
      'the narrowing must be recorded durably in VERIFY.md, not just obeyed');
  });

  it('the brainstormer CONTEXT.md template carries the profile field', () => {
    assert.ok(brainstormer().includes('profile: {quick | standard | thorough}'),
      'the profile is a requirements-time judgment — it must ship in the template');
  });
});

describe('doctrine — back-compat', () => {
  it('standard is the pinned definition of today', () => {
    assert.deepEqual(PROFILES.standard, {
      reviewGate: true,
      verifyDepth: 'full',
      maxBuildRounds: 5,
      maxPlanRounds: 5,
    }, 'changing this table changes what every existing feature gets — it is a breaking change, not a tweak');
  });
});

// ---------------------------------------------------------------------------
// Observability: a cheaper run must never be indistinguishable from a full one
// after the fact. Each case below is a defect found by an end-to-end quick-
// profile run, which contract assertions alone did not catch.
// ---------------------------------------------------------------------------

// The exact string a later audit greps for. A reworded equivalent reads
// fine to a human and is invisible to the audit, so the wording is load-bearing.
const NARROWED_LINE =
  'Stage 2 narrowed by profile: criteria-only — discretionary bug hunt and anti-pattern scan skipped.';

describe('doctrine — the narrowed-verify record is greppable', () => {
  it('the verifier is told to copy the audit line verbatim', () => {
    const src = verifier();
    assert.ok(src.includes(NARROWED_LINE), 'the mandated line must appear in the contract exactly as audits grep for it');
    assert.match(src, /verbatim/i, 'a verifier that may paraphrase will paraphrase — an e2e run proved it');
  });

  it('the VERIFY.md template carries the same verbatim instruction', () => {
    const src = readSrc('ship/templates/VERIFY.md');
    assert.ok(src.includes(NARROWED_LINE), 'the template is read at runtime — it must carry the exact line too');
    assert.match(src, /verbatim/i);
  });

  it('the go workflow prompt tells the verifier to record the narrowing', () => {
    const src = goWorkflow();
    assert.match(src, /criteria-only/, 'the depth block must exist');
    assert.match(src, /Record the narrowing in VERIFY\.md/, 'the prompt must demand the durable record, not just the skip');
  });
});

describe('doctrine — a deliberate skip never reads as a broken review', () => {
  it('the go skill exempts SKIPPED_BY_PROFILE from the unsubstantiated-review warning', () => {
    const src = goSkill();
    const line = src.split('\n').find((l) => l.includes('Unsubstantiated review verdicts'));
    assert.ok(line, 'the unsubstantiated-review warning must still exist for genuinely empty reviews');
    assert.match(
      line,
      /NOT `SKIPPED_BY_PROFILE`/,
      'a quick run reports empty verifyRuns/filesReviewed by design; without this exemption every skipped phase is falsely reported as an approved review backed by nothing',
    );
  });

  it('the go skill reports the gate being off as its own neutral line', () => {
    assert.match(
      goSkill(),
      /Review gate off by profile/,
      'the trade must appear in GO COMPLETE — silence would make a cheap run look like a full one',
    );
  });
});

describe('doctrine — the resolver CLI cannot truncate its own output', () => {
  it('does not call process.exit after writing stdout', () => {
    // Ignore comments: the code deliberately explains in prose why it does not
    // exit, and that explanation must not read as the call it warns about.
    const code = readSrc('ship/resolve-profile.cjs')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    assert.ok(
      !/process\.exit\(/.test(code),
      'stdout to a pipe is async on Windows and the go skill reads this through one; an explicit exit can truncate the JSON payload and fail the skill JSON.parse',
    );
  });

  it('still exits 0 and emits parseable JSON with no arguments', () => {
    const out = execFileSync('node', [path.join(repoRoot, 'ship', 'resolve-profile.cjs')], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(out);
    assert.equal(parsed.profile, 'standard');
  });
});
