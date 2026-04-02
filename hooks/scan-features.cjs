#!/usr/bin/env node
// Ship shared utility — feature state scanner
// Extracts feature status, task progress, current phase, goal, and decisions
// from .planning/features/. Used by guide.cjs and post-compact.cjs.

const fs = require('fs');
const path = require('path');

/**
 * Scan .planning/features/ and return snapshots of all non-done features.
 * @param {string} cwd - working directory
 * @returns {{ name: string, status: string, goal?: string, currentPhase?: string, tasks?: { done: number, pending: number, building: number, total: number }, decisions?: string[] }[]}
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

    // Only include active features (not done)
    if (status === 'done') continue;

    const snapshot = { name: dir.name, status };

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
