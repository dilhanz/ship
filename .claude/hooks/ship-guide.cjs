#!/usr/bin/env node
// Ship Guide — SessionStart hook
// Injects Ship awareness into every conversation so Claude proactively
// suggests Ship commands when it detects feature/fix work.
// Also scans .planning/features/ for in-progress work and reports it.

const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    // Scan for in-progress features
    const cwd = process.cwd();
    const featuresDir = path.join(cwd, '.planning', 'features');
    let featureSummary = '';

    if (fs.existsSync(featuresDir)) {
      try {
        const dirs = fs.readdirSync(featuresDir, { withFileTypes: true })
          .filter(d => d.isDirectory());

        if (dirs.length > 0) {
          const features = [];
          for (const dir of dirs) {
            const contextPath = path.join(featuresDir, dir.name, 'CONTEXT.md');
            if (fs.existsSync(contextPath)) {
              try {
                const content = fs.readFileSync(contextPath, 'utf8');
                const statusMatch = content.match(/^status:\s*(.+)$/m);
                const status = statusMatch ? statusMatch[1].trim() : 'unknown';
                if (status !== 'done') {
                  features.push(`${dir.name} (${status})`);
                }
              } catch (e) {
                features.push(`${dir.name} (unknown)`);
              }
            }
          }
          if (features.length > 0) {
            featureSummary = '\nIn-progress features: ' + features.join(', ') +
              '. Mention these to the user — they can run /ship-resume to continue.';
          }
        }
      } catch (e) {
        // Best effort — don't break session start
      }
    }

    const guide = [
      'Ship (feature development framework) is installed. When you detect feature/fix work, suggest the appropriate command:',
      '- New feature or fix to build → /ship-start "description"',
      '- Continue previous work → /ship-resume',
      '- Check progress → /ship-status',
      '- Full command reference → /ship-help',
      'Only suggest Ship for multi-step feature work. Quick edits, questions, or explorations don\'t need it. Don\'t force it — if the user declines, work normally.',
      featureSummary
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
