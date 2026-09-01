#!/usr/bin/env node
// Ship workflow-profile resolver — maps a feature's workflow profile
// (quick | standard | thorough) to the explicit policy knob values the go/plan
// workflow scripts take through `args`.
//
// Workflow scripts cannot `require()` anything, so the profile→knobs table must
// live in exactly one place outside them — here. The go skill shells out to the
// CLI and passes the resolved knob values on.
//
// Zero dependencies. Resolution degrades, never dies: an unknown value, a
// missing CONTEXT.md, or any read failure yields `standard` (today's full
// ceremony) plus a warning, and the CLI always exits 0 with valid JSON.
//
// Usage: node resolve-profile.cjs <feature-slug> [--profile <value>]

const fs = require('fs');
const path = require('path');

/**
 * The profile→knob table. `standard` is the pinned definition of "today":
 * every knob absent from workflow args defaults to these values.
 */
const PROFILES = Object.freeze({
  quick: Object.freeze({ reviewGate: false, verifyDepth: 'criteria-only', maxBuildRounds: 2, maxPlanRounds: 2 }),
  standard: Object.freeze({ reviewGate: true, verifyDepth: 'full', maxBuildRounds: 5, maxPlanRounds: 5 }),
  thorough: Object.freeze({ reviewGate: true, verifyDepth: 'full', maxBuildRounds: 8, maxPlanRounds: 5 }),
});

const DEFAULT_PROFILE = 'standard';

/** Trim, unquote, and lowercase a raw profile value. Returns '' for nothing usable. */
function normalize(value) {
  if (value === null || value === undefined) return '';
  let v = String(value).trim();
  if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
    v = v.slice(1, -1).trim();
  }
  return v.toLowerCase();
}

function knobsFor(profile) {
  return Object.assign({}, PROFILES[profile]);
}

/**
 * Resolve a profile from a run-time flag and a CONTEXT.md frontmatter value.
 * Precedence: flag > frontmatter > standard.
 *
 * @param {string|null|undefined} flagValue
 * @param {string|null|undefined} frontmatterValue
 * @returns {{ profile: string, source: 'flag'|'frontmatter'|'default',
 *             warning: string|null, knobs: object }}
 */
function resolveProfile(flagValue, frontmatterValue) {
  const fromFlag = normalize(flagValue);
  const fromFrontmatter = normalize(frontmatterValue);

  let candidate = '';
  let source = 'default';
  if (fromFlag) {
    candidate = fromFlag;
    source = 'flag';
  } else if (fromFrontmatter) {
    candidate = fromFrontmatter;
    source = 'frontmatter';
  }

  if (!candidate) {
    return { profile: DEFAULT_PROFILE, source: 'default', warning: null, knobs: knobsFor(DEFAULT_PROFILE) };
  }

  if (!Object.prototype.hasOwnProperty.call(PROFILES, candidate)) {
    return {
      profile: DEFAULT_PROFILE,
      source: 'default',
      warning: `unrecognized profile '${candidate}' (from ${source}) — using standard`,
      knobs: knobsFor(DEFAULT_PROFILE),
    };
  }

  return { profile: candidate, source, warning: null, knobs: knobsFor(candidate) };
}

/**
 * Read the `profile:` field from a CONTEXT.md frontmatter block. Only the text
 * between the first pair of `---` lines is searched, so a `profile:` line in the
 * body never matches. Returns null when the file, the frontmatter, or the field
 * is absent. Never throws.
 *
 * @param {string} contextPath
 * @returns {string|null}
 */
function readProfileField(contextPath) {
  try {
    const content = fs.readFileSync(contextPath, 'utf8');
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return null;
    const field = fm[1].match(/^profile:\s*(.+?)\s*$/m);
    return field ? field[1] : null;
  } catch (e) {
    return null;
  }
}

module.exports = { PROFILES, DEFAULT_PROFILE, resolveProfile, readProfileField };

if (require.main === module) {
  let result;
  try {
    const argv = process.argv.slice(2);
    let flagValue = null;
    let slug = null;

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '--profile') {
        flagValue = argv[i + 1] !== undefined ? argv[i + 1] : null;
        i++;
      } else if (arg.startsWith('--profile=')) {
        flagValue = arg.slice('--profile='.length);
      } else if (!arg.startsWith('--') && slug === null) {
        slug = arg;
      }
    }

    let frontmatterValue = null;
    let fileWarning = null;

    if (!slug) {
      fileWarning = 'no feature named — using standard';
    } else {
      const contextPath = path.join(process.cwd(), '.planning', 'features', slug, 'CONTEXT.md');
      if (!fs.existsSync(contextPath)) {
        fileWarning = `CONTEXT.md not found at ${contextPath} — using standard`;
      } else {
        frontmatterValue = readProfileField(contextPath);
      }
    }

    result = resolveProfile(flagValue, frontmatterValue);
    // A valid flag still wins over a missing/unreadable CONTEXT.md.
    if (fileWarning && !result.warning && result.source !== 'flag') {
      result.warning = fileWarning;
    }
  } catch (e) {
    result = {
      profile: DEFAULT_PROFILE,
      source: 'default',
      warning: `profile resolution failed (${e && e.message}) — using standard`,
      knobs: knobsFor(DEFAULT_PROFILE),
    };
  }

  // No process.exit() here: stdout to a pipe is asynchronous on Windows, and
  // the go skill reads this payload through one. An explicit exit can truncate
  // a pending write, and a truncated payload fails the skill's JSON.parse —
  // exactly the resolution hiccup that must never kill a go run. No path sets a
  // non-zero code, so falling off the end already exits 0 once stdout drains.
  process.stdout.write(JSON.stringify(result) + '\n');
}
