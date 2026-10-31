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
// It also resolves the top-level `buildMode` rollout knob (per-task | per-phase),
// which is deliberately not a profile knob: flag > SHIP_BUILD_MODE env > per-task.
//
// Usage: node resolve-profile.cjs <feature-slug> [--profile <value>] [--build-mode <value>]

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

const BUILD_MODES = Object.freeze(['per-task', 'per-phase']);
const DEFAULT_BUILD_MODE = 'per-task';

/**
 * Resolve the build-mode rollout knob. Precedence: flag > env > per-task.
 * `per-phase` is the rollback to the pre-diet one-builder-per-phase path.
 *
 * @param {string|null|undefined} flagValue
 * @param {string|null|undefined} [envValue] defaults to process.env.SHIP_BUILD_MODE
 * @returns {{ buildMode: string, source: 'flag'|'env'|'default', warning: string|null }}
 */
function resolveBuildMode(flagValue, envValue = process.env.SHIP_BUILD_MODE) {
  const fromFlag = normalize(flagValue);
  const fromEnv = normalize(envValue);

  let candidate = '';
  let source = 'default';
  if (fromFlag) {
    candidate = fromFlag;
    source = 'flag';
  } else if (fromEnv) {
    candidate = fromEnv;
    source = 'env';
  }

  if (!candidate) return { buildMode: DEFAULT_BUILD_MODE, source: 'default', warning: null };

  if (!BUILD_MODES.includes(candidate)) {
    return {
      buildMode: DEFAULT_BUILD_MODE,
      source: 'default',
      warning: `unrecognized build mode '${candidate}' (from ${source}) — using per-task`,
    };
  }

  return { buildMode: candidate, source, warning: null };
}

module.exports = { PROFILES, DEFAULT_PROFILE, resolveProfile, readProfileField, resolveBuildMode };

if (require.main === module) {
  let result;
  try {
    const argv = process.argv.slice(2);
    let flagValue = null;
    let buildModeFlag = null;
    let slug = null;

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '--profile') {
        flagValue = argv[i + 1] !== undefined ? argv[i + 1] : null;
        i++;
      } else if (arg.startsWith('--profile=')) {
        flagValue = arg.slice('--profile='.length);
      } else if (arg === '--build-mode') {
        buildModeFlag = argv[i + 1] !== undefined ? argv[i + 1] : null;
        i++;
      } else if (arg.startsWith('--build-mode=')) {
        buildModeFlag = arg.slice('--build-mode='.length);
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

    const mode = resolveBuildMode(buildModeFlag, process.env.SHIP_BUILD_MODE);
    result.buildMode = mode.buildMode;
    result.buildModeSource = mode.source;
    if (mode.warning) {
      result.warning = result.warning ? `${result.warning}; ${mode.warning}` : mode.warning;
    }
  } catch (e) {
    result = {
      profile: DEFAULT_PROFILE,
      source: 'default',
      warning: `profile resolution failed (${e && e.message}) — using standard`,
      knobs: knobsFor(DEFAULT_PROFILE),
      buildMode: DEFAULT_BUILD_MODE,
      buildModeSource: 'default',
    };
  }

  // No process.exit() here: stdout to a pipe is asynchronous on Windows, and
  // the go skill reads this payload through one. An explicit exit can truncate
  // a pending write, and a truncated payload fails the skill's JSON.parse —
  // exactly the resolution hiccup that must never kill a go run. No path sets a
  // non-zero code, so falling off the end already exits 0 once stdout drains.
  process.stdout.write(JSON.stringify(result) + '\n');
}
