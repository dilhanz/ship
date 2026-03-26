#!/usr/bin/env node
// Ship SubagentStop — SubagentStop hook
// Validates that the builder agent returned a valid BUILD RESULT block.
// If the builder stopped without a proper result (turn exhaustion, crash),
// injects a recovery message so the orchestrator can handle the failure.

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);

    // Only validate the ship-builder agent
    if (!data.agent_name || data.agent_name !== 'ship-builder') {
      process.exit(0);
    }

    const lastMessage = data.last_assistant_message || '';
    const validStatuses = ['COMPLETE', 'COMPLETE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'CHECKPOINT'];

    // Check for valid BUILD RESULT block
    const resultMatch = lastMessage.match(/##\s*BUILD RESULT[\s\S]*?Status:\s*([\w_]+)/i);
    const hasValidResult = resultMatch && validStatuses.includes(resultMatch[1].toUpperCase());

    if (hasValidResult) {
      // Valid result — no intervention needed
      process.exit(0);
    }

    // Invalid or missing BUILD RESULT — inject recovery message
    // Extract whatever useful info we can from the last message
    const lastLines = lastMessage.split('\n').filter(l => l.trim()).slice(-10).join('\n');
    const truncated = lastLines.length > 500 ? lastLines.slice(-500) : lastLines;

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SubagentStop',
        additionalContext:
          'BUILDER AGENT STOPPED WITHOUT VALID RESULT. ' +
          'The builder agent did not emit a valid "## BUILD RESULT" block with an expected status ' +
          '(COMPLETE, COMPLETE_WITH_CONCERNS, NEEDS_CONTEXT, CHECKPOINT). ' +
          'This likely means the builder hit its turn limit or encountered an error. ' +
          'Last output fragment:\n' + truncated + '\n\n' +
          'RECOVERY: Check PLAN.md for tasks marked status="done" to determine actual progress. ' +
          'Tasks still marked "pending" were not completed. ' +
          'Consider using SendMessage to continue the builder, or re-invoke with a fresh agent.'
      }
    }));
  } catch (e) {
    // Silent fail — never block agent stop
    process.exit(0);
  }
});
