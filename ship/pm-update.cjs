#!/usr/bin/env node
// Ship PM mechanical updater — applies the pm-state status mapping table to
// .project-manager/ROADMAP.md rows and regenerates dashboard.html
// deterministically from the state files. `--next` prints the recommended
// next item as JSON without writing anything.
//
// Zero dependencies. Invoked by lifecycle skills after CONTEXT.md status
// changes: `node pm-update.cjs [slug ...]` — a silent no-op when
// .project-manager/ is absent.
//
// .project-manager/ paths resolve to the main worktree root when the
// directory is gitignored (see resolve-state-root.cjs); feature status is
// still read from the invoking worktree's .planning/.

const fs = require('fs');
const path = require('path');
const { resolveStateRoot } = require('./resolve-state-root.cjs');

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
 * The pm-state status mapping table, mechanically applied.
 * Returns the status the row should record, or null for "unchanged"
 * (recorded `blocked` on an active feature, slug found nowhere, or a slug
 * that is not a usable path segment). Never invents a status.
 *
 * @param {string} cwd
 * @param {string} slug
 * @param {string} recorded - the row's currently recorded status
 * @returns {string|null}
 */
function mappedStatus(cwd, slug, recorded) {
  if (!isValidSlug(slug)) return null; // not a slug — never let it reach path.join

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

  // Bump frontmatter `updated` — within the leading --- block only, CRLF or LF.
  const fmMatch = result.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (fmMatch) {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    // `.` excludes \r, so a CRLF line's terminator survives the replacement intact.
    const bumped = fmMatch[0].replace(/^updated:.*$/m, `updated: "${today}"`);
    result = bumped + result.slice(fmMatch[0].length);
  }

  return { content: result, changed: true };
}

/**
 * The "work on next" selection rule — the single home of the rule stated in
 * skills/pm-state/SKILL.md (PM:NEXT): the highest-priority non-done,
 * non-blocked item whose Depends-on items are all done.
 *
 * - `—`/`-`/empty Depends on means independent; otherwise every comma-separated
 *   name must match some row's Item (exact, case-sensitive) whose Status is
 *   `done`. An unknown name counts as unmet — never recommend an item whose
 *   dependency cannot be verified.
 * - Priority ranks P0 < P1 < P2 < P3; missing/invalid sorts after P3.
 *   Ties break by document order.
 *
 * @param {ReturnType<typeof parseRoadmap>} rows
 * @returns {{ item: string, milestone: string|null, priority: string|null, shipFeature: string|null }|null}
 */
function selectNext(rows) {
  const doneItems = new Set(
    rows
      .filter(r => (r.recorded || '').toLowerCase() === 'done')
      .map(r => r.cells.Item)
  );

  const empty = v => !v || v === '—' || v === '-';

  let best = null;
  let bestRank = Infinity;

  for (const row of rows) {
    const status = (row.recorded || '').toLowerCase();
    if (status === 'done' || status === 'blocked') continue;

    const depends = row.cells['Depends on'];
    if (!empty(depends)) {
      const names = depends.split(',').map(d => d.trim()).filter(d => d !== '');
      if (!names.every(name => doneItems.has(name))) continue;
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

/** HTML-escape every value taken from state files before interpolation. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Read a file, returning null when absent or unreadable — never throws. */
function readOptional(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
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
  const project = esc(projectMatch ? projectMatch[1].trim() : '');
  const updated = `Last synced ${esc(updatedMatch ? updatedMatch[1].trim() : '')}`;

  // PM:NEXT — the selectNext rule, same code path as --next
  const next = selectNext(rows);
  let nextHtml;
  if (next) {
    const meta = [next.milestone, next.priority, next.shipFeature]
      .filter(v => v !== null && v !== '')
      .map(esc)
      .join(' &middot; ');
    nextHtml = `<div class="item-name">${esc(next.item)}</div><div class="item-meta">${meta}</div>`;
  } else {
    nextHtml = '<p class="empty">Nothing ready — all items done or blocked</p>';
  }

  // PM:INFLIGHT — STATUS.md `## In flight` bullets
  const inflightEntries = status === null ? [] : bulletEntries(sectionBody(status, 'In flight'));
  const inflightHtml = inflightEntries.length > 0
    ? `<ul>${inflightEntries.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`
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
      `<div class="milestone-head"><h3>${esc(m.name)}</h3><span class="badge ${esc(m.status)}">${esc(m.status)}</span><span class="progress-label">${done}/${total}</span></div>`,
      `<p class="goal">${esc(m.goal || '')}</p>`,
      `<div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>`
    ];

    if (mRows.length > 0) {
      const headers = mRows[0].headers;
      const cellHtml = (row, header) => {
        const value = row.cells[header] || '';
        if (header === 'Status') return `<td class="status-${esc(value.toLowerCase())}">${esc(value)}</td>`;
        if (header === 'Size') return `<td class="size">${esc(value)}</td>`;
        if (header === 'Source') return `<td class="source">${esc(value)}</td>`;
        return `<td>${esc(value)}</td>`;
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
        const label = `<p><strong>${esc(r.cells.Item)}</strong>${r.milestone ? ` &middot; ${esc(r.milestone)}` : ''}</p>`;
        const reason = blockedReasons.get(r.cells.Item);
        return reason ? `${label}\n<p class="blocker-reason">${esc(reason)}</p>` : label;
      }).join('\n')
    : '<p class="empty">No blockers</p>';

  // PM:DECISIONS — the 5 most recent entries (newest first in the file)
  const decisions = decisionsFile === null ? [] : parseDecisions(decisionsFile).slice(0, 5);
  const decisionsHtml = decisions.length > 0
    ? decisions.map(d =>
        `<div class="decision"><span class="date">${esc(d.date)}</span> <span class="title">${esc(d.title)}</span><p>${esc(d.body)}</p></div>`
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

module.exports = { parseRoadmap, mappedStatus, applyStatusUpdates, selectNext, generateDashboard, writeFileAtomic };

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const wantNext = args.includes('--next');
    const slugs = args.filter(a => a !== '--next');
    const cwd = process.cwd();
    // Shared state lives at the resolved root; feature status stays
    // lane-local, so applyStatusUpdates below keeps cwd by design.
    const { root } = resolveStateRoot(cwd);

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

    const original = fs.readFileSync(roadmapPath, 'utf8');
    const { content, changed } = applyStatusUpdates(original, cwd, slugs);
    if (changed) {
      try {
        writeFileAtomic(roadmapPath, content);
      } catch (e) {
        process.stderr.write(`pm-update: failed to write ROADMAP.md: ${e.message}\n`);
        process.exit(1);
      }
    }

    // Fleet sweep for the dashboard's Lanes panel — best effort, never fatal.
    let laneData = null;
    try {
      laneData = require('./lane-sweep.cjs').sweep(cwd);
    } catch (e) {
      laneData = null; // absent module or sweep crash → panel degrades
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
