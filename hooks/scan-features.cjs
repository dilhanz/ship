#!/usr/bin/env node
// Ship shared utility — feature state scanner
// Extracts feature status, task progress, current phase, goal, decisions, and
// the owning-lane stamp from .planning/features/. Features carrying a terminal
// status (the fixed tombstone set below) are excluded. Used by guide.cjs,
// post-compact.cjs, pm-sync-nudge.cjs, and ship/lane-sweep.cjs.

const fs = require('fs');
const path = require('path');

// Statuses that mean "do not pick this up". Deliberately an additive fixed set
// rather than an allowlist of Ship's known in-flight statuses: an unrecognised
// or missing status must still surface, so a typo never silently disappears
// live work.
const TERMINAL_STATUSES = new Set(['done', 'superseded', 'abandoned', 'cancelled']);

/**
 * Read the `lane:` stamp from a CONTEXT.md's leading frontmatter block only.
 *
 * Deliberately not a whole-file match (unlike the `status:` parse below):
 * CONTEXT.md bodies quote the literal string `lane: {branch} @ {worktree-path}`
 * as prose, and a whole-file match would read documentation as testimony.
 *
 * @param {string} content
 * @returns {string|null} the trimmed, unquoted value, or null when absent
 */
function parseLaneField(content) {
  const block = String(content || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return null;

  const match = block[1].match(/^lane:\s*(.+)$/m);
  if (!match) return null;

  const value = match[1].trim().replace(/^["']|["']$/g, '').trim();
  return value === '' ? null : value;
}

/**
 * Scan .planning/features/ and return snapshots of all non-terminal features.
 * @param {string} cwd - working directory
 * @returns {{ name: string, status: string, lane: string|null, goal?: string, currentPhase?: string, tasks?: { done: number, pending: number, building: number, total: number }, decisions?: string[] }[]}
 */
function scanFeatures(cwd) {
  const featuresDir = path.join(cwd, '.planning', 'features');

  if (!fs.existsSync(featuresDir)) return [];

  let dirs;
  try {
    dirs = fs.readdirSync(featuresDir, { withFileTypes: true })
      .filter(d => d.isDirectory());
  } catch (e) {
    return [];
  }

  const snapshots = [];

  for (const dir of dirs) {
    const contextPath = path.join(featuresDir, dir.name, 'CONTEXT.md');
    if (!fs.existsSync(contextPath)) continue;

    let contextContent;
    try {
      contextContent = fs.readFileSync(contextPath, 'utf8');
    } catch (e) {
      continue;
    }

    const statusMatch = contextContent.match(/^status:\s*(.+)$/m);
    const status = statusMatch ? statusMatch[1].trim() : 'unknown';

    // Only include active features — the recorded status stays verbatim,
    // normalization is for the filter only.
    if (TERMINAL_STATUSES.has(status.trim().toLowerCase())) continue;

    const snapshot = { name: dir.name, status, lane: parseLaneField(contextContent) };

    // Extract key decisions if present
    const decisionsMatch = contextContent.match(/## Decisions\n([\s\S]*?)(?=\n## |\n---|$)/);
    if (decisionsMatch) {
      const decisions = decisionsMatch[1].trim().split('\n')
        .filter(l => l.startsWith('- '))
        .slice(0, 5)
        .map(l => l.trim());
      if (decisions.length > 0) snapshot.decisions = decisions;
    }

    // Read PLAN.md for task progress if it exists
    const planPath = path.join(featuresDir, dir.name, 'PLAN.md');
    if (fs.existsSync(planPath)) {
      try {
        const planContent = fs.readFileSync(planPath, 'utf8');

        const tasksDone = (planContent.match(/status="done"/g) || []).length;
        const tasksPending = (planContent.match(/status="pending"/g) || []).length;
        const tasksBuilding = (planContent.match(/status="building"/g) || []).length;
        snapshot.tasks = {
          done: tasksDone,
          pending: tasksPending,
          building: tasksBuilding,
          total: tasksDone + tasksPending + tasksBuilding
        };

        // Find current phase if phased
        const phaseMatch = planContent.match(/<phase[^>]*name="([^"]*)"[^>]*status="building"/);
        if (phaseMatch) snapshot.currentPhase = phaseMatch[1];

        // Extract goal from frontmatter
        const goalMatch = planContent.match(/^goal:\s*"?([^"\n]+)"?$/m);
        if (goalMatch) snapshot.goal = goalMatch[1].trim();
      } catch (e) {
        // Best effort — plan reading is non-critical
      }
    }

    snapshots.push(snapshot);
  }

  return snapshots;
}

/**
 * Format feature snapshots into a human-readable context block.
 * @param {ReturnType<typeof scanFeatures>} snapshots
 * @param {string} [header] - optional header line
 * @returns {string}
 */
function formatFeatureState(snapshots, header) {
  if (snapshots.length === 0) return '';

  const lines = [];
  if (header) lines.push(header);

  for (const s of snapshots) {
    lines.push('');
    lines.push(`Feature: ${s.name} | Status: ${s.status}`);
    if (s.goal) lines.push(`Goal: ${s.goal}`);
    if (s.currentPhase) lines.push(`Current phase: ${s.currentPhase}`);
    if (s.tasks) {
      lines.push(`Tasks: ${s.tasks.done}/${s.tasks.total} done` +
        (s.tasks.building > 0 ? `, ${s.tasks.building} building` : '') +
        `, ${s.tasks.pending} pending`);
    }
    if (s.decisions) {
      lines.push('Key decisions:');
      for (const d of s.decisions) lines.push(`  ${d}`);
    }
  }

  return lines.join('\n');
}

module.exports = { scanFeatures, formatFeatureState };
