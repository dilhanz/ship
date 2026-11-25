#!/usr/bin/env node
// Ship finish record — the file operations /ship:finish performs on a feature's
// record: stamping CONTEXT.md frontmatter, archiving the directory, and moving
// the ledger row to `## Shipped`.
//
// They live here rather than as `node -e` programs and shell loops in the skill
// body because a worktree-isolated Claude Code session refuses a Bash command it
// cannot verify (a shell function, a `for` loop, a heredoc), and every refusal
// costs a turn. A skill step is now one plain
// `node finish-record.cjs <command> <args>`.
//
// Two archive modes, chosen from git rather than configured:
//
// - **tracked** — `.planning/features/{slug}/` is in git. The archive happens
//   inside the current branch: `git mv` to `.planning/archive/{slug}/`, the
//   ledger row moves in this checkout's tracked `.planning/LEDGER.md`, and one
//   commit records both, so the pull request carries the archive and the merge
//   lands it on main. Moving the directory into the main checkout instead would
//   leave an untracked archive copy beside the branch's tracked feature
//   directory, to be reconciled by a separate commit on main.
// - **untracked** — the record is not in git. The directory moves to the main
//   worktree's `.planning/archive/` and the ledger row moves in the main
//   worktree's `.planning/LEDGER.md`, exactly as before.
//
// Either way `AUTO.json` (a /ship:auto run record) is deleted first, and in
// tracked mode also removed from the index, so it is never archived.
//
// Zero dependencies. The CLI prints one JSON line and always exits 0; failures
// come back as `{ ok: false, warning }`. No process.exit().
//
// Usage (from the checkout that holds the feature):
//   node finish-record.cjs stamp <slug> <pr|outcome> <value>
//   node finish-record.cjs archive <slug>

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { isValidSlug } = require(path.join(__dirname, 'plan-parse.cjs'));

const STAMP_KEYS = ['pr', 'outcome'];
const OUTCOMES = ['shipped', 'abandoned', 'superseded', 'umbrella'];
const AUTO_FILES = ['AUTO.json', 'AUTO.json.lock'];

function fail(warning, extra) {
  return Object.assign({ ok: false, warning }, extra || {});
}

function firstLine(e) {
  const stderr = e && e.stderr ? String(e.stderr).trim() : '';
  return (stderr || String((e && e.message) || e)).split('\n')[0];
}

function resolveCwd(opts) {
  const o = opts || {};
  return typeof o.cwd === 'string' && o.cwd !== '' ? o.cwd : process.cwd();
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** The main worktree root, or null when cwd is not inside a git repository. */
function mainRoot(cwd) {
  try {
    return path.dirname(git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  } catch (e) {
    return null;
  }
}

/** The checkout's top level, or null outside a repository. */
function topLevel(cwd) {
  try {
    return git(cwd, ['rev-parse', '--show-toplevel']);
  } catch (e) {
    return null;
  }
}

function isTracked(cwd, rel) {
  try {
    return git(cwd, ['ls-files', '--', rel]) !== '';
  } catch (e) {
    return false;
  }
}

/**
 * Set `key: value` in the leading frontmatter block: replace an existing line,
 * else insert it directly after `status:`, else append it to the block. Every
 * other byte is left alone.
 *
 * @returns {string|null} the new text, or null when there is no frontmatter block
 */
function setFrontmatter(text, key, value) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  let fm = m[1];
  const line = new RegExp('^' + key + ':.*$', 'm');
  if (line.test(fm)) {
    fm = fm.replace(line, () => key + ': ' + value);
  } else {
    fm = fm.replace(/^status:.*$/m, (l) => l + '\n' + key + ': ' + value);
    if (!line.test(fm)) fm += '\n' + key + ': ' + value;
  }
  return text.slice(0, m.index) + '---\n' + fm + '\n---' + text.slice(m.index + m[0].length);
}

/**
 * Stamp `pr:` or `outcome:` into the feature's CONTEXT.md frontmatter. An empty
 * value, an unknown outcome or a file with no frontmatter writes nothing: an
 * absent field is a recorded gap, a blank one would be a false record.
 */
function stamp(slug, key, value, opts) {
  if (!isValidSlug(slug)) return fail(`invalid slug '${slug}'`);
  if (!STAMP_KEYS.includes(key)) return fail(`unknown key '${key}' — expected pr or outcome`);
  const v = typeof value === 'string' ? value.trim() : '';
  if (v === '') return fail(`empty ${key} value — nothing stamped`);
  if (/[\r\n]/.test(v)) return fail(`${key} value spans lines — nothing stamped`);
  if (key === 'outcome' && !OUTCOMES.includes(v)) {
    return fail(`unknown outcome '${v}' — expected ${OUTCOMES.join(', ')}`);
  }
  if (key === 'pr' && !/^https?:\/\/\S+$/.test(v)) return fail(`pr value '${v}' is not a URL — nothing stamped`);
  try {
    const ctx = path.join(resolveCwd(opts), '.planning', 'features', slug, 'CONTEXT.md');
    if (!fs.existsSync(ctx)) return fail(`CONTEXT.md not found for ${slug}`);
    const next = setFrontmatter(fs.readFileSync(ctx, 'utf8'), key, v);
    if (next === null) return fail(`CONTEXT.md for ${slug} has no frontmatter block — nothing stamped`);
    fs.writeFileSync(ctx, next);
    return { ok: true, stamped: key, value: v };
  } catch (e) {
    return fail(`stamp failed (${firstLine(e)})`);
  }
}

/**
 * Move the slug's row to the top of `## Shipped` in `ledgerPath`, adding one when
 * no row exists. An absent ledger is not an error: a project that never made
 * one is skipped.
 *
 * @returns {'moved'|'absent'}
 */
function closeLedgerRow(ledgerPath, slug) {
  if (!fs.existsSync(ledgerPath)) return 'absent';
  const row = '- [x] ' + slug + ' → .planning/archive/' + slug + '/';
  const text = fs.readFileSync(ledgerPath, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const trailingNewline = lines.length > 1 && lines[lines.length - 1] === '';
  if (trailingNewline) lines.pop();
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rowRe = new RegExp('^- \\[[ x]\\] \\*{0,2}' + escaped + '\\*{0,2}(\\s|$|—|→)');
  const out = lines.filter((l) => !rowRe.test(l.trim()));
  const i = out.findIndex((l) => /^##\s+Shipped\s*$/.test(l));
  if (i === -1) {
    out.push('', '## Shipped', row);
  } else {
    // Drop the `_(empty)_` placeholder, then put the row above the first
    // existing row, or directly under the heading when the section is empty.
    let j = i + 1;
    while (j < out.length && !/^##\s/.test(out[j])) {
      if (out[j].trim() === '_(empty)_') out.splice(j, 1);
      else j++;
    }
    let k = i + 1;
    while (k < j && out[k].trim() === '') k++;
    out.splice(k < j ? k : i + 1, 0, row);
  }
  fs.writeFileSync(ledgerPath, out.join(eol) + (trailingNewline ? eol : ''));
  return 'moved';
}

function removeRunRecord(featureDir) {
  for (const f of AUTO_FILES) {
    try {
      fs.unlinkSync(path.join(featureDir, f));
    } catch (e) {
      if (!e || e.code !== 'ENOENT') throw e;
    }
  }
}

function archiveTracked(slug, top) {
  const fromRel = path.posix.join('.planning', 'features', slug);
  const toRel = path.posix.join('.planning', 'archive', slug);
  const ledgerRel = path.posix.join('.planning', 'LEDGER.md');
  if (fs.existsSync(path.join(top, toRel))) {
    return fail(`.planning/archive/${slug} already exists — nothing moved`);
  }

  // The run record must not ride along: drop it from the index (it may have
  // been committed by an auto run) and from disk.
  git(top, ['rm', '-q', '--cached', '--ignore-unmatch', '--', ...AUTO_FILES.map((f) => `${fromRel}/${f}`)]);
  removeRunRecord(path.join(top, fromRel));

  fs.mkdirSync(path.join(top, '.planning', 'archive'), { recursive: true });
  git(top, ['mv', '--', fromRel, toRel]);
  // Stage the stamps made before the move and any untracked, non-ignored file
  // that travelled with the directory.
  git(top, ['add', '--', toRel]);

  const paths = [fromRel, toRel];
  let ledger;
  let ledgerWarning = null;
  try {
    if (isTracked(top, ledgerRel)) {
      ledger = closeLedgerRow(path.join(top, ledgerRel), slug);
      if (ledger === 'moved') {
        git(top, ['add', '--', ledgerRel]);
        paths.push(ledgerRel);
      }
    } else {
      const root = mainRoot(top) || top;
      ledger = closeLedgerRow(path.join(root, ledgerRel), slug);
    }
  } catch (e) {
    ledger = 'failed';
    ledgerWarning = `ledger not updated (${firstLine(e)})`;
  }

  git(top, ['commit', '-q', '-m', `chore(${slug}): archive the feature record`, '--', ...paths]);
  const commit = git(top, ['rev-parse', '--short', 'HEAD']);
  const result = { ok: true, mode: 'tracked', archived: toRel, ledger, commit };
  if (ledgerWarning) result.warning = ledgerWarning;
  return result;
}

function archiveUntracked(slug, cwd, top) {
  const root = (top && mainRoot(top)) || cwd;
  const from = path.join(cwd, '.planning', 'features', slug);
  const archiveDir = path.join(root, '.planning', 'archive');
  const to = path.join(archiveDir, slug);
  if (fs.existsSync(to)) return fail(`${to} already exists — nothing moved`);

  removeRunRecord(from);
  fs.mkdirSync(archiveDir, { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if (!e || e.code !== 'EXDEV') throw e;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }

  let ledger;
  let ledgerWarning = null;
  try {
    ledger = closeLedgerRow(path.join(root, '.planning', 'LEDGER.md'), slug);
  } catch (e) {
    ledger = 'failed';
    ledgerWarning = `ledger not updated (${firstLine(e)})`;
  }
  const result = { ok: true, mode: 'untracked', archived: to, ledger, commit: null };
  if (ledgerWarning) result.warning = ledgerWarning;
  return result;
}

/**
 * Archive the feature and close its ledger row. Run from the checkout that holds
 * `.planning/features/{slug}/`.
 */
function archive(slug, opts) {
  if (!isValidSlug(slug)) return fail(`invalid slug '${slug}'`);
  try {
    const cwd = resolveCwd(opts);
    const top = topLevel(cwd);
    const base = top || cwd;
    if (!fs.existsSync(path.join(base, '.planning', 'features', slug))) {
      return fail(`.planning/features/${slug} not found — nothing archived`);
    }
    if (top && isTracked(top, path.posix.join('.planning', 'features', slug))) {
      return archiveTracked(slug, top);
    }
    return archiveUntracked(slug, base, top);
  } catch (e) {
    return fail(`archive failed (${firstLine(e)})`);
  }
}

function run(argv, opts) {
  try {
    const args = Array.isArray(argv) ? argv.map(String) : [];
    const [command, slug, key, ...rest] = args;
    switch (command) {
      case 'stamp':
        return stamp(slug, key, rest.join(' '), opts);
      case 'archive':
        return archive(slug, opts);
      default:
        return fail(`unknown command '${command === undefined ? '' : command}' — expected stamp or archive`);
    }
  } catch (e) {
    return fail(`finish-record failed (${firstLine(e)})`);
  }
}

module.exports = { stamp, archive, closeLedgerRow, setFrontmatter, run };

if (require.main === module) {
  let result;
  try {
    result = run(process.argv.slice(2), { cwd: process.cwd() });
  } catch (e) {
    result = fail(`finish-record failed (${firstLine(e)})`);
  }
  // No process.exit(): an explicit exit can truncate the one line the skill parses.
  process.stdout.write(JSON.stringify(result) + '\n');
}
