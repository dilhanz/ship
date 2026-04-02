#!/usr/bin/env node
// Ship SubagentStop — SubagentStop hook
// Validates that the builder agent returned a valid build_result JSON block.
// If the builder stopped without a proper result (turn exhaustion, crash),
// injects a recovery message so the orchestrator can handle the failure.

const VALID_STATUSES = ['COMPLETE', 'COMPLETE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'CHECKPOINT'];

/**
 * Extract and parse a fenced ```build_result JSON block from text.
 * Returns the parsed object or null if not found/invalid.
 */
function extractBuildResult(text) {
  if (!text) return null;

  // Match ```build_result ... ``` fenced block
  const fenceMatch = text.match(/```build_result\s*\n([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed && VALID_STATUSES.includes((parsed.status || '').toUpperCase())) {
        return parsed;
      }
    } catch (e) { /* fall through */ }
  }

  // Fallback: try to find a raw JSON object with a "status" field matching valid statuses
  // This handles cases where the model omits the fence tag
  const jsonMatch = text.match(/\{[\s\S]*?"status"\s*:\s*"([\w_]+)"[\s\S]*?\}/);
  if (jsonMatch && VALID_STATUSES.includes(jsonMatch[1].toUpperCase())) {
    try {
      // Find the complete JSON object by matching balanced braces
      const startIdx = text.indexOf(jsonMatch[0]);
      let depth = 0;
      let endIdx = startIdx;
      for (let i = startIdx; i < text.length; i++) {
        if (text[i] === '{') depth++;
        if (text[i] === '}') depth--;
        if (depth === 0) { endIdx = i + 1; break; }
      }
      const parsed = JSON.parse(text.slice(startIdx, endIdx));
      if (parsed && parsed.feature && VALID_STATUSES.includes((parsed.status || '').toUpperCase())) {
        return parsed;
      }
    } catch (e) { /* fall through */ }
  }

  // Legacy fallback: check for old Markdown format (## BUILD RESULT ... Status: X)
  const legacyMatch = text.match(/##\s*BUILD RESULT[\s\S]*?Status:\s*([\w_]+)/i);
  if (legacyMatch && VALID_STATUSES.includes(legacyMatch[1].toUpperCase())) {
    return { status: legacyMatch[1].toUpperCase(), _legacy: true };
  }

  return null;
}

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
    const result = extractBuildResult(lastMessage);

    if (result) {
      // Valid result — no intervention needed
      process.exit(0);
    }

    // Invalid or missing result — inject recovery message
    const lastLines = lastMessage.split('\n').filter(l => l.trim()).slice(-10).join('\n');
    const truncated = lastLines.length > 500 ? lastLines.slice(-500) : lastLines;

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SubagentStop',
        additionalContext:
          'BUILDER AGENT STOPPED WITHOUT VALID RESULT. ' +
          'The builder agent did not emit a valid build_result JSON block with an expected status ' +
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
