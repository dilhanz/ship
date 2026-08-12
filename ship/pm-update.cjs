#!/usr/bin/env node
// Ship PM mechanical updater — applies the pm-state status mapping table to
// .project-manager/ROADMAP.md rows and regenerates dashboard.html
// deterministically from the state files. `--next` prints the recommended
// next item as JSON without writing anything.
//
// Zero dependencies. Invoked by lifecycle skills after CONTEXT.md status
// changes: `node pm-update.cjs [slug ...]` — a silent no-op when
// .project-manager/ is absent.

const fs = require('fs');
const path = require('path');

/**
 * Parse ROADMAP.md backlog tables into row records.
 *
 * Columns are located by header *name*, not position or count, so both the
 * legacy 5-column table (`| Item | Status | Priority | Depends on | Ship feature |`)
 * and the enriched 7-column one (which adds `Size` and `Source`) parse — including
 * two tables of different shapes in the same file, and columns in any order.
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
 * The pm-state status mapping table, mechanically applied.
 * Returns the status the row should record, or null for "unchanged"
 * (recorded `blocked` on an active feature, or slug found nowhere).
 * Never invents a status.
 *
 * @param {string} cwd
 * @param {string} slug
 * @param {string} recorded - the row's currently recorded status
 * @returns {string|null}
 */
function mappedStatus(cwd, slug, recorded) {
  try {
    if (fs.existsSync(path.join(cwd, '.planning', 'archive', slug))) return 'done';
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

  const statusMatch = content.match(/^status:\s*(.+)$/m);
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

  let result = lines.join('\n');

  // Bump frontmatter `updated` — within the leading --- block only.
  const fmMatch = result.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const bumped = fmMatch[0].replace(/^updated:\s*.*$/m, `updated: "${today}"`);
    result = bumped + result.slice(fmMatch[0].length);
  }

  return { content: result, changed: true };
}

module.exports = { parseRoadmap, mappedStatus, applyStatusUpdates };
