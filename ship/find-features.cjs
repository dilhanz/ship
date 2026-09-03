#!/usr/bin/env node
// Ship feature finder — resolves feature slugs across every git worktree and
// the archive, so /ship:ledger, /ship:status, and /ship:resume can see a feature
// whose directory /ship:start moved into a linked worktree.
//
// Skills cannot share logic except by shelling out, so the lookup lives in
// exactly one place — here — as both a `require()`-able module and a CLI that
// prints one line of JSON. Location is derived from `git worktree list
// --porcelain` on every read and is never stored anywhere: a stored location
// would be a second writer across the very worktree boundary that broke the
// cwd-only glob, and a crashed build would leave it lying.
//
// Zero dependencies. Resolution degrades, never dies: no git, no repository,
// or any read failure falls back to the current checkout only (today's exact
// behavior) plus a warning, and the CLI always exits 0 with valid JSON.
//
// Usage: node find-features.cjs [slug]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Parse `git worktree list --porcelain` output. Blocks are separated by blank
 * lines; the first block git prints is always the main worktree.
 *
 * @param {string} porcelain
 * @returns {{ path: string, branch: string|null, head: string|null, isMain: boolean }[]}
 */
function parseWorktreeList(porcelain) {
  const blocks = String(porcelain || '').replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const entries = [];

  for (const block of blocks) {
    let wtPath = null;
    let branch = null;
    let head = null;

    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('worktree ')) wtPath = line.slice('worktree '.length).trim();
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length).trim() || null;
      else if (line.startsWith('branch ')) branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '') || null;
      else if (line === 'detached' || line === 'bare') branch = null;
    }

    if (!wtPath) continue;
    entries.push({ path: wtPath, branch, head, isMain: entries.length === 0 });
  }

  return entries;
}

function safeRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch (e) {
    return p;
  }
}

/** True when `dir` is `parent` itself or lives beneath it (path-segment aware). */
function isWithin(parent, dir) {
  if (dir === parent) return true;
  const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return dir.startsWith(prefix);
}

/** Shorten a spawn failure to something a one-line warning can carry. */
function shortReason(err) {
  if (!err) return 'unknown error';
  if (err.code === 'ENOENT') return 'git not found';
  if (typeof err.status === 'number') return `git exited ${err.status}`;
  return String(err.message || err).split('\n')[0];
}

function fallbackEntry(cwd) {
  return { path: cwd, branch: null, head: null, isMain: true, isCwd: true };
}

/**
 * Enumerate worktrees with one `git worktree list --porcelain` call and mark
 * the one holding `cwd`. When git is unreachable, not a repository, or emits
 * nothing parsable, the cwd is treated as the sole main worktree.
 *
 * @param {string} cwd
 * @param {{ env?: object }} [options]
 * @returns {{ worktrees: object[], warning: string|null }}
 */
function listWorktrees(cwd, options) {
  const env = (options && options.env) || process.env;
  let parsed;

  try {
    const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    parsed = parseWorktreeList(out);
  } catch (e) {
    return {
      worktrees: [fallbackEntry(cwd)],
      warning: `git worktree list unavailable (${shortReason(e)}) — resolving from the current checkout only`,
    };
  }

  if (parsed.length === 0) {
    return {
      worktrees: [fallbackEntry(cwd)],
      warning: 'git worktree list unavailable (empty output) — resolving from the current checkout only',
    };
  }

  const realCwd = safeRealpath(cwd);
  let best = -1;
  let bestLength = -1;
  parsed.forEach((entry, i) => {
    const realPath = safeRealpath(entry.path);
    if (isWithin(realPath, realCwd) && realPath.length > bestLength) {
      best = i;
      bestLength = realPath.length;
    }
  });

  const worktrees = parsed.map((entry, i) => Object.assign({}, entry, { isCwd: i === best }));
  const warning = best === -1
    ? `the current directory (${cwd}) is outside every worktree — no checkout is marked as here`
    : null;

  return { worktrees, warning };
}

/**
 * Read `status:` from a CONTEXT.md's leading frontmatter block only — a body
 * line like `status: done` in prose must not win. Terminal statuses are kept:
 * the ledger must render `[done]` for a finished-but-unarchived feature.
 *
 * @param {string} contextPath
 * @returns {string|null} the status, 'unknown' when absent, null when unreadable
 */
function readStatus(contextPath) {
  let content;
  try {
    content = fs.readFileSync(contextPath, 'utf8');
  } catch (e) {
    return null;
  }

  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return 'unknown';

  const field = block[1].match(/^status:\s*(.+?)\s*$/m);
  if (!field) return 'unknown';

  let value = field[1].trim();
  if (value.length >= 2 && ((value[0] === '"' && value[value.length - 1] === '"') || (value[0] === "'" && value[value.length - 1] === "'"))) {
    value = value.slice(1, -1).trim();
  }
  return value === '' ? 'unknown' : value;
}

/**
 * Resolve features across every worktree and the archive.
 *
 * @param {{ cwd?: string, slug?: string|null, env?: object }} [options]
 * @returns {{ cwd: string, cwdRoot: string|null, mainRoot: string, worktrees: object[], features: object, warning: string|null }}
 */
function findFeatures(options) {
  const opts = options || {};
  const cwd = opts.cwd || process.cwd();
  const { worktrees, warning } = listWorktrees(cwd, { env: opts.env });

  const main = worktrees.find(w => w.isMain) || worktrees[0];
  const here = worktrees.find(w => w.isCwd) || null;

  return {
    cwd,
    cwdRoot: here ? here.path : null,
    mainRoot: main.path,
    worktrees,
    features: {},
    warning,
  };
}

module.exports = { parseWorktreeList, listWorktrees, readStatus, findFeatures };

if (require.main === module) {
  const cwd = process.cwd();
  let result;
  try {
    const slug = process.argv.slice(2).find(arg => !arg.startsWith('--')) || null;
    result = findFeatures({ cwd, slug });
  } catch (e) {
    result = {
      cwd,
      cwdRoot: cwd,
      mainRoot: cwd,
      worktrees: [fallbackEntry(cwd)],
      features: {},
      warning: `feature lookup failed (${e && e.message}) — resolving from the current checkout only`,
    };
  }

  // No process.exit() here: stdout to a pipe is asynchronous on Windows, and
  // the ledger/status/resume skills read this payload through one. An explicit
  // exit can truncate a pending write, and a truncated payload fails the
  // skill's JSON.parse — exactly the lookup hiccup that must never break
  // /ship:ledger. No path sets a non-zero code, so falling off the end already
  // exits 0 once stdout drains.
  process.stdout.write(JSON.stringify(result) + '\n');
}
