#!/usr/bin/env node
// Ship PM sync nudge — PostToolUse hook (Write|Edit)
// Compares Ship feature statuses against the statuses recorded in
// .project-manager/ROADMAP.md and injects a nudge to run ship/pm-update.cjs
// for the drifted slugs (/ship:pm-sync is reserved for structural drift)
// when they drift. Debounced via .project-manager/.nudge-state.json so
// the same drift set nudges only once.

const fs = require('fs');
const path = require('path');
const { scanFeatures } = require('./scan-features.cjs');

/**
 * Parse ROADMAP.md backlog table rows into { slug, recorded } pairs.
 *
 * Columns are located by header *name*, not position or count, so both the
 * legacy 5-column table (`| Item | Status | Priority | Depends on | Ship feature |`)
 * and the enriched 7-column one (which adds `Size` and `Source`) parse — including
 * two tables of different shapes in the same file, and columns in any order.
 *
 * A table row is any line that starts and ends with `|`. A row is a header when its
 * cells include `Item`, `Status`, and `Ship feature`; that header becomes the active
 * context (column count + indexes) for the rows beneath it. Rows before any header,
 * rows whose cell count differs from their header's, separator rows, and rows without
 * a Ship feature slug all contribute nothing. A non-blank, non-table line ends the
 * active table, so a later table can never inherit the previous header's layout.
 */
function parseRoadmapRows(content) {
  const pairs = [];
  let ctx = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
      // Blank lines may separate a header from its rows; anything else ends the table.
      if (trimmed !== '') ctx = null;
      continue;
    }

    const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());

    const itemIdx = cells.indexOf('Item');
    const statusIdx = cells.indexOf('Status');
    const slugIdx = cells.indexOf('Ship feature');
    if (itemIdx !== -1 && statusIdx !== -1 && slugIdx !== -1) {
      ctx = { columnCount: cells.length, itemIdx, statusIdx, slugIdx };
      continue;
    }

    if (!ctx) continue; // a table without the required headers contributes nothing
    if (cells.every(c => /^:?-+:?$/.test(c))) continue; // separator row
    if (cells.length !== ctx.columnCount) continue; // malformed row (e.g. stray pipe)

    const slug = cells[ctx.slugIdx];
    if (!slug || slug === '—' || slug === '-') continue;
    pairs.push({ slug, recorded: cells[ctx.statusIdx] });
  }

  return pairs;
}

/**
 * Coarse actual status for a slug: 'done', 'in-progress', or 'unknown'.
 */
function actualStatus(cwd, slug, activeSlugs) {
  if (fs.existsSync(path.join(cwd, '.planning', 'archive', slug))) return 'done';
  const contextPath = path.join(cwd, '.planning', 'features', slug, 'CONTEXT.md');
  if (fs.existsSync(contextPath)) {
    try {
      const content = fs.readFileSync(contextPath, 'utf8');
      const statusMatch = content.match(/^status:\s*(.+)$/m);
      if (statusMatch && statusMatch[1].trim() === 'done') return 'done';
    } catch (e) {
      // fall through to scanFeatures check
    }
  }
  if (activeSlugs.has(slug)) return 'in-progress';
  return 'unknown';
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    let cwd = process.cwd();
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed.cwd === 'string' && parsed.cwd) cwd = parsed.cwd;
    } catch (e) {
      // no/invalid stdin JSON — fall back to process.cwd()
    }

    const roadmapPath = path.join(cwd, '.project-manager', 'ROADMAP.md');
    if (!fs.existsSync(roadmapPath)) process.exit(0);

    const rows = parseRoadmapRows(fs.readFileSync(roadmapPath, 'utf8'));
    if (rows.length === 0) process.exit(0);

    const activeSlugs = new Set(scanFeatures(cwd).map(s => s.name));

    const drifted = [];
    for (const { slug, recorded } of rows) {
      const actual = actualStatus(cwd, slug, activeSlugs);
      if (actual === 'unknown') continue;
      const recordedLower = recorded.toLowerCase();
      if (actual === 'done' && recordedLower !== 'done') {
        drifted.push({ slug, recorded, actual });
      } else if (actual === 'in-progress' && (recordedLower === 'pending' || recordedLower === 'done')) {
        drifted.push({ slug, recorded, actual });
      }
      // recorded 'blocked' never drifts against an in-progress feature
    }

    const statePath = path.join(cwd, '.project-manager', '.nudge-state.json');
    let lastDrift = '';
    try {
      lastDrift = JSON.parse(fs.readFileSync(statePath, 'utf8')).lastDrift || '';
    } catch (e) {
      // missing or malformed state — treat as no prior drift
    }

    const driftKey = drifted
      .map(d => `${d.slug}:${d.actual}`)
      .sort()
      .join(',');

    if (drifted.length === 0) {
      // Clear stale state so the same drift re-nudges if it reappears later.
      if (lastDrift) {
        try {
          fs.writeFileSync(statePath, JSON.stringify({ lastDrift: '' }));
        } catch (e) {
          // best effort
        }
      }
      process.exit(0);
    }

    if (driftKey === lastDrift) process.exit(0);

    try {
      fs.writeFileSync(statePath, JSON.stringify({ lastDrift: driftKey }));
    } catch (e) {
      // best effort — still emit the nudge
    }

    const lines = [
      'PM STATE DRIFT: .project-manager/ROADMAP.md is out of date with Ship feature statuses:'
    ];
    for (const d of drifted) {
      lines.push(`- ${d.slug}: roadmap says ${d.recorded}, actually ${d.actual}`);
    }
    const scriptPath = process.env.CLAUDE_PLUGIN_ROOT
      ? path.join(process.env.CLAUDE_PLUGIN_ROOT, 'ship', 'pm-update.cjs')
      : path.join(__dirname, '..', 'ship', 'pm-update.cjs');
    lines.push(`Run \`node "${scriptPath}" ${drifted.map(d => d.slug).join(' ')}\` to apply the mechanical fix (status cells + dashboard).`);
    lines.push('Use /ship:pm-sync for structural drift instead — work with no roadmap row, or rows needing judgment.');

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: lines.join('\n')
      }
    }));
  } catch (e) {
    // Silent fail — never break the tool loop
    process.exit(0);
  }
});
