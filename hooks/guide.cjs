#!/usr/bin/env node
// Ship Guide — SessionStart hook
// Injects Ship awareness into every conversation so Claude proactively
// suggests Ship commands when it detects feature/fix work.
// Also scans .planning/features/ for in-progress work and reports rich state.

const { scanFeatures, formatFeatureState } = require('./scan-features.cjs');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const cwd = process.cwd();
    const snapshots = scanFeatures(cwd);
    const featureState = formatFeatureState(snapshots, 'SHIP ACTIVE FEATURES:');

    const guide = [
      'Ship (feature development framework) is installed. When you detect feature/fix work, suggest the appropriate command:',
      '- New feature or fix to build → /ship:start "description"',
      '- Continue previous work → /ship:resume',
      '- Check progress → /ship:status',
      '- Full command reference → /ship:help',
      'Only suggest Ship for multi-step feature work. Quick edits, questions, or explorations don\'t need it. Don\'t force it — if the user declines, work normally.',
      featureState ? '\n' + featureState : ''
    ].filter(Boolean).join('\n');

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: guide
      }
    }));
  } catch (e) {
    // Silent fail — never break session start
    process.exit(0);
  }
});
