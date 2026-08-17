/**
 * Workflow policy knobs — adversarial tests (verification stage).
 *
 * The doctrine suite (tests/workflow-profiles.test.js) locks the happy paths and
 * the file-content invariants. This file attacks the edges that would silently
 * *reduce* ceremony or throw at runtime:
 *
 *   - hostile / non-string profile values (prototype keys, objects, numbers)
 *   - frontmatter shapes the regex could mis-read (CRLF, body-only, indented,
 *     unterminated, second block)
 *   - CLI abuse (missing flag value, path traversal, no args)
 *   - the workflow scripts' knob-coercion expressions, evaluated as shipped
 *   - the gate-skip entry shape: empty collections, never nulls
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const helperPath = path.join(repoRoot, 'ship', 'resolve-profile.cjs');
const { PROFILES, resolveProfile, readProfileField } = require(helperPath);

const goSrc = fs.readFileSync(path.join(repoRoot, 'ship', 'workflows', 'go.workflow.js'), 'utf8');
const planSrc = fs.readFileSync(path.join(repoRoot, 'ship', 'workflows', 'plan.workflow.js'), 'utf8');

const STANDARD = { reviewGate: true, verifyDepth: 'full', maxBuildRounds: 5, maxPlanRounds: 5 };

// ---------------------------------------------------------------------------
// negative-input: resolveProfile must never yield a cheaper run than standard
// ---------------------------------------------------------------------------

describe('resolveProfile — hostile values degrade to standard', () => {
  for (const evil of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    it(`prototype key '${evil}' is not a profile`, () => {
      const r = resolveProfile(evil, null);
      assert.equal(r.profile, 'standard');
      assert.deepEqual(r.knobs, STANDARD);
      assert.ok(r.warning, 'must warn');
    });
  }

  for (const junk of [0, false, NaN, [], {}, () => {}]) {
    it(`non-string ${JSON.stringify(String(junk))} never lowers ceremony`, () => {
      const r = resolveProfile(junk, null);
      assert.equal(r.profile, 'standard');
      assert.deepEqual(r.knobs, STANDARD);
    });
  }

  for (const blank of ['', '   ', '\t', '""', "''", '  " "  ']) {
    it(`blank-ish ${JSON.stringify(blank)} resolves to standard without lowering knobs`, () => {
      const r = resolveProfile(blank, null);
      assert.equal(r.profile, 'standard');
      assert.deepEqual(r.knobs, STANDARD);
    });
  }

  it('a quick-looking value with extra junk does not match quick', () => {
    for (const near of ['quick ceremony', 'quickly', 'qu ick', 'quick;quick', 'QUICK!']) {
      const r = resolveProfile(near, null);
      assert.equal(r.profile, 'standard', near);
      assert.equal(r.knobs.reviewGate, true, near);
      assert.ok(r.warning, near);
    }
  });

  it('case and quote tolerance still lands on the real profile', () => {
    for (const ok of ['Quick', ' QUICK ', '"quick"', "'Quick'", '"  quick  "']) {
      assert.equal(resolveProfile(ok, null).profile, 'quick', ok);
    }
  });

  it('an unrecognized flag never falls back to a valid frontmatter value', () => {
    // Safe direction: bad flag => standard, not the (possibly cheaper) file value.
    const r = resolveProfile('bogus', 'quick');
    assert.equal(r.profile, 'standard');
    assert.match(r.warning, /flag/);
  });

  it('a valid flag beats a bogus frontmatter value with no warning', () => {
    const r = resolveProfile('thorough', 'ludicrous');
    assert.equal(r.profile, 'thorough');
    assert.equal(r.source, 'flag');
    assert.equal(r.warning, null);
    assert.equal(r.knobs.maxBuildRounds, 8);
  });

  it('returned knobs are a fresh copy and PROFILES is frozen', () => {
    const a = resolveProfile('quick', null).knobs;
    a.maxBuildRounds = 999;
    a.reviewGate = true;
    assert.equal(resolveProfile('quick', null).knobs.maxBuildRounds, 2);
    assert.equal(PROFILES.quick.maxBuildRounds, 2);
    assert.throws(() => { 'use strict'; PROFILES.quick.reviewGate = true; });
    assert.throws(() => { 'use strict'; PROFILES.evil = {}; });
  });
});

// ---------------------------------------------------------------------------
// boundary: frontmatter shapes
// ---------------------------------------------------------------------------

describe('readProfileField — frontmatter edge shapes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-profile-adv-'));
  const write = (name, content) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, content);
    return p;
  };

  it('reads a CRLF frontmatter block', () => {
    const p = write('crlf.md', '---\r\nfeature: "x"\r\nprofile: quick\r\n---\r\n\r\nbody\r\n');
    assert.equal(readProfileField(p), 'quick');
    assert.equal(resolveProfile(null, readProfileField(p)).profile, 'quick');
  });

  it('ignores a profile: line that lives only in the body', () => {
    const p = write('body.md', '---\nfeature: "x"\n---\n\nprofile: quick\n');
    assert.equal(readProfileField(p), null);
    assert.equal(resolveProfile(null, readProfileField(p)).profile, 'standard');
  });

  it('ignores an indented (nested) profile key', () => {
    const p = write('nested.md', '---\nmeta:\n  profile: quick\n---\n');
    assert.equal(readProfileField(p), null);
  });

  it('does not match a differently-named key', () => {
    const p = write('similar.md', '---\nprofile_hint: quick\nprofiles: quick\n---\n');
    assert.equal(readProfileField(p), null);
  });

  it('returns null for an unterminated frontmatter block', () => {
    const p = write('unterminated.md', '---\nprofile: quick\n');
    assert.equal(readProfileField(p), null);
  });

  it('only searches the first frontmatter block', () => {
    const p = write('second.md', '---\nfeature: "x"\n---\n\n---\nprofile: quick\n---\n');
    assert.equal(readProfileField(p), null);
  });

  it('strips trailing whitespace and keeps quotes for the resolver to handle', () => {
    const p = write('quoted.md', '---\nprofile: "thorough"   \n---\n');
    assert.equal(readProfileField(p), '"thorough"');
    assert.equal(resolveProfile(null, readProfileField(p)).profile, 'thorough');
  });

  it('never throws on a missing file or a directory path', () => {
    assert.equal(readProfileField(path.join(tmp, 'nope.md')), null);
    assert.equal(readProfileField(tmp), null);
    assert.equal(readProfileField(''), null);
  });

  it('reads this repo feature CONTEXT.md files without throwing', () => {
    const featuresDir = path.join(repoRoot, '.planning', 'features');
    if (!fs.existsSync(featuresDir)) return;
    for (const slug of fs.readdirSync(featuresDir)) {
      const p = path.join(featuresDir, slug, 'CONTEXT.md');
      if (!fs.existsSync(p)) continue;
      const v = readProfileField(p);
      assert.ok(v === null || typeof v === 'string');
    }
  });
});

// ---------------------------------------------------------------------------
// error-handling: the CLI must always exit 0 with parseable JSON
// ---------------------------------------------------------------------------

describe('resolve-profile CLI — never kills a go run', () => {
  const run = (args, cwd = repoRoot) => {
    const out = execFileSync('node', [helperPath, ...args], { cwd, encoding: 'utf8' });
    return JSON.parse(out);
  };

  // A throwaway feature directory, built fresh per test — `.planning/` is
  // gitignored (local, per-repo state), so a real feature slug from this repo
  // is never present in a clean checkout and must not be relied on here.
  const withFixtureFeature = (slug, frontmatter) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-profile-cli-'));
    const featureDir = path.join(tmp, '.planning', 'features', slug);
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, 'CONTEXT.md'), frontmatter);
    return tmp;
  };

  const cases = [
    ['no arguments at all', []],
    ['missing feature directory', ['definitely-not-a-feature']],
    ['--profile with no value', ['definitely-not-a-feature', '--profile']],
    ['empty --profile= value', ['definitely-not-a-feature', '--profile=']],
    ['bogus profile value', ['definitely-not-a-feature', '--profile', 'bogus']],
    ['path traversal slug', ['../../etc', '--profile', 'quick']],
    ['slug with a null-ish odd name', ['..', '--profile=standard']],
    ['unknown extra flag', ['definitely-not-a-feature', '--wat', '--profile=quick']],
  ];

  for (const [name, args] of cases) {
    it(`${name} exits 0 with a valid knob bundle`, () => {
      const r = run(args);
      assert.ok(Object.prototype.hasOwnProperty.call(PROFILES, r.profile), r.profile);
      assert.deepEqual(Object.keys(r.knobs).sort(), ['maxBuildRounds', 'maxPlanRounds', 'reviewGate', 'verifyDepth']);
      assert.deepEqual(r.knobs, PROFILES[r.profile]);
    });
  }

  it('a missing CONTEXT.md degrades to standard with a warning', () => {
    const r = run(['definitely-not-a-feature']);
    assert.equal(r.profile, 'standard');
    assert.ok(r.warning, 'must name the problem');
  });

  it('a valid flag still wins over a missing CONTEXT.md, with no warning', () => {
    const r = run(['definitely-not-a-feature', '--profile', 'quick']);
    assert.equal(r.profile, 'quick');
    assert.equal(r.source, 'flag');
    assert.equal(r.warning, null);
  });

  it('reads a real feature\'s frontmatter profile', () => {
    const tmp = withFixtureFeature('sample-feature', '---\nfeature: "sample-feature"\nprofile: standard\n---\n');
    const r = run(['sample-feature'], tmp);
    assert.equal(r.profile, 'standard');
    assert.equal(r.source, 'frontmatter');
    assert.deepEqual(r.knobs, STANDARD);
  });

  it('--profile=quick form is accepted on a real feature', () => {
    const tmp = withFixtureFeature('sample-feature', '---\nfeature: "sample-feature"\nprofile: standard\n---\n');
    const r = run(['sample-feature', '--profile=quick'], tmp);
    assert.equal(r.profile, 'quick');
    assert.equal(r.knobs.reviewGate, false);
  });
});

// ---------------------------------------------------------------------------
// the shipped coercion expressions, evaluated as written
// ---------------------------------------------------------------------------

const evalConst = (src, name, decl) => {
  const line = src.split('\n').find((l) => l.trim().startsWith(decl));
  assert.ok(line, `could not find declaration ${decl}`);
  return new Function('parsedArgs', `${line}\nreturn ${name}`);
};

describe('workflow knob coercion — defaults to today, never below', () => {
  const buildRounds = evalConst(goSrc, 'MAX_BUILD_ROUNDS', 'const MAX_BUILD_ROUNDS');
  const planRounds = evalConst(planSrc, 'MAX_PLAN_ROUNDS', 'const MAX_PLAN_ROUNDS');
  const reviewGate = evalConst(goSrc, 'reviewGate', 'const reviewGate');
  const verifyDepth = evalConst(goSrc, 'verifyDepth', 'const verifyDepth');

  for (const absent of [undefined, null, {}, { feature: 'x' }, { maxBuildRounds: undefined }, { maxBuildRounds: 0 }, { maxBuildRounds: 'abc' }, { maxBuildRounds: null }]) {
    it(`build rounds default to 5 for args ${JSON.stringify(absent)}`, () => {
      assert.equal(buildRounds(absent), 5);
    });
  }

  it('build rounds honour the profile values, including string-encoded ones', () => {
    assert.equal(buildRounds({ maxBuildRounds: 2 }), 2);
    assert.equal(buildRounds({ maxBuildRounds: 8 }), 8);
    assert.equal(buildRounds({ maxBuildRounds: '8' }), 8);
    assert.equal(buildRounds({ maxBuildRounds: '2' }), 2);
  });

  for (const absent of [undefined, null, {}, { feature: 'x' }, { maxPlanRounds: 0 }, { maxPlanRounds: 'x' }]) {
    it(`plan rounds default to 5 for args ${JSON.stringify(absent)}`, () => {
      assert.equal(planRounds(absent), 5);
    });
  }

  it('plan rounds honour quick cap 2 in both number and string form', () => {
    assert.equal(planRounds({ maxPlanRounds: 2 }), 2);
    assert.equal(planRounds({ maxPlanRounds: '2' }), 2);
  });

  it('the review gate is on unless explicitly false', () => {
    for (const on of [undefined, null, {}, { reviewGate: true }, { reviewGate: 'true' }, { reviewGate: 0 }, { reviewGate: '' }, { reviewGate: 'no' }, { reviewGate: null }, { reviewGate: 'FALSE' }]) {
      assert.equal(reviewGate(on), true, JSON.stringify(on));
    }
    assert.equal(reviewGate({ reviewGate: false }), false);
    assert.equal(reviewGate({ reviewGate: 'false' }), false);
  });

  it('verify depth is full unless exactly criteria-only', () => {
    for (const full of [undefined, null, {}, { verifyDepth: 'full' }, { verifyDepth: 'CRITERIA-ONLY' }, { verifyDepth: 'criteria only' }, { verifyDepth: true }]) {
      assert.equal(verifyDepth(full), 'full', JSON.stringify(full));
    }
    assert.equal(verifyDepth({ verifyDepth: 'criteria-only' }), 'criteria-only');
  });
});

// ---------------------------------------------------------------------------
// the verifier prompt's depth block, and the gate-skip entry shape
// ---------------------------------------------------------------------------

describe('verifier depth block', () => {
  const m = goSrc.match(/const depthBlock = verifyDepth === 'criteria-only'[\s\S]*?\n {2}: ''/);
  assert.ok(m, 'depthBlock declaration not found');
  const fn = new Function('verifyDepth', 'profileName', `${m[0]}\nreturn depthBlock`);

  it('is empty at full depth — the prompt is byte-identical to a pre-profile run', () => {
    assert.equal(fn('full', null), '');
    assert.equal(fn('full', 'standard'), '');
  });

  it('at criteria-only it names the skips and keeps carried findings mandatory', () => {
    const block = fn('criteria-only', 'quick');
    assert.match(block, /Verification depth: criteria-only/);
    assert.match(block, /\(quick\)/);
    assert.match(block, /2a/);
    assert.match(block, /2c/);
    assert.match(block, /Stage 1/);
    assert.match(block, /Unresolved Review Findings/);
    assert.match(block, /narrowing never waives them/);
    assert.match(block, /Record the narrowing in VERIFY\.md/);
  });

  it('omits the parenthetical when no profile name was passed', () => {
    assert.ok(!fn('criteria-only', null).includes('()'));
  });
});

describe('gate-skip entry shape', () => {
  const m = goSrc.match(/if \(!reviewGate\) \{[\s\S]*?\n {2}\}/);
  assert.ok(m, 'review-gate skip block not found');
  const body = m[0].replace(/\n\s*continue\b/, '\n');
  const fn = new Function('completed', 'ph', 'build', 'log', 'profileName', 'reviewGate', 'label', body);

  const runSkip = (build) => {
    const completed = [];
    fn(completed, { id: '1', name: 'Phase one' }, build, () => {}, 'quick', false, '1');
    assert.equal(completed.length, 1);
    return completed[0];
  };

  it('emits empty arrays, never nulls, even from a bare builder result', () => {
    const e = runSkip({ tasks_completed: 3, tasks_total: 3 });
    for (const key of ['commits', 'concerns', 'findings', 'verifyRuns', 'filesReviewed', 'unresolved', 'introducedByFix']) {
      assert.ok(Array.isArray(e[key]), `${key} must be an array`);
      assert.equal(e[key].length, 0, `${key} must be empty`);
    }
    assert.equal(e.reviewStatus, 'SKIPPED_BY_PROFILE');
    assert.equal(e.fixApplied, false);
    assert.equal(e.builderRounds, 1);
  });

  it('carries builder commits and concerns through, copied not aliased', () => {
    const build = { tasks_completed: 1, tasks_total: 2, rounds: 3, commits: ['abc123'], concerns: ['tree dirty'] };
    const e = runSkip(build);
    assert.deepEqual(e.commits, ['abc123']);
    assert.deepEqual(e.concerns, ['tree dirty']);
    assert.equal(e.builderRounds, 3);
    e.concerns.push('mutated');
    assert.deepEqual(build.concerns, ['tree dirty'], 'must not alias the builder result');
  });

  it('produces the empty carried/unresolved sets the reconcile and verifier rely on', () => {
    const e = runSkip({ tasks_completed: 1, tasks_total: 1 });
    // Mirrors go.workflow.js: carried = completed.flatMap(p => p.unresolved.map(...))
    const carried = [e].flatMap((p) => (p.unresolved || []).map((f) => f.description));
    assert.deepEqual(carried, []);
    // And mirrors the reconcile-side filters, which must not throw on a skip.
    assert.equal(e.verifyRuns.filter((v) => v.verdict === 'not_runnable').length, 0);
    assert.deepEqual(e.findings.filter((f) => f.severity === 'critical'), []);
  });

  it('runs no agent at all: the block invokes nothing and continues past the gate', () => {
    assert.ok(!m[0].includes('safeAgent'), 'the skip block must not invoke any agent');
    assert.match(m[0], /\n\s*continue\n/, 'the skip block must continue past the review gate');
    const skipEnd = goSrc.indexOf(m[0]) + m[0].length;
    for (const call of ['ship:ship-reviewer', 'fix:${label}', 'rereview:${label}']) {
      const at = goSrc.indexOf(call);
      assert.ok(at > skipEnd, `${call} must sit after the skip block, so a skipped phase never reaches it`);
    }
  });

  it('is a distinct marker from the failed-review SKIPPED status', () => {
    assert.notEqual('SKIPPED_BY_PROFILE', 'SKIPPED');
    assert.match(goSrc, /reviewStatus: review \? review\.status : 'SKIPPED'/);
  });
});
