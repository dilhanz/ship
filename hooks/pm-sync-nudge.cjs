#!/usr/bin/env node
// Ship PM sync nudge — PostToolUse hook (Write|Edit)
// Compares Ship feature statuses against the statuses recorded in
// .project-manager/ROADMAP.md and injects a nudge to run /ship:pm-sync
// when they drift. Debounced via .project-manager/.nudge-state.json so
// the same drift set nudges only once.

const fs = require('fs');
const path = require('path');
const { scanFeatures } = require('./scan-features.cjs');

/**
 * Parse ROADMAP.md backlog table rows into { slug, recorded } pairs.
 * Rows are `| Item | Status | Priority | Depends on | Ship feature |`;
 * skips the header row, separator rows, and rows without a Ship feature slug.
 */
function parseRoadmapRows(content) {
  const pairs = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());
    if (cells.length !== 5) continue;
    if (cells[0] === 'Item') continue; // header row
    if (cells.every(c => /^:?-+:?$/.test(c))) continue; // separator row
    const slug = cells[4];
    if (!slug || slug === '—' || slug === '-') continue;
    pairs.push({ slug, recorded: cells[1] });
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
      if (actual === 'done' && recorded !== 'done') {
        drifted.push({ slug, recorded, actual });
      } else if (actual === 'in-progress' && (recorded === 'pending' || recorded === 'done')) {
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
    lines.push('Run /ship:pm-sync to update the project manager state.');

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
