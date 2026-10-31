#!/usr/bin/env node
// Ship review package — writes one file holding a phase range's commit log,
// diff stat and full diff (10 lines of context), so the phase reviewer reads
// one package instead of driving `git diff` itself turn after turn.
//
// Every git call is `execFileSync('git', [...])` with an args array, and the
// range is validated before git runs: a hostile value such as
// `--output=/tmp/x..HEAD` never reaches git as an option.
//
// Zero dependencies. One line of output. Success → exit 0 with
// `{repo-relative path} — {N} commit(s), {F} file(s), {L} diff line(s)`; an
// empty diff is still written and reports 0 file(s), so the reviewer can see
// it and fall back. Failure → `review-package: …`, exit 1, nothing written.
//
// Usage (from the repo root): node review-package.cjs <feature> <range> <scope>

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { isValidSlug } = require(path.join(__dirname, 'plan-parse.cjs'));

const MAX_BUFFER = 64 * 1024 * 1024;
const RANGE_RE = /^[A-Za-z0-9._~^/-]+\.\.[A-Za-z0-9._~^/-]+$/;

function fail(line) {
  return { ok: false, code: 1, path: null, line };
}

/** True when `range` is `{left}..{right}` with neither side option-like. */
function isValidRange(range) {
  if (typeof range !== 'string' || !RANGE_RE.test(range)) return false;
  const i = range.indexOf('..');
  const left = range.slice(0, i);
  const right = range.slice(i + 2);
  if (left === '' || right === '') return false;
  if (left.startsWith('-') || right.startsWith('-')) return false;
  return true;
}

class GitError extends Error {}

function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const stderr = e && e.stderr ? String(e.stderr).trim() : '';
    throw new GitError((stderr || String((e && e.message) || e)).split('\n')[0]);
  }
}

function nonEmptyLines(s) {
  return s.split('\n').filter((l) => l.trim() !== '');
}

/**
 * Build and write the review package for one range.
 *
 * @param {{ cwd?: string, feature: string, range: string, scope: string }} opts
 * @returns {{ ok: boolean, code: number, path: string|null, line: string }}
 */
function buildPackage(opts) {
  try {
    const o = opts || {};
    const cwd = typeof o.cwd === 'string' && o.cwd !== '' ? o.cwd : process.cwd();
    const { feature, range, scope } = o;

    if (!isValidSlug(feature)) return fail('review-package: invalid feature');
    if (!isValidRange(range)) return fail('review-package: invalid range');
    if (typeof scope !== 'string' || !/^[A-Za-z0-9._-]+$/.test(scope)) return fail('review-package: invalid scope');

    let log;
    let stat;
    let diff;
    let names;
    try {
      log = git(cwd, ['log', '--oneline', '--no-color', range]);
      stat = git(cwd, ['diff', '--stat', '--no-color', '--no-ext-diff', range]);
      diff = git(cwd, ['diff', '-U10', '--no-color', '--no-ext-diff', range]);
      names = git(cwd, ['diff', '--name-only', '--no-ext-diff', range]);
    } catch (e) {
      if (e instanceof GitError) return fail(`review-package: git failed — ${e.message}`);
      throw e;
    }

    const commits = nonEmptyLines(log).length;
    const files = nonEmptyLines(names).length;
    const diffLines = diff === '' ? 0 : diff.replace(/\n$/, '').split('\n').length;

    const content = [
      `# Review package — ${feature} — ${scope}`,
      '',
      `Range: ${range}`,
      '',
      '## Log',
      '',
      log.replace(/\n$/, ''),
      '',
      '## Stat',
      '',
      stat.replace(/\n$/, ''),
      '',
      '## Diff',
      '',
      diff.replace(/\n$/, ''),
      '',
    ].join('\n');

    const rel = path.posix.join('.planning', 'features', feature, '.review-scratch', `package-${scope}.md`);
    const abs = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);

    return {
      ok: true,
      code: 0,
      path: rel,
      line: `${rel} — ${commits} commit(s), ${files} file(s), ${diffLines} diff line(s)`,
    };
  } catch (e) {
    return fail(`review-package: error — ${String((e && e.message) || e).split('\n')[0]}`);
  }
}

module.exports = { buildPackage, isValidRange };

if (require.main === module) {
  let r;
  try {
    const [feature, range, scope] = process.argv.slice(2);
    r = buildPackage({ cwd: process.cwd(), feature, range, scope });
  } catch (e) {
    r = fail(`review-package: error — ${String((e && e.message) || e).split('\n')[0]}`);
  }
  process.stdout.write(String(r.line).split('\n')[0] + '\n');
  process.exitCode = r.code;
}
