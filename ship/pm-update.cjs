#!/usr/bin/env node
// Ship PM mechanical updater — applies the pm-state status mapping table to
// .project-manager/ROADMAP.md rows and regenerates dashboard.html
// deterministically from the state files. `--next` prints the recommended
// next item as JSON without writing anything.
//
// Zero dependencies. Invoked by lifecycle skills after CONTEXT.md status
// changes: `node pm-update.cjs [slug ...]`. The .project-manager/ sync is a
// silent no-op when that directory is absent; the `lane:` stamp each named
// slug's CONTEXT.md receives (see stampLane) runs regardless, since lane
// ownership is not conditional on a PM directory existing.
//
// .project-manager/ paths resolve to the main worktree root when the
// directory is gitignored (see resolve-state-root.cjs); feature status is
// still read from the invoking worktree's .planning/.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveStateRoot } = require('./resolve-state-root.cjs');

// The fixed tombstone set, owned by hooks/scan-features.cjs — imported rather
// than re-declared so the two surfaces can never disagree about what
// "finished" means. Resolved once at load, across the same ship/ -> hooks/
// boundary lane-sweep.cjs already crosses; an absent or broken module
// degrades to the same literal set, so stamping keeps working as today.
const TERMINAL_STATUSES = (() => {
  try {
    const imported = require('../hooks/scan-features.cjs').TERMINAL_STATUSES;
    if (imported && typeof imported.has === 'function') return imported;
  } catch (e) {
    // fall through to the local copy
  }
  return new Set(['done', 'superseded', 'abandoned', 'cancelled']);
})();

/**
 * Parse ROADMAP.md backlog tables into row records.
 *
 * Columns are located by header *name*, not position or count, so every shape the
 * project has ever written parses — including two tables of different widths in the
 * same file, and columns in any order:
 *
 *   5-column legacy:  `| Item | Status | Priority | Depends on | Ship feature |`
 *   8-column current: adds `Size`, `Source`, `Lane`
 *   10-column:        adds the optional `Blast radius` and `Confidence` evidence columns
 *   11-column:        adds the script-stamped `First seen`
 *
 * A column the header does not carry is simply absent from the parsed row; callers
 * read an absent evidence column as `unknown` (see derivePriority) rather than
 * treating the narrow shape as a parse failure.
 *
 * A table row is any line that starts and ends with `|`. A row is a header when its
 * cells include `Item`, `Status`, and `Ship feature`; that header becomes the active
 * context (column count + indexes) for the rows beneath it. Rows before any header,
 * rows whose cell count differs from their header's, and separator rows contribute
 * nothing. A non-blank, non-table line ends the active table, so a later table can
 * never inherit the previous header's layout.
 *
 * Unlike the nudge hook's parser, rows *without* a Ship feature slug are still
 * returned (marked slugless) — `--next` selection needs them.
 *
 * @param {string} content
 * @returns {{ lineIndex: number, milestone: string|null, headers: string[],
 *             cells: Object<string,string>, statusIndex: number,
 *             slug: string|null, slugless: boolean, recorded: string }[]}
 */
function parseRoadmap(content) {
  const rows = [];
  const lines = content.split('\n');
  let ctx = null;
  let milestone = null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
      // Blank lines may separate a header from its rows; anything else ends the table.
      if (trimmed !== '') {
        ctx = null;
        if (trimmed.startsWith('### ')) {
          milestone = trimmed.slice(4).replace(/\s*\(status:[^)]*\)\s*$/, '').trim();
        }
      }
      continue;
    }

    const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());

    const itemIdx = cells.indexOf('Item');
    const statusIdx = cells.indexOf('Status');
    const slugIdx = cells.indexOf('Ship feature');
    if (itemIdx !== -1 && statusIdx !== -1 && slugIdx !== -1) {
      ctx = { columnCount: cells.length, headers: cells, statusIdx, slugIdx };
      continue;
    }

    if (!ctx) continue; // a table without the required headers contributes nothing
    if (cells.every(c => /^:?-+:?$/.test(c))) continue; // separator row
    if (cells.length !== ctx.columnCount) continue; // malformed row (e.g. stray pipe)

    const named = {};
    for (let c = 0; c < ctx.headers.length; c++) named[ctx.headers[c]] = cells[c];

    const rawSlug = cells[ctx.slugIdx];
    const slugless = !rawSlug || rawSlug === '—' || rawSlug === '-';
    rows.push({
      lineIndex: i,
      milestone,
      headers: ctx.headers,
      cells: named,
      statusIndex: ctx.statusIdx,
      slug: slugless ? null : rawSlug,
      slugless,
      recorded: cells[ctx.statusIdx]
    });
  }

  return rows;
}

/**
 * A Ship feature slug is one directory name under `.planning/features/`, so it
 * must be a single path segment. A cell holding `..`, a separator, or a drive
 * letter is not a slug — joining it would resolve outside the feature tree and
 * let any unrelated directory decide a row's status.
 *
 * @param {string} slug
 * @returns {boolean}
 */
function isValidSlug(slug) {
  return typeof slug === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug);
}

/**
 * Read the leading YAML frontmatter block, or null when there is none.
 * CRLF-tolerant — a file that has passed through git on Windows still parses.
 *
 * @param {string} content
 * @returns {string|null}
 */
function frontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : null;
}

/**
 * Resolve the base branch ref a merge is measured against, the way
 * `/ship:finish` picks it: `main` when it exists, else `master`, else null.
 * The remote is preferred when it resolves (`origin/{base}`), because a lane's
 * local base can be arbitrarily stale — and a stale local base can only ever
 * produce `awaiting-merge`, never a false `done`.
 *
 * Every git call is a captured `spawnSync`, so nothing reaches stdout or
 * stderr and the caller's exit code is never touched. Never throws: a null
 * result, a non-zero status, an absent git binary, or any exception means the
 * ref did not resolve.
 *
 * @param {string} cwd
 * @returns {string|null} the base ref, or null when there is none
 */
function resolveBaseRef(cwd) {
  try {
    const resolves = ref => {
      const run = spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd, encoding: 'utf8' });
      return !!run && run.status === 0;
    };

    let base = null;
    if (resolves('refs/heads/main')) base = 'main';
    else if (resolves('refs/heads/master')) base = 'master';
    if (base === null) return null;

    return resolves(`refs/remotes/origin/${base}`) ? `origin/${base}` : base;
  } catch (e) {
    return null; // silent by contract
  }
}

/**
 * Test whether an archived feature's work actually reached the base branch,
 * anchored on the `**Head:**` commit the verifier stamps into VERIFY.md.
 *
 * Archiving is a directory move, not a merge: `/ship:finish` Option 1 opens a
 * PR and the session ends, so nothing comes back later to record the merge.
 * Git ancestry self-heals instead — the answer flips to `done` on the first
 * run after the PR lands, and the stamp survives branch deletion, which a
 * branch-name lookup would not.
 *
 * Returns one of four values rather than a nullable status, so the gating
 * decision is testable in isolation from mappedStatus's other branches:
 *
 * - `'no-stamp'`   — no VERIFY.md, unreadable, or no `**Head:**` line. Not
 *                    evidence *against* a merge (~60 archives predate the
 *                    stamp), so the caller keeps today's `done`.
 * - `'done'`       — the stamped head is an ancestor of the base.
 * - `'awaiting-merge'` — it is not.
 * - `'inconclusive'` — no base ref, an unresolvable commit, or any git
 *                    failure. The caller leaves the row unchanged; the safe
 *                    direction is never to claim `done`.
 *
 * Silent on both streams; never throws.
 *
 * @param {string} cwd
 * @param {string} slug
 * @returns {'done'|'awaiting-merge'|'inconclusive'|'no-stamp'}
 */
function archiveMergeStatus(cwd, slug) {
  try {
    const { content } = readArtifact(path.join(cwd, '.planning', 'archive', slug, 'VERIFY.md'));
    if (content === null) return 'no-stamp'; // absent OR unreadable

    const stamp = content.match(/^\*\*Head:\*\*\s*([0-9a-fA-F]{7,40})\b/m);
    if (!stamp) return 'no-stamp';

    const base = resolveBaseRef(cwd);
    if (base === null) return 'inconclusive';

    const run = spawnSync('git', ['merge-base', '--is-ancestor', stamp[1], base], { cwd, encoding: 'utf8' });
    if (!run) return 'inconclusive';
    if (run.status === 0) return 'done';
    if (run.status === 1) return 'awaiting-merge';
    return 'inconclusive'; // 128 for an unresolvable commit, null for a missing binary
  } catch (e) {
    return 'inconclusive'; // silent by contract
  }
}

/**
 * The pm-state status mapping table, mechanically applied.
 * Returns the status the row should record, or null for "unchanged"
 * (recorded `blocked` on an active feature, slug found nowhere, a slug that is
 * not a usable path segment, or an archive whose merge test was inconclusive).
 * Never invents a status.
 *
 * An archived slug resolves through archiveMergeStatus, so a feature whose
 * stamped head has not reached the base branch records `awaiting-merge`
 * instead of `done`. A stamp-less archive still records `done`.
 *
 * @param {string} cwd
 * @param {string} slug
 * @param {string} recorded - the row's currently recorded status
 * @returns {string|null}
 */
function mappedStatus(cwd, slug, recorded) {
  if (!isValidSlug(slug)) return null; // not a slug — never let it reach path.join

  try {
    if (fs.existsSync(path.join(cwd, '.planning', 'archive', slug))) {
      // Archived is where the work went, not proof it merged — ask git.
      const merge = archiveMergeStatus(cwd, slug);
      if (merge === 'awaiting-merge') return 'awaiting-merge';
      if (merge === 'inconclusive') return null; // unchanged; never invented
      return 'done'; // 'done', and 'no-stamp' keeps today's answer byte-for-byte
    }
  } catch (e) {
    // treat an unreadable archive as absent
  }

  const contextPath = path.join(cwd, '.planning', 'features', slug, 'CONTEXT.md');
  let content = null;
  try {
    if (fs.existsSync(contextPath)) content = fs.readFileSync(contextPath, 'utf8');
  } catch (e) {
    // unreadable CONTEXT.md falls through to slug-found-nowhere
  }
  if (content === null) return null; // slug found nowhere — .planning/ may be gitignored or pruned

  // Status is frontmatter state, so only the frontmatter block is searched — a
  // `status:` line in the body is prose. A CONTEXT.md with no frontmatter status
  // still means the feature exists, which the mapping table calls `in-progress`.
  const fm = frontmatter(content);
  const statusMatch = fm === null ? null : fm.match(/^status:\s*(.+)$/m);
  const featureStatus = statusMatch ? statusMatch[1].trim() : null;
  if (featureStatus === 'done') return 'done';

  // Feature is active: recorded `blocked` is a PM judgment, never auto-overridden.
  if ((recorded || '').toLowerCase() === 'blocked') return null;
  return 'in-progress';
}

/**
 * Apply the status mapping to matching rows, editing only Status cells —
 * every other byte of every row stays identical. When at least one cell
 * changed, the frontmatter `updated` value is bumped to today (quoted form).
 *
 * A row whose `Kind` cell is `debt` is skipped entirely: verification debt
 * closes when a human says it did, not when the feature it is about lands in
 * the archive. `work`, an empty cell, and a table with no `Kind` column all
 * reconcile exactly as they do today.
 *
 * @param {string} content - ROADMAP.md content
 * @param {string} cwd
 * @param {string[]} slugs - restrict to these slugs; empty means all slugged rows
 * @returns {{ content: string, changed: boolean }}
 */
function applyStatusUpdates(content, cwd, slugs) {
  const lines = content.split('\n');
  let changed = false;

  for (const row of parseRoadmap(content)) {
    if (row.slugless) continue;
    if (slugs && slugs.length > 0 && !slugs.includes(row.slug)) continue;
    // A `debt` row keeps its slug for traceability but is never reconciled off
    // that feature's archive — the archive is what the debt is *about*, so
    // mapping it would auto-close the row it exists to keep open. Checked
    // before mappedStatus so a debt row costs no filesystem work. An absent
    // Kind column (or an empty cell) means every row is `work`, which is
    // today's behaviour byte-for-byte.
    if ((row.cells.Kind || '').trim().toLowerCase() === 'debt') continue;

    const next = mappedStatus(cwd, row.slug, row.recorded);
    if (next === null) continue;
    if (next.toLowerCase() === row.recorded.toLowerCase()) continue;

    // Edit only the Status segment of the raw line; segment 0 is whatever
    // precedes the first `|`, so cell i lives at segment i + 1.
    const segments = lines[row.lineIndex].split('|');
    segments[row.statusIndex + 1] = ` ${next} `;
    lines[row.lineIndex] = segments.join('|');
    changed = true;
  }

  if (!changed) return { content, changed: false };

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return { content: bumpUpdated(lines.join('\n'), today), changed: true };
}

/**
 * Stamp `today` into every empty `First seen` cell, recording when the script
 * first saw the row.
 *
 * A row that already carries any non-empty, non-dash value is left untouched:
 * the stamp is a first-sight record and is never rewritten. When the header
 * has no `First seen` column nothing changes — `pm-update.cjs` never widens a
 * table on its own, because a table grows into the enriched shape only
 * through a confirmed `/ship:pm-sync` reconcile.
 *
 * Edits only the target segment of the raw line, so column padding elsewhere
 * and CRLF terminators survive byte-identical. Does **not** bump the
 * frontmatter `updated:` value — it stays a pure string transform, and the
 * caller bumps once for all its passes.
 *
 * Never throws; a malformed row is skipped exactly as `parseRoadmap` skips it.
 *
 * @param {string} content - ROADMAP.md content
 * @param {string} today - YYYY-MM-DD
 * @returns {{ content: string, changed: boolean }}
 */
function stampFirstSeen(content, today) {
  const lines = content.split('\n');
  let changed = false;

  for (const row of parseRoadmap(content)) {
    const index = row.headers.indexOf('First seen');
    if (index === -1) continue;

    const current = row.cells['First seen'];
    if (current && current !== '—' && current !== '-') continue;

    // Segment 0 is whatever precedes the first `|`, so cell i lives at
    // segment i + 1 — the same arithmetic applyStatusUpdates uses.
    const segments = lines[row.lineIndex].split('|');
    segments[index + 1] = ` ${today} `;
    lines[row.lineIndex] = segments.join('|');
    changed = true;
  }

  if (!changed) return { content, changed: false };
  return { content: lines.join('\n'), changed: true };
}

/**
 * Write each backlog row's `Lane` cell from fleet-sweep ownership.
 *
 * The spec has always called `Lane` derived; until now nothing wrote it, and
 * the drift was corrected by hand. `laneByName` maps a slug to the owning
 * lane's label; a slug the map does not hold — unowned, or a finished feature
 * the sweep no longer scans — renders `—`.
 *
 * Mirrors stampFirstSeen exactly: the column is located by header *name*, a
 * table without it is never widened, only the target segment of the raw line
 * is replaced (so padding elsewhere and CRLF terminators survive), an
 * already-correct cell is left alone to avoid mtime churn, and the frontmatter
 * `updated:` value is not bumped — the caller bumps once for all its passes.
 *
 * Never throws.
 *
 * @param {string} content - ROADMAP.md content
 * @param {Map<string, string|null>} laneByName
 * @returns {{ content: string, changed: boolean }}
 */
function applyLaneColumn(content, laneByName) {
  const lines = content.split('\n');
  const map = laneByName instanceof Map ? laneByName : new Map();
  let changed = false;

  for (const row of parseRoadmap(content)) {
    const index = row.headers.indexOf('Lane');
    if (index === -1) continue; // never widen a table
    if (row.slugless) continue;

    const owner = map.get(row.slug);
    const value = typeof owner === 'string' && owner !== '' ? owner : '—';
    if ((row.cells.Lane || '') === value) continue; // already correct

    const segments = lines[row.lineIndex].split('|');
    segments[index + 1] = ` ${value} `;
    lines[row.lineIndex] = segments.join('|');
    changed = true;
  }

  if (!changed) return { content, changed: false };
  return { content: lines.join('\n'), changed: true };
}

/**
 * Turn a fleet sweep into the slug → lane-label map applyLaneColumn consumes.
 *
 * `sweep()` has already bound each slug to at most one lane, so every feature
 * still listed under a lane is owned by it. Slugs in `sweepResult.unowned` are
 * deliberately absent from the map: an ambiguous claim renders `—`, never a
 * guess at which lane it belongs to.
 *
 * The label is the identical `{branch} @ {path}` form stampLane writes and
 * skills/pm-state/SKILL.md documents, so the two surfaces are comparable
 * byte-for-byte. Never throws; a null or malformed argument yields an empty
 * map.
 *
 * @param {object|null} sweepResult
 * @returns {Map<string, string>}
 */
function laneOwnershipMap(sweepResult) {
  const map = new Map();
  try {
    const lanes = sweepResult && Array.isArray(sweepResult.lanes) ? sweepResult.lanes : [];
    for (const lane of lanes) {
      if (!lane) continue;
      let branch = typeof lane.branch === 'string' ? lane.branch.trim() : '';
      if (branch === '' || branch === 'HEAD') branch = 'detached';
      const lanePath = typeof lane.path === 'string' ? lane.path.replace(/\\/g, '/') : '';
      const features = Array.isArray(lane.features) ? lane.features : [];
      for (const feature of features) {
        const name = feature && feature.name;
        if (typeof name !== 'string' || name === '') continue;
        map.set(name, `${branch} @ ${lanePath}`);
      }
    }
  } catch (e) {
    return map; // never throws
  }
  return map;
}

/**
 * The "work on next" selection rule — the single home of the rule stated in
 * skills/pm-state/SKILL.md (PM:NEXT): the highest-priority non-done,
 * non-blocked, non-awaiting-merge item whose Depends-on items are all finished.
 *
 * - `—`/`-`/empty Depends on means independent; otherwise every comma-separated
 *   name must match some row's Item (exact, case-sensitive) whose Status is
 *   `done` or `awaiting-merge`. An unknown name counts as unmet — never
 *   recommend an item whose dependency cannot be verified.
 * - `awaiting-merge` is finished work waiting on a PR, so it *satisfies* a
 *   dependency even though it can never itself be selected. The two roles are
 *   separate: eligibility is handled by the skip below, satisfaction here.
 * - Priority ranks P0 < P1 < P2 < P3; missing/invalid sorts after P3.
 *   Ties break by document order.
 *
 * @param {ReturnType<typeof parseRoadmap>} rows
 * @returns {{ item: string, milestone: string|null, priority: string|null, shipFeature: string|null }|null}
 */
function selectNext(rows) {
  const finishedItems = new Set(
    rows
      .filter(r => {
        const status = (r.recorded || '').toLowerCase();
        return status === 'done' || status === 'awaiting-merge';
      })
      .map(r => r.cells.Item)
  );

  const empty = v => !v || v === '—' || v === '-';

  let best = null;
  let bestRank = Infinity;

  for (const row of rows) {
    const status = (row.recorded || '').toLowerCase();
    // `awaiting-merge` is archived work waiting on a PR — finished, so it can
    // no more be "worked on next" than `done` can.
    if (status === 'done' || status === 'blocked' || status === 'awaiting-merge') continue;

    const depends = row.cells['Depends on'];
    if (!empty(depends)) {
      const names = depends.split(',').map(d => d.trim()).filter(d => d !== '');
      if (!names.every(name => finishedItems.has(name))) continue;
    }

    const priority = row.cells.Priority;
    const rankMatch = typeof priority === 'string' && /^P([0-3])$/.test(priority);
    const rank = rankMatch ? Number(priority[1]) : 4;

    if (rank < bestRank) {
      bestRank = rank;
      best = row;
    }
    // ties break by document order — earlier row already won
  }

  if (!best) return null;
  const priority = best.cells.Priority;
  return {
    item: best.cells.Item,
    milestone: best.milestone,
    priority: typeof priority === 'string' && /^P[0-3]$/.test(priority) ? priority : null,
    shipFeature: empty(best.cells['Ship feature']) ? null : best.cells['Ship feature']
  };
}

/**
 * Invert the Depends-on graph: for every item, how many rows are waiting on it.
 *
 * A row D depends on row R when D's `Depends on` cell, comma-split and
 * trimmed, contains R's `Item` exactly — the same exact-name, case-sensitive
 * convention `selectNext()` uses for dependency satisfaction, so a name that
 * differs only in case is deliberately not a match. An empty, `—`, or `-`
 * cell contributes nothing.
 *
 * `count` counts only dependents that are not finished (`done` or
 * `awaiting-merge`, case-insensitive): finishing an item cannot unblock work
 * that is already finished, and `awaiting-merge` is archived work waiting on a
 * PR rather than work still waiting on a dependency.
 * `inProgress` is true when at least one of those non-done dependents is
 * `in-progress` — someone is waiting on this right now.
 *
 * Pure; never throws. Every row's Item gets an entry, so a lookup for a known
 * item is never `undefined`.
 *
 * @param {ReturnType<typeof parseRoadmap>} rows
 * @returns {Map<string, { count: number, inProgress: boolean }>}
 */
function computeUnblocks(rows) {
  const unblocks = new Map();
  if (!Array.isArray(rows)) return unblocks;

  for (const row of rows) {
    const item = row && row.cells ? row.cells.Item : null;
    if (typeof item === 'string' && item !== '') {
      if (!unblocks.has(item)) unblocks.set(item, { count: 0, inProgress: false });
    }
  }

  for (const row of rows) {
    if (!row || !row.cells) continue;
    // A non-string cell is unreachable through `parseRoadmap` (which trims
    // every cell to a string) but reachable for a direct module consumer
    // building rows by hand — and the contract above promises never to throw.
    const depends = row.cells['Depends on'];
    if (typeof depends !== 'string') continue;
    if (!depends || depends === '—' || depends === '-') continue;

    const status = (row.recorded || '').toLowerCase();
    // a finished dependent is not waiting on anything — and `awaiting-merge`
    // is finished, just not yet merged
    if (status === 'done' || status === 'awaiting-merge') continue;

    const names = depends.split(',').map(d => d.trim()).filter(d => d !== '');
    for (const name of new Set(names)) { // a name listed twice counts once
      const entry = unblocks.get(name) || { count: 0, inProgress: false };
      entry.count += 1;
      if (status === 'in-progress') entry.inProgress = true;
      unblocks.set(name, entry);
    }
  }

  return unblocks;
}

/**
 * Normalise one authored evidence cell. Absent column, empty cell, `—`, and
 * `-` all read as `unknown`; anything else is lowercased and trimmed.
 *
 * @param {string|undefined} value
 * @returns {string}
 */
function evidenceCell(value) {
  if (typeof value !== 'string') return 'unknown';
  const normalised = value.trim().toLowerCase();
  if (normalised === '' || normalised === '—' || normalised === '-') return 'unknown';
  return normalised;
}

const BLAST_RADIUS_VALUES = new Set(['users', 'contributors', 'internal']);
const CONFIDENCE_VALUES = new Set(['proven', 'suspected']);

/**
 * The priority derivation rule — the single home of the rule stated in
 * skills/pm-state/SKILL.md (PM:PRIORITY). It proposes a priority from
 * evidence; it never writes one, and `/ship:pm groom` relays the proposal
 * for the user to accept or reject.
 *
 * The rule is **promotion-only**: the recorded rank is always among the
 * candidates, so the proposal can never be a lower priority than the recorded
 * value. Demotion is where a wrong rule quietly buries real work.
 *
 * 1. `confidence: unknown` is the evidence gate — no promotion at all, because
 *    there is nothing to promote on.
 * 2. Otherwise the candidates are the base rank plus:
 *    - P0 for blast radius `users` with confidence `proven`
 *    - P1 for blast radius `users` with confidence `suspected`
 *    - P1 for blast radius `contributors` with confidence `proven`
 *    - one level up, floored at P1, when 2+ non-done items depend on this one
 *      or one of them is in progress. This clause is structural — it reads the
 *      dependency graph, so an unknown blast radius does not block it.
 * 3. `derived` is the strongest (lowest-rank) candidate.
 * 4. `needsEvidence` is true when either authored column is `unknown`.
 * 5. `reasons` is what groom argues with, one short string per clause that
 *    fired — contract, not debug output.
 *
 * `recorded` is the recorded **Priority** (`P0`–`P3` or null), never the
 * recorded Status — `parseRoadmap` uses the name `recorded` for status
 * internally and the two must not be confused. The returned `unblocks` is the
 * numeric count; `inProgress` surfaces through `reasons`.
 *
 * Pure; never throws — a missing cell reads as `unknown`.
 *
 * @param {ReturnType<typeof parseRoadmap>[number]} row
 * @param {{ count: number, inProgress: boolean }|undefined} unblocks
 * @returns {{ recorded: string|null, derived: string, unblocks: number,
 *             firstSeen: string, blastRadius: string, confidence: string,
 *             needsEvidence: boolean, reasons: string[] }}
 */
function derivePriority(row, unblocks) {
  const cells = (row && row.cells) || {};

  const priority = cells.Priority;
  const recorded = typeof priority === 'string' && /^P[0-3]$/.test(priority.trim())
    ? priority.trim()
    : null;

  let blastRadius = evidenceCell(cells['Blast radius']);
  if (!BLAST_RADIUS_VALUES.has(blastRadius)) blastRadius = 'unknown';
  let confidence = evidenceCell(cells.Confidence);
  if (!CONFIDENCE_VALUES.has(confidence)) confidence = 'unknown';
  const firstSeen = evidenceCell(cells['First seen']);

  const count = unblocks && Number.isFinite(unblocks.count) ? unblocks.count : 0;
  const inProgress = !!(unblocks && unblocks.inProgress);

  const baseRank = recorded ? Number(recorded[1]) : 3;
  const needsEvidence = confidence === 'unknown' || blastRadius === 'unknown';
  const reasons = [];

  let derivedRank = baseRank;

  if (confidence === 'unknown') {
    reasons.push('confidence unknown → no promotion');
  } else {
    const candidates = [baseRank];

    if (blastRadius === 'users' && confidence === 'proven') {
      candidates.push(0);
      reasons.push('blast radius users + confidence proven → P0');
    }
    if (blastRadius === 'users' && confidence === 'suspected') {
      candidates.push(1);
      reasons.push('blast radius users + confidence suspected → P1');
    }
    if (blastRadius === 'contributors' && confidence === 'proven') {
      candidates.push(1);
      reasons.push('blast radius contributors + confidence proven → P1');
    }
    if (count >= 2 || inProgress) {
      candidates.push(Math.max(baseRank - 1, 1));
      reasons.push(
        `unblocks ${count} non-done item${count === 1 ? '' : 's'}${inProgress ? ', 1 in flight' : ''} → promote one level (floor P1)`
      );
    }

    derivedRank = Math.min(...candidates);
    if (reasons.length === 0) reasons.push('no clause fired → unchanged');
  }

  // Promotion-only, asserted rather than inferred from the arithmetic: the
  // base rank is always a candidate today, which is exactly what makes this
  // easy to break by "simplifying" the candidate list later.
  if (derivedRank > baseRank) derivedRank = baseRank;

  return {
    recorded,
    derived: `P${derivedRank}`,
    unblocks: count,
    firstSeen,
    blastRadius,
    confidence,
    needsEvidence,
    reasons
  };
}

/**
 * Write a file atomically: write `{file}.tmp-{pid}` in the same directory,
 * then rename over the target — an atomic same-volume replace on both POSIX
 * and Windows, so no reader ever observes a partial file. On failure the
 * temp file is removed best-effort and the original error rethrown; there is
 * never a fallback to a non-atomic write.
 *
 * @param {string} filePath
 * @param {string} content
 */
function writeFileAtomic(filePath, content) {
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmpPath, content);
    try {
      fs.renameSync(tmpPath, filePath);
    } catch (e) {
      // Windows can transiently EPERM a replace while the target is briefly
      // locked (antivirus, indexer) — retry once, then give up atomically.
      if (e.code !== 'EPERM') throw e;
      fs.renameSync(tmpPath, filePath);
    }
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch (e) {
      // best effort — the temp may never have been created
    }
    throw err;
  }
}

/**
 * Stamp the invoking lane's identity into a feature's CONTEXT.md frontmatter
 * as `lane: {branch} @ {worktree-path}` — the last ownership layer the fleet
 * sweep consults (`ship/lane-sweep.cjs` resolveOwnership), mirroring the
 * PM-HANDOFF.md `lane:` format exactly.
 *
 * Best-effort insurance, never an obligation: every failure path returns
 * false and is **silent on both stdout and stderr**, because an absent stamp
 * degrades cleanly to the sweep's branch layer rather than being an
 * actionable error. It must never make the caller exit non-zero.
 *
 * The stamp is spliced as a single line so every other byte of the file —
 * key order, comments, quoting style, and CRLF or LF line endings — survives
 * untouched. A CONTEXT.md with no frontmatter block is left alone: inventing
 * structure is a bigger lie than an absent stamp.
 *
 * A feature whose frontmatter status is terminal (`done`, `superseded`,
 * `abandoned`, `cancelled` — the set hooks/scan-features.cjs owns) is skipped
 * entirely: nothing is written, an existing `lane:` line is left byte-intact,
 * and the call reports false, because the stamp it was asked for is not there.
 *
 * @param {string} cwd - the lane the stamp speaks for
 * @param {string} slug
 * @returns {boolean} true when the stamp is present after the call (written,
 *          or already byte-identical), false on any failure or terminal skip
 */
function stampLane(cwd, slug) {
  try {
    if (!isValidSlug(slug)) return false; // never let it reach path.join

    const branchRun = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' });
    if (!branchRun || branchRun.status !== 0) return false;
    let branch = (branchRun.stdout || '').trim();
    if (branch === '') return false;
    // A detached HEAD reports `HEAD` — use the dashboard's own label for a
    // branchless lane so both surfaces name it identically.
    if (branch === 'HEAD') branch = 'detached';

    const topRun = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
    if (!topRun || topRun.status !== 0) return false;
    const toplevel = (topRun.stdout || '').trim().replace(/\\/g, '/');
    if (toplevel === '') return false;

    const contextPath = path.join(cwd, '.planning', 'features', slug, 'CONTEXT.md');
    if (!fs.existsSync(contextPath)) return false;
    const content = fs.readFileSync(contextPath, 'utf8');

    // Same CRLF-tolerant leading block frontmatter() reads, with the two line
    // endings captured so the splice can reuse the file's own.
    const fm = content.match(/^---(\r?\n)([\s\S]*?)(\r?\n)---/);
    if (fm === null) return false;
    const [full, openEol, block, closeEol] = fm;

    // A finished feature stops accumulating lane claims. Status is frontmatter
    // state, so only the block is searched — a `status:` line in the body is
    // prose, the same discipline mappedStatus uses. No `status:` at all is not
    // terminal and still stamps. `false` is the honest return: the contract is
    // "the stamp is present after the call", and a skipped stamp is not.
    const statusMatch = block.match(/^status:\s*(.+)$/m);
    if (statusMatch && TERMINAL_STATUSES.has(statusMatch[1].trim().toLowerCase())) return false;

    const line = `lane: ${branch} @ ${toplevel}`;
    const existing = block.match(/^lane:[^\r\n]*/m);

    let updatedBlock;
    if (existing) {
      if (existing[0] === line) return true; // already exact — no rewrite, no mtime churn
      updatedBlock = block.slice(0, existing.index) + line + block.slice(existing.index + existing[0].length);
    } else {
      updatedBlock = `${block}${closeEol}${line}`; // last line of the block
    }

    const updated =
      content.slice(0, fm.index) +
      `---${openEol}${updatedBlock}${closeEol}---` +
      content.slice(fm.index + full.length);

    writeFileAtomic(contextPath, updated);
    return true;
  } catch (e) {
    return false; // silent on both streams by contract
  }
}

/** HTML-escape every value taken from state files before interpolation. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render an authored-prose value: HTML-escape it, then convert markdown code
 * spans to <code> elements. Escaping first means a value containing `<` or `&`
 * cannot break out of the span and the emitted tags are not themselves escaped.
 * Text nodes only — never an attribute value, where a backtick pair would emit
 * a tag inside quotes.
 */
function inline(value) {
  return esc(value).replace(/`([^`\n]+)`/g, (m, body) => `<code>${body}</code>`);
}

/** Read a file, returning null when absent or unreadable — never throws. */
function readOptional(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
  }
}

/**
 * Read a file the way `readOptional` does, but distinguish *absent* from
 * *present and unreadable*. The ledger's provenance contract promises a row is
 * never ambiguous between a clean run and a missing record; reporting a
 * permission problem as `no VERIFY.md` breaks that promise in the one
 * direction that matters, since it reads as verification debt when the
 * evidence is actually sitting right there. Never throws.
 *
 * `ENOENT` and `ENOTDIR` (a path component that is not a directory) mean the
 * artifact genuinely is not there. Anything else — `EACCES`, `EISDIR`, `EIO` —
 * means something is there that could not be read.
 *
 * @param {string} filePath
 * @returns {{ content: string|null, unreadable: boolean }}
 */
function readArtifact(filePath) {
  try {
    return { content: fs.readFileSync(filePath, 'utf8'), unreadable: false };
  } catch (e) {
    const absent = !e || e.code === 'ENOENT' || e.code === 'ENOTDIR';
    return { content: null, unreadable: !absent };
  }
}

/** Extract a `## {name}` section's body from a markdown document, or ''. */
function sectionBody(content, name) {
  // `$(?![\s\S])` is end-of-string — a bare `$` under the m flag would match
  // the first end-of-line and truncate the body to a single line.
  const match = content.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=\\n## |$(?![\\s\\S]))`, 'm'));
  return match ? match[1] : '';
}

/** Top-level bullet entries (`- ...`, with indented continuations) of a section body. */
function bulletEntries(body) {
  const entries = [];
  for (const line of body.split('\n')) {
    if (line.startsWith('- ')) {
      entries.push(line.slice(2).trim());
    } else if (entries.length > 0 && line.trim() !== '' && /^\s/.test(line)) {
      entries[entries.length - 1] += ' ' + line.trim();
    }
  }
  return entries;
}

/** Milestones from ROADMAP.md: heading name, status suffix, and Goal line. */
function parseMilestones(content) {
  const milestones = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('### ')) {
      const statusMatch = trimmed.match(/\(status:\s*([^)]*)\)\s*$/);
      milestones.push({
        name: trimmed.slice(4).replace(/\s*\(status:[^)]*\)\s*$/, '').trim(),
        status: statusMatch ? statusMatch[1].trim() : '',
        goal: null
      });
    } else if (milestones.length > 0 && milestones[milestones.length - 1].goal === null) {
      const goalMatch = trimmed.match(/^Goal:\s*(.*)$/);
      if (goalMatch) milestones[milestones.length - 1].goal = goalMatch[1].trim();
    }
  }
  return milestones;
}

/** `## {date} — {title}` entries from DECISIONS.md, in document order. */
function parseDecisions(content) {
  const decisions = [];
  for (const block of content.split(/^## /m).slice(1)) {
    const lines = block.split('\n');
    const headMatch = lines[0].match(/^(\d{4}-\d{2}-\d{2})\s+—\s+(.*)$/);
    if (!headMatch) continue;
    const body = lines.slice(1).map(l => l.trim()).filter(l => l !== '').join(' ');
    decisions.push({ date: headMatch[1], title: headMatch[2].trim(), body });
  }
  return decisions;
}

/**
 * Generate dashboard.html deterministically from the state files under
 * `{root}/.project-manager/` and the template shipped next to this script.
 * Returns the HTML string, or null when the template is unreadable (legacy
 * install). Absent state files degrade per the pm-state spec, never error.
 * No timestamps or randomness beyond what the files record — identical input
 * produces byte-identical output.
 *
 * The Lanes panel renders from `laneData` (a lane-sweep result) passed by the
 * caller — this function never shells out to git itself, so it stays
 * deterministic and unit-testable.
 *
 * @param {string} root - resolved state root (equals cwd in a single-worktree repo)
 * @param {{ lanes: object[], overlaps: object[] }|null} [laneData] - lane-sweep result
 * @returns {string|null}
 */
function generateDashboard(root, laneData) {
  const template = readOptional(path.join(__dirname, 'templates', 'dashboard.html'));
  if (template === null) return null;

  const pmDir = path.join(root, '.project-manager');
  const roadmap = readOptional(path.join(pmDir, 'ROADMAP.md')) || '';
  const status = readOptional(path.join(pmDir, 'STATUS.md'));
  const decisionsFile = readOptional(path.join(pmDir, 'DECISIONS.md'));

  const rows = parseRoadmap(roadmap);

  // PM:PROJECT / PM:UPDATED — ROADMAP frontmatter
  const projectMatch = roadmap.match(/^project:\s*"?([^"\n]*)"?\s*$/m);
  const updatedMatch = roadmap.match(/^updated:\s*"?([^"\n]*)"?\s*$/m);
  const project = inline(projectMatch ? projectMatch[1].trim() : '');
  const updated = `Last synced ${inline(updatedMatch ? updatedMatch[1].trim() : '')}`;

  // PM:NEXT — the selectNext rule, same code path as --next
  const next = selectNext(rows);
  let nextHtml;
  if (next) {
    const meta = [next.milestone, next.priority, next.shipFeature]
      .filter(v => v !== null && v !== '')
      .map(inline)
      .join(' &middot; ');
    nextHtml = `<div class="item-name">${inline(next.item)}</div><div class="item-meta">${meta}</div>`;
  } else {
    nextHtml = '<p class="empty">Nothing ready — all items done or blocked</p>';
  }

  // PM:INFLIGHT — STATUS.md `## In flight` bullets
  const inflightEntries = status === null ? [] : bulletEntries(sectionBody(status, 'In flight'));
  const inflightHtml = inflightEntries.length > 0
    ? `<ul>${inflightEntries.map(e => `<li>${inline(e)}</li>`).join('')}</ul>`
    : '<p class="empty">No in-flight work recorded</p>';

  // PM:LANES — one row per active feature per lane, then one warning line
  // per cross-lane file overlap. All values come from the caller's sweep data.
  const sweepLanes = laneData && Array.isArray(laneData.lanes) ? laneData.lanes : [];
  const laneRows = [];
  for (const lane of sweepLanes) {
    const label = lane.isMain ? 'main' : `${lane.branch || 'detached'} @ ${lane.path}`;
    for (const feature of lane.features || []) {
      const tasks = feature.tasks ? `${feature.tasks.done}/${feature.tasks.total}` : '—';
      laneRows.push(
        `<tr><td>${esc(label)}</td><td>${esc(feature.name)}</td>` +
        `<td class="status-${esc(String(feature.status || '').toLowerCase())}">${esc(feature.status)}</td>` +
        `<td>${esc(tasks)}</td></tr>`
      );
    }
  }
  let lanesHtml;
  if (laneRows.length === 0) {
    lanesHtml = '<p class="empty">No lanes recorded</p>';
  } else {
    const parts = [
      '<table>',
      '<tr><th>Lane</th><th>Feature</th><th>Stage</th><th>Tasks</th></tr>',
      ...laneRows,
      '</table>'
    ];
    const overlaps = laneData && Array.isArray(laneData.overlaps) ? laneData.overlaps : [];
    for (const overlap of overlaps) {
      const claims = (overlap.claims || [])
        .map(c => `${esc(c.feature)}@${esc(c.lane)}`)
        .join(' and ');
      parts.push(`<p class="status-blocked">&#9888; ${esc(overlap.file)} claimed by ${claims}</p>`);
    }
    lanesHtml = parts.join('\n');
  }

  // PM:MILESTONES — one card per `### ` heading
  const milestoneCards = parseMilestones(roadmap).map(m => {
    const mRows = rows.filter(r => r.milestone === m.name);
    const done = mRows.filter(r => (r.recorded || '').toLowerCase() === 'done').length;
    const total = mRows.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    const parts = [
      '<div class="card">',
      `<div class="milestone-head"><h3>${inline(m.name)}</h3><span class="badge ${esc(m.status)}">${esc(m.status)}</span><span class="progress-label">${done}/${total}</span></div>`,
      `<p class="goal">${inline(m.goal || '')}</p>`,
      `<div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>`
    ];

    if (mRows.length > 0) {
      const headers = mRows[0].headers;
      const cellHtml = (row, header) => {
        const value = row.cells[header] || '';
        if (header === 'Status') return `<td class="status-${esc(value.toLowerCase())}">${esc(value)}</td>`;
        if (header === 'Size') return `<td class="size">${esc(value)}</td>`;
        if (header === 'Source') return `<td class="source">${inline(value)}</td>`;
        return `<td>${inline(value)}</td>`;
      };
      parts.push('<table>');
      parts.push(`<tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr>`);
      for (const row of mRows) {
        parts.push(`<tr>${headers.map(h => cellHtml(row, h)).join('')}</tr>`);
      }
      parts.push('</table>');
    }

    parts.push('</div>');
    return parts.join('\n');
  });
  const milestonesHtml = milestoneCards.join('\n');

  // PM:BLOCKERS — blocked rows, with STATUS.md `## Blocked` reasoning when it matches
  const blockedReasons = new Map();
  if (status !== null) {
    for (const entry of bulletEntries(sectionBody(status, 'Blocked'))) {
      const nameMatch = entry.match(/^\*\*(.+?)\*\*/);
      if (nameMatch) blockedReasons.set(nameMatch[1], entry);
    }
  }
  const blockedRows = rows.filter(r => (r.recorded || '').toLowerCase() === 'blocked');
  const blockerHtml = blockedRows.length > 0
    ? blockedRows.map(r => {
        const label = `<p><strong>${inline(r.cells.Item)}</strong>${r.milestone ? ` &middot; ${inline(r.milestone)}` : ''}</p>`;
        const reason = blockedReasons.get(r.cells.Item);
        return reason ? `${label}\n<p class="blocker-reason">${inline(reason)}</p>` : label;
      }).join('\n')
    : '<p class="empty">No blockers</p>';

  // PM:DECISIONS — the 5 most recent entries (newest first in the file)
  const decisions = decisionsFile === null ? [] : parseDecisions(decisionsFile).slice(0, 5);
  const decisionsHtml = decisions.length > 0
    ? decisions.map(d =>
        `<div class="decision"><span class="date">${inline(d.date)}</span> <span class="title">${inline(d.title)}</span><p>${inline(d.body)}</p></div>`
      ).join('\n')
    : '<p class="empty">No decisions recorded</p>';

  // Replacer functions so `$`-patterns in state content are never interpreted.
  return template
    .replace('<!-- PM:PROJECT -->', () => project)
    .replace('<!-- PM:UPDATED -->', () => updated)
    .replace('<!-- PM:NEXT -->', () => nextHtml)
    .replace('<!-- PM:INFLIGHT -->', () => inflightHtml)
    .replace('<!-- PM:LANES -->', () => lanesHtml)
    .replace('<!-- PM:MILESTONES -->', () => milestonesHtml)
    .replace('<!-- PM:BLOCKERS -->', () => blockerHtml)
    .replace('<!-- PM:DECISIONS -->', () => decisionsHtml);
}

/**
 * Harvest one feature's on-disk artifacts into a ledger record.
 *
 * Reads `{cwd}/.planning/archive/{slug}/` when that directory exists, else
 * `{cwd}/.planning/features/{slug}/`. The archive wins because a feature that
 * has been archived is the finished record of itself.
 *
 * Never throws. Every artifact is optional and every parse degrades toward
 * "absent" rather than toward a guess: an unreadable file is treated exactly
 * as a missing one, and a file whose format has drifted yields `unknown`
 * plus an explicit qualifier in `artifacts` rather than an exception.
 *
 * Fields:
 * - `slug` — the feature slug, as given.
 * - `shipped` — VERIFY.md's `**Verified:**` date, else `today`.
 * - `profile` — CONTEXT.md frontmatter `profile:`, else `unknown`.
 * - `verify` — VERIFY.md's `**Overall Status:**` uppercased; `in-progress`
 *   for a report still in flight; `unknown` when the file has neither line;
 *   `none` when the file is absent (a feature that reached `done` with no
 *   verify gate — recorded, never suppressed).
 * - `unresolvedCarried` — critical/high REVIEW.md findings still marked
 *   unresolved; exactly the set the verifier must carry into Stage 2b.
 * - `planRounds` — plan-revision rounds, from PLAN.md's `**Rounds:**` line.
 * - `fixRounds` — REVIEW.md phase headings at round 2 or later.
 * - `findings` — per-severity REVIEW.md finding counts.
 * - `phases` — distinct REVIEW.md phase ids.
 * - `artifacts` — exactly four provenance tokens, always in CONTEXT, PLAN,
 *   REVIEW, VERIFY order: the filename, the filename plus a missing-field
 *   qualifier, `no {filename}` when the file is absent, or
 *   `unreadable {filename}` when it exists but could not be read. The array is
 *   never short and never `—`, so a reader can always tell a clean run from a
 *   missing record — and a permission problem from verification debt.
 *
 * `today` is injected (never `new Date()` here) so a harvest is deterministic
 * and testable.
 *
 * @param {string} cwd - the lane whose .planning/ holds the feature
 * @param {string} slug
 * @param {string} today - YYYY-MM-DD
 * @returns {{ slug: string, shipped: string, profile: string, verify: string,
 *             unresolvedCarried: number, planRounds: number|string,
 *             fixRounds: number,
 *             findings: { critical: number, high: number, medium: number, low: number },
 *             phases: number, artifacts: string[] }|null}
 */
function harvestFeature(cwd, slug, today) {
  try {
    if (!isValidSlug(slug)) return null; // never let it reach path.join

    let dir = path.join(cwd, '.planning', 'archive', slug);
    if (!fs.existsSync(dir)) {
      dir = path.join(cwd, '.planning', 'features', slug);
      if (!fs.existsSync(dir)) return null;
    }

    const read = name => readArtifact(path.join(dir, name));
    // The provenance token for an artifact that yielded no content: `no X`
    // when it is absent, `unreadable X` when it exists but could not be read.
    const absentToken = (state, name) => (state.unreadable ? `unreadable ${name}` : `no ${name}`);

    // --- CONTEXT.md — the profile the run was executed under
    const contextRead = read('CONTEXT.md');
    const context = contextRead.content;
    let profile = 'unknown';
    let contextToken = absentToken(contextRead, 'CONTEXT.md');
    if (context !== null) {
      const fm = frontmatter(context); // frontmatter block only — a body `profile:` is prose
      const match = fm === null ? null : fm.match(/^profile:\s*(.+)$/m);
      const value = match ? match[1].trim() : '';
      if (value !== '') {
        profile = value;
        contextToken = 'CONTEXT.md';
      } else {
        contextToken = 'CONTEXT.md (no profile)';
      }
    }

    // --- PLAN.md — plan-revision rounds
    const planRead = read('PLAN.md');
    const plan = planRead.content;
    let planRounds = 'unknown';
    let planToken = absentToken(planRead, 'PLAN.md');
    if (plan !== null) {
      const stated = plan.match(/^\*\*Rounds:\*\*\s*(\d+)/m);
      if (stated) {
        planRounds = Number(stated[1]);
      } else {
        // `**Rounds:** N` is authoritative; counting `### Round n` subsections
        // is the fallback, and a plan can state rounds while carrying none.
        const headings = plan.match(/^### Round \d+/gm);
        if (headings && headings.length > 0) planRounds = headings.length;
      }
      planToken = planRounds === 'unknown' ? 'PLAN.md (no rounds)' : 'PLAN.md';
    }

    // --- REVIEW.md — phases, fix rounds, findings, unresolved carries
    const reviewRead = read('REVIEW.md');
    const review = reviewRead.content;
    const findings = { critical: 0, high: 0, medium: 0, low: 0 };
    let phases = 0;
    let fixRounds = 0;
    let unresolvedCarried = 0;
    let reviewToken = absentToken(reviewRead, 'REVIEW.md');
    if (review !== null) {
      const phaseIds = new Set();
      const headingRe = /^## Phase (.+?) — (.*?) \(round (\d+)\)\s*$/gm;
      let m;
      while ((m = headingRe.exec(review)) !== null) {
        phaseIds.add(m[1]);
        if (Number(m[3]) >= 2) fixRounds++;
      }
      phases = phaseIds.size;

      const findingRe = /^- \[(critical|high|medium|low)\].*$/gm;
      let f;
      while ((f = findingRe.exec(review)) !== null) {
        findings[f[1]]++;
        // `new (round n)` is the label the go and build skills give a
        // critical/high finding the fix round *introduced*, and
        // go.workflow.js hands those to the verifier as a subset of
        // `unresolved` — so the cell must count them too.
        if (
          (f[1] === 'critical' || f[1] === 'high') &&
          /—\s*(?:unresolved|new \(round \d+\))\s*$/.test(f[0])
        ) {
          unresolvedCarried++;
        }
      }

      const hasEvidence = /^Verify: \d+ re-run/m.test(review);
      reviewToken = phases > 0 && !hasEvidence ? 'REVIEW.md (no evidence lines)' : 'REVIEW.md';
    }

    // --- VERIFY.md — the verdict
    const verifyRead = read('VERIFY.md');
    const verifyDoc = verifyRead.content;
    let verify = 'none';
    let shipped = today;
    let verifyToken = absentToken(verifyRead, 'VERIFY.md');
    if (verifyDoc !== null) {
      const overall = verifyDoc.match(/^\*\*Overall Status:\*\*\s*(.+)$/m);
      if (overall) {
        verify = overall[1].trim().toUpperCase();
        // `\b`, not `\s*$`: the verifier's Stage-1 flush line is
        // `**Status:** IN PROGRESS — Stage 1 only`, which an end-anchor rejects.
      } else if (/^\*\*Status:\*\*\s*IN PROGRESS\b/m.test(verifyDoc)) {
        verify = 'in-progress';
      } else {
        verify = 'unknown';
      }
      const verified = verifyDoc.match(/^\*\*Verified:\*\*\s*(.+)$/m);
      if (verified && verified[1].trim() !== '') shipped = verified[1].trim();
      verifyToken = /^\*\*Head:\*\*/m.test(verifyDoc) ? 'VERIFY.md' : 'VERIFY.md (no head)';
    }

    return {
      slug,
      shipped,
      profile,
      verify,
      unresolvedCarried,
      planRounds,
      fixRounds,
      findings,
      phases,
      artifacts: [contextToken, planToken, reviewToken, verifyToken]
    };
  } catch (e) {
    return null; // an unreadable feature is an absent one, never a crash
  }
}

/** LEDGER.md's column set, in render order. The header is located by name. */
const LEDGER_COLUMNS = [
  'Feature',
  'Shipped',
  'Profile',
  'Verify',
  'Unresolved carried',
  'Plan rounds',
  'Fix rounds',
  'Findings (C/H/M/L)',
  'Phases',
  'Artifacts'
];

/**
 * Is this LEDGER.md body anchored by a parseable header row?
 *
 * `ledgerSlugs` keys the append-only contract off the header, so a body with
 * none yields an empty slug set and every recorded feature re-harvests. The
 * append branch would then write those rows again on every invocation, with
 * no header ever restored. `appendLedger` uses this to rebuild instead.
 *
 * Header detection matches `ledgerSlugs` exactly — a table row whose cells
 * include `Feature`, `Shipped`, and `Verify`. Pure; never throws.
 *
 * @param {string} content
 * @returns {boolean}
 */
function hasLedgerHeader(content) {
  try {
    if (typeof content !== 'string') return false;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
      const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());
      if (cells.includes('Feature') && cells.includes('Shipped') && cells.includes('Verify')) {
        return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * The `Feature` values already recorded in a LEDGER.md string.
 *
 * The header row is located by name exactly as parseRoadmap does — the row
 * whose cells include `Feature`, `Shipped`, and `Verify` — so a reordered or
 * widened ledger still yields its slugs. Separator rows and rows whose cell
 * count differs from the header's contribute nothing. An empty or
 * unparseable string yields an empty Set; never throws.
 *
 * @param {string} content
 * @returns {Set<string>}
 */
function ledgerSlugs(content) {
  const slugs = new Set();
  try {
    if (typeof content !== 'string') return slugs;
    let ctx = null;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
        if (trimmed !== '') ctx = null; // a non-table line ends the table
        continue;
      }

      const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());
      const featureIdx = cells.indexOf('Feature');
      if (featureIdx !== -1 && cells.includes('Shipped') && cells.includes('Verify')) {
        ctx = { columnCount: cells.length, featureIdx };
        continue;
      }

      if (!ctx) continue;
      if (cells.every(c => /^:?-+:?$/.test(c))) continue; // separator row
      if (cells.length !== ctx.columnCount) continue; // malformed row

      const value = cells[ctx.featureIdx];
      if (value) slugs.add(value);
    }
  } catch (e) {
    // an unparseable ledger records nothing — the harvest re-appends instead
  }
  return slugs;
}

/**
 * Sanitize one harvested value for a table cell.
 *
 * Every ledger value comes from a file on disk, so a newline would break the
 * row and a `|` would invent a column. Newlines become spaces and pipes
 * become slashes; an empty result reads as `unknown`, never as a blank cell
 * that could be mistaken for an authored `—`.
 *
 * @param {*} value
 * @returns {string}
 */
function ledgerCell(value) {
  const text = String(value == null ? '' : value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\|/g, '/')
    .trim();
  return text === '' ? 'unknown' : text;
}

/**
 * Render one harvestFeature record as a LEDGER.md table row.
 *
 * Cells are emitted in LEDGER_COLUMNS order; `Findings (C/H/M/L)` renders as
 * `critical/high/medium/low` and `Artifacts` as the four provenance tokens
 * joined with `; `. Every cell passes through ledgerCell, so no harvested
 * value can break the table.
 *
 * @param {ReturnType<typeof harvestFeature>} record
 * @returns {string}
 */
function renderLedgerRow(record) {
  const r = record || {};
  const f = r.findings || {};
  const findings = `${f.critical || 0}/${f.high || 0}/${f.medium || 0}/${f.low || 0}`;
  const artifacts = Array.isArray(r.artifacts) ? r.artifacts.join('; ') : '';

  const cells = [
    r.slug,
    r.shipped,
    r.profile,
    r.verify,
    r.unresolvedCarried,
    r.planRounds,
    r.fixRounds,
    findings,
    r.phases,
    artifacts
  ].map(ledgerCell);

  return `| ${cells.join(' | ')} |`;
}

/**
 * Append ledger rows to `{root}/.project-manager/LEDGER.md`.
 *
 * Creates the file with its frontmatter, heading, provenance note, header
 * row, and separator when absent. When it exists, rows are appended after
 * the last non-empty line and the frontmatter `updated:` value is bumped —
 * existing rows are never re-read, re-rendered, or rewritten, which is what
 * makes the ledger append-only rather than merely idempotent. The table is
 * therefore assumed to be the last content in the file; the file is
 * generated and never hand-edited, so an authored footer would be a bug.
 *
 * An empty `records` writes nothing at all — no mtime churn on the common
 * path where every slug is already recorded.
 *
 * Never throws: any failure returns 0 silently, because a harvest failure
 * must never break the status transition that triggered it.
 *
 * @param {string} root - the resolved state root holding .project-manager/
 * @param {ReturnType<typeof harvestFeature>[]} records
 * @param {string} today - YYYY-MM-DD
 * @returns {number} rows appended
 */
function appendLedger(root, records, today) {
  try {
    if (!Array.isArray(records) || records.length === 0) return 0;

    const ledgerPath = path.join(root, '.project-manager', 'LEDGER.md');
    const rows = records.map(renderLedgerRow).join('\n');
    const header = `| ${LEDGER_COLUMNS.join(' | ')} |`;
    const separator = `|${LEDGER_COLUMNS.map(() => '---').join('|')}|`;

    const existing = readOptional(ledgerPath);
    // A body with no header row holds no rows `ledgerSlugs` can key on, so
    // appending to it would duplicate every record on every run and never
    // restore the header. Nothing parseable is lost by rebuilding: without a
    // header the column order is unknowable, so the bytes below it are not
    // ledger data. This is the only path that does not append.
    const rebuild = existing === null || !hasLedgerHeader(existing);
    let content;
    if (rebuild) {
      content =
        `---\nupdated: "${today}"\n---\n\n# Ledger\n\n` +
        'Mechanically harvested by `ship/pm-update.cjs` when a feature reaches `done` — one row per feature, keyed on slug.\n' +
        'Append-only: a recorded row is never rewritten, and this file is never hand-edited.\n\n' +
        `${header}\n${separator}\n${rows}\n`;
    } else {
      content = `${existing.trimEnd()}\n${rows}\n`;
      content = bumpUpdated(content, today);
    }

    writeFileAtomic(ledgerPath, content);
    return records.length;
  } catch (e) {
    return 0; // silent by contract
  }
}

/**
 * Bump a leading frontmatter block's `updated:` value to `today` (quoted
 * form), leaving every other byte — including CRLF terminators — intact.
 * Content with no frontmatter block, or none carrying `updated:`, is
 * returned unchanged.
 *
 * @param {string} content
 * @param {string} today - YYYY-MM-DD
 * @returns {string}
 */
function bumpUpdated(content, today) {
  const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (!fmMatch) return content;
  // `.` excludes \r, so a CRLF line's terminator survives the replacement intact.
  const bumped = fmMatch[0].replace(/^updated:.*$/m, `updated: "${today}"`);
  return bumped + content.slice(fmMatch[0].length);
}

/**
 * Harvest every not-yet-recorded feature into the ledger.
 *
 * Candidates are every directory under `{cwd}/.planning/archive/` plus every
 * named slug the status mapping already calls `done`. Slugs already present
 * in LEDGER.md are dropped **before any feature artifact is read**, so the
 * archive is not re-parsed on every status transition — only the first
 * backfill walks it.
 *
 * Gated on the `.project-manager/` *directory*, not on ROADMAP.md: the
 * ledger is independent evidence, and a damaged roadmap must not silently
 * disable it.
 *
 * Never throws; returns the number of rows appended.
 *
 * @param {string} cwd - the lane whose .planning/ holds the features
 * @param {string} root - the resolved state root holding .project-manager/
 * @param {string[]} slugs - slugs named on the command line
 * @param {string} today - YYYY-MM-DD
 * @returns {number}
 */
function runHarvest(cwd, root, slugs, today) {
  try {
    if (!fs.existsSync(path.join(root, '.project-manager'))) return 0;

    const candidates = new Set();

    try {
      const archiveDir = path.join(cwd, '.planning', 'archive');
      for (const entry of fs.readdirSync(archiveDir, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.add(entry.name);
      }
    } catch (e) {
      // no archive yet — forward appends still apply
    }

    for (const slug of slugs || []) {
      if (mappedStatus(cwd, slug, '') === 'done') candidates.add(slug);
    }

    if (candidates.size === 0) return 0;

    const recorded = ledgerSlugs(readOptional(path.join(root, '.project-manager', 'LEDGER.md')) || '');
    const pending = [...candidates].filter(slug => !recorded.has(slug)).sort();
    if (pending.length === 0) return 0;

    const records = pending.map(slug => harvestFeature(cwd, slug, today)).filter(r => r !== null);
    return appendLedger(root, records, today);
  } catch (e) {
    return 0; // silent by contract
  }
}

module.exports = { parseRoadmap, resolveBaseRef, archiveMergeStatus, mappedStatus, applyStatusUpdates, stampFirstSeen, applyLaneColumn, laneOwnershipMap, bumpUpdated, selectNext, computeUnblocks, derivePriority, generateDashboard, writeFileAtomic, stampLane, harvestFeature, ledgerSlugs, hasLedgerHeader, renderLedgerRow, appendLedger, runHarvest };

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const wantNext = args.includes('--next');
    const wantEvidence = args.includes('--evidence');
    const slugs = args.filter(a => a !== '--next' && a !== '--evidence');
    const cwd = process.cwd();

    // One date for every stamp this run makes, so a ledger row and a
    // frontmatter bump written together can never disagree.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Lane stamp — best effort, and deliberately BEFORE the .project-manager/
    // early-exit: the stamp records which lane owns the feature and must not
    // become conditional on a PM directory existing. `--next` and `--evidence`
    // both mean "write nothing", so they suppress this too.
    if (!wantNext && !wantEvidence) {
      for (const slug of slugs) {
        try {
          stampLane(cwd, slug);
        } catch (e) {
          // silent by contract — a missing stamp degrades to the sweep's branch layer
        }
      }
    }

    // Shared state lives at the resolved root; feature status stays
    // lane-local, so applyStatusUpdates below keeps cwd by design.
    const { root } = resolveStateRoot(cwd);

    // Ledger harvest — deliberately BEFORE the roadmap early-exit below: the
    // ledger gates on the .project-manager/ directory, not on ROADMAP.md, so a
    // damaged or missing roadmap cannot silently disable it. Query modes write
    // nothing, so they suppress it. A harvest failure never reaches stderr and
    // never changes the exit code — the status transition is the caller's job.
    if (!wantNext && !wantEvidence) {
      try {
        runHarvest(cwd, root, slugs, today);
      } catch (e) {
        // silent by contract
      }
    }

    const roadmapPath = path.join(root, '.project-manager', 'ROADMAP.md');
    // Absent .project-manager/ (or just no roadmap): silent success, so
    // lifecycle skills can invoke unconditionally.
    if (!fs.existsSync(roadmapPath)) process.exit(0);

    if (wantNext) {
      // Query only — even combined with slugs, --next suppresses all writes.
      const rows = parseRoadmap(fs.readFileSync(roadmapPath, 'utf8'));
      console.log(JSON.stringify(selectNext(rows)));
      process.exit(0);
    }

    if (wantEvidence) {
      // Query only — the priority evidence behind PM:PRIORITY, in document
      // order, one entry per backlog row including slugless ones. Writes
      // nothing: no roadmap edit, no stamp, no dashboard, no ledger.
      const rows = parseRoadmap(fs.readFileSync(roadmapPath, 'utf8'));
      const unblocks = computeUnblocks(rows);
      const out = rows.map(row => Object.assign(
        { item: row.cells.Item },
        derivePriority(row, unblocks.get(row.cells.Item)),
        { milestone: row.milestone || null, status: row.recorded }
      ));
      console.log(JSON.stringify(out, null, 2));
      process.exit(0);
    }

    // Fleet sweep — best effort, never fatal, and run once for both readers:
    // the derived Lane column below and the dashboard's Lanes panel.
    let laneData = null;
    try {
      laneData = require('./lane-sweep.cjs').sweep(cwd);
    } catch (e) {
      laneData = null; // absent module or sweep crash → panel degrades
    }

    const original = fs.readFileSync(roadmapPath, 'utf8');
    const updated = applyStatusUpdates(original, cwd, slugs);
    // First-sight stamp runs on the status pass's output, so both edits land
    // in one atomic write and one `updated:` bump.
    const stamped = stampFirstSeen(updated.content, today);
    // Derived Lane column. Skipped entirely when the sweep is unavailable or
    // errored: writing `—` from a failed sweep would be inventing "unowned",
    // which is the exact failure class this is here to close.
    const sweepUsable = laneData !== null && !laneData.error;
    const laned = sweepUsable
      ? applyLaneColumn(stamped.content, laneOwnershipMap(laneData))
      : { content: stamped.content, changed: false };
    const changed = updated.changed || stamped.changed || laned.changed;
    const content = changed ? bumpUpdated(laned.content, today) : laned.content;
    if (changed) {
      try {
        writeFileAtomic(roadmapPath, content);
      } catch (e) {
        process.stderr.write(`pm-update: failed to write ROADMAP.md: ${e.message}\n`);
        process.exit(1);
      }
    }

    // Always regenerate, even when no row changed, so a stale dashboard heals.
    const html = generateDashboard(root, laneData);
    if (html === null) {
      process.stderr.write('pm-update: dashboard template unreadable — skipping dashboard regeneration\n');
    } else {
      try {
        writeFileAtomic(path.join(root, '.project-manager', 'dashboard.html'), html);
      } catch (e) {
        process.stderr.write(`pm-update: failed to write dashboard.html: ${e.message}\n`);
        process.exit(1);
      }
    }
  } catch (e) {
    // Malformed state never crashes the caller — the parser already skips
    // bad rows, and anything else degrades to a silent no-op.
    process.exit(0);
  }
}
