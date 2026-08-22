#!/usr/bin/env node
// Ship verify-scratch validator — decides whether ship-verifier's incremental
// scratch record at .planning/features/{slug}/.review-scratch/verify.json
// describes THIS build, and is therefore safe for a salvage retry to adopt.
//
// Why a helper and not agent prose: the verifier — unlike both reviewers —
// commits its own test files in Stage 2b, so a live-HEAD fingerprint
// self-invalidates on its first commit. The rule it needs instead is an
// ancestry rule, and git ancestry logic is fiddly to specify in prose and
// impossible to test as prose. As code, every rejection path is exercised
// against a real fixture repository.
//
// The rule: `base_head` is an ancestor of HEAD, AND every commit in
// `base_head..HEAD` is one of the record's own `tests[].commit`. A foreign
// commit in that range means the code moved under the verifier, so the record
// describes a different build.
//
// Zero dependencies. Validation degrades, never dies: any failure — garbage
// input, a non-git directory, a missing git binary, a nonexistent path —
// yields a reject verdict, and the CLI always exits 0 with valid JSON. The safe
// direction is always reject: a wrongly rejected record costs a
// re-verification, a wrongly accepted one reports a verification that did not
// happen.
//
// Usage: node verify-scratch.cjs <feature-slug> [--cwd <dir>]

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/** The three stages a record can be stamped with, in the order they occur. */
const RECORD_STAGES = Object.freeze(['criteria', 'bughunt', 'complete']);

/**
 * Where the verifier's incremental record lives for a feature.
 *
 * @param {string} featureSlug
 * @param {string} cwd
 * @returns {string}
 */
function recordPath(featureSlug, cwd) {
  return path.join(cwd, '.planning', 'features', featureSlug, '.review-scratch', 'verify.json');
}

/**
 * Run git, degrading instead of throwing when the binary is absent.
 *
 * @param {string[]} args
 * @param {string} cwd
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function git(args, cwd) {
  try {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.error) return { status: 1, stdout: '', stderr: String(r.error.message || r.error) };
    return {
      status: typeof r.status === 'number' ? r.status : 1,
      stdout: typeof r.stdout === 'string' ? r.stdout : '',
      stderr: typeof r.stderr === 'string' ? r.stderr : '',
    };
  } catch (e) {
    return { status: 1, stdout: '', stderr: String((e && e.message) || e) };
  }
}

/**
 * Parse and shape-check a raw record. Records predating this contract — no
 * `stage` key, no `base_head` — are rejected rather than guessed at, matching
 * how both existing reviewer contracts treat unstamped records.
 *
 * @param {string} text
 * @returns {{ ok: true, record: object } | { ok: false, reason: string }}
 */
function parseRecord(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, reason: 'scratch record is empty' };
  }

  let record;
  try {
    record = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: `scratch record is malformed JSON (${(e && e.message) || e})` };
  }

  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: 'scratch record is not a JSON object' };
  }

  if (typeof record.base_head !== 'string' || record.base_head.trim() === '') {
    return { ok: false, reason: 'scratch record has no base_head — it cannot be fingerprinted against this build' };
  }

  if (!Object.prototype.hasOwnProperty.call(record, 'stage')) {
    return {
      ok: false,
      reason: 'scratch record has no stage key — unstamped, pre-contract shape; rejected rather than guessed at',
    };
  }

  if (typeof record.stage !== 'string' || RECORD_STAGES.indexOf(record.stage) === -1) {
    return {
      ok: false,
      reason: `scratch record stage '${String(record.stage)}' is not one of ${RECORD_STAGES.join('|')}`,
    };
  }

  if (Object.prototype.hasOwnProperty.call(record, 'feature') && typeof record.feature !== 'string') {
    return { ok: false, reason: 'scratch record feature is not a string' };
  }

  if (Object.prototype.hasOwnProperty.call(record, 'tests') && record.tests !== null) {
    if (!Array.isArray(record.tests)) {
      return { ok: false, reason: 'scratch record tests is not an array' };
    }
    for (const entry of record.tests) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return { ok: false, reason: 'scratch record tests entry is not an object' };
      }
      if (typeof entry.commit !== 'string' || entry.commit.trim() === '') {
        return { ok: false, reason: 'scratch record tests entry has no commit string' };
      }
    }
  }

  return { ok: true, record };
}

function reject(reason) {
  return { valid: false, reason, stage: null, record: null };
}

/**
 * Full verdict on a feature's scratch record.
 *
 * @param {string} featureSlug
 * @param {string} cwd
 * @returns {{ valid: boolean, reason: string|null, stage: string|null, record: object|null }}
 */
function validateRecord(featureSlug, cwd) {
  try {
    const dir = typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd();
    if (typeof featureSlug !== 'string' || featureSlug.trim() === '') {
      return reject('no feature named — nothing to validate');
    }

    const file = recordPath(featureSlug, dir);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      return reject(`no scratch record at ${file}`);
    }

    const parsed = parseRecord(text);
    if (!parsed.ok) return reject(parsed.reason);
    const record = parsed.record;

    const headRun = git(['rev-parse', 'HEAD'], dir);
    const headSha = headRun.stdout.trim();
    if (headRun.status !== 0 || headSha === '') {
      return reject(`cannot resolve HEAD in ${dir} — not a git repository, or git is unavailable`);
    }

    const baseRun = git(['rev-parse', '--verify', `${record.base_head}^{commit}`], dir);
    const baseSha = baseRun.stdout.trim();
    if (baseRun.status !== 0 || baseSha === '') {
      return reject(`base_head ${record.base_head} is not a commit known to this repository`);
    }

    const ancestry = git(['merge-base', '--is-ancestor', baseSha, headSha], dir);
    if (ancestry.status !== 0) {
      return reject(`base_head ${record.base_head} is not an ancestor of HEAD — the record is from a different build`);
    }

    const rangeRun = git(['rev-list', `${baseSha}..${headSha}`], dir);
    if (rangeRun.status !== 0) {
      return reject(`cannot list commits in ${record.base_head}..HEAD (${rangeRun.stderr.trim()})`);
    }
    const range = rangeRun.stdout.split('\n').map((l) => l.trim()).filter(Boolean);

    // The record's own commits, fully resolved. `tests[].commit` may be short
    // hashes (the builder/verifier convention) while rev-list emits full SHAs,
    // so both sides must be compared as resolved SHAs. An unresolvable hash is
    // a reject, not a skip — skipping it would let a foreign commit pass as
    // one of ours.
    const own = new Set();
    const tests = Array.isArray(record.tests) ? record.tests : [];
    for (const entry of tests) {
      const run = git(['rev-parse', '--verify', `${entry.commit}^{commit}`], dir);
      const sha = run.stdout.trim();
      if (run.status !== 0 || sha === '') {
        return reject(`recorded test commit ${entry.commit} cannot be resolved in this repository`);
      }
      own.add(sha);
    }

    for (const sha of range) {
      if (!own.has(sha)) {
        return reject(
          `commit ${sha} in ${record.base_head}..HEAD is not one of the record's own test commits — the code moved under the verifier`
        );
      }
    }

    return { valid: true, reason: null, stage: record.stage, record };
  } catch (e) {
    return reject(`validation failed (${(e && e.message) || e})`);
  }
}

module.exports = { RECORD_STAGES, recordPath, parseRecord, validateRecord };

if (require.main === module) {
  let result;
  try {
    const argv = process.argv.slice(2);
    let slug = null;
    let cwd = null;

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '--cwd') {
        // Consume the following entry so it is never mistaken for the slug:
        // `--cwd /tmp my-feature` must resolve my-feature, not /tmp.
        cwd = argv[i + 1] !== undefined ? argv[i + 1] : null;
        i++;
      } else if (arg.startsWith('--cwd=')) {
        cwd = arg.slice('--cwd='.length);
      } else if (!arg.startsWith('--') && slug === null) {
        slug = arg;
      }
    }

    result = validateRecord(slug, cwd || process.cwd());
  } catch (e) {
    result = reject(`validation failed (${(e && e.message) || e})`);
  }

  // No process.exit(): stdout to a pipe is asynchronous, and an explicit exit
  // can truncate a pending write. No path sets a non-zero code, so falling off
  // the end already exits 0 once stdout drains.
  process.stdout.write(JSON.stringify(result) + '\n');
}
