#!/usr/bin/env node
// Ship PostCompact — PostCompact hook
// Re-injects feature state after context compaction so Claude doesn't
// lose track of which feature is active, current phase, and task progress.

const { scanFeatures, formatFeatureState } = require('./scan-features.cjs');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const cwd = process.cwd();
    const snapshots = scanFeatures(cwd);

    if (snapshots.length === 0) {
      process.exit(0);
    }

    const context = formatFeatureState(snapshots, 'SHIP FEATURE STATE (restored after compaction):');

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostCompact',
        additionalContext: context
      }
    }));
  } catch (e) {
    // Silent fail — never block compaction
    process.exit(0);
  }
});
