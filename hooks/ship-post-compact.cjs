#!/usr/bin/env node
// Ship PostCompact — PostCompact hook
// Re-injects feature state after context compaction so Claude doesn't
// lose track of which feature is active, current phase, and task progress.

const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const cwd = process.cwd();
    const featuresDir = path.join(cwd, '.planning', 'features');

    if (!fs.existsSync(featuresDir)) {
      process.exit(0);
    }

    const dirs = fs.readdirSync(featuresDir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    if (dirs.length === 0) {
      process.exit(0);
    }

    const snapshots = [];

    for (const dir of dirs) {
      const contextPath = path.join(featuresDir, dir.name, 'CONTEXT.md');
      if (!fs.existsSync(contextPath)) continue;

      const contextContent = fs.readFileSync(contextPath, 'utf8');
      const statusMatch = contextContent.match(/^status:\s*(.+)$/m);
      const status = statusMatch ? statusMatch[1].trim() : 'unknown';

      // Only include active features (not done)
      if (status === 'done') continue;

      const snapshot = { name: dir.name, status };

      // Extract key decisions if present
      // NOTE: Uses $ instead of \Z for JS compatibility (end-of-string anchor)
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
        const planContent = fs.readFileSync(planPath, 'utf8');

        // Count tasks by status
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
      }

      snapshots.push(snapshot);
    }

    if (snapshots.length === 0) {
      process.exit(0);
    }

    // Build the context message
    const lines = ['SHIP FEATURE STATE (restored after compaction):'];
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

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostCompact',
        additionalContext: lines.join('\n')
      }
    }));
  } catch (e) {
    // Silent fail — never block compaction
    process.exit(0);
  }
});
