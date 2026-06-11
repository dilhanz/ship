#!/usr/bin/env node
// Ship SubagentStop — SubagentStop hook
// Validates that the builder agent returned a valid build_result JSON block.
// If the builder stopped without a proper result (turn exhaustion, crash),
// injects a recovery message so the orchestrator can handle the failure.

const VALID_STATUSES = ['COMPLETE', 'COMPLETE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'CHECKPOINT'];
const QA_VALID_STATUSES = ['PASS', 'FAIL'];
const REVIEW_VALID_STATUSES = ['APPROVED', 'NEEDS_FIXES'];

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

/**
 * Extract and parse a fenced ```qa_result JSON block from text.
 * Returns the parsed object or null if not found/invalid.
 */
function extractQaResult(text) {
  if (!text) return null;

  // Match ```qa_result ... ``` fenced block
  const fenceMatch = text.match(/```qa_result\s*\n([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed && QA_VALID_STATUSES.includes((parsed.status || '').toUpperCase())) {
        return parsed;
      }
    } catch (e) { /* fall through */ }
  }

  // Fallback: try to find a raw JSON object with a "status" field matching QA statuses
  const jsonMatch = text.match(/\{[\s\S]*?"status"\s*:\s*"([\w_]+)"[\s\S]*?\}/);
  if (jsonMatch && QA_VALID_STATUSES.includes(jsonMatch[1].toUpperCase())) {
    try {
      const startIdx = text.indexOf(jsonMatch[0]);
      let depth = 0;
      let endIdx = startIdx;
      for (let i = startIdx; i < text.length; i++) {
        if (text[i] === '{') depth++;
        if (text[i] === '}') depth--;
        if (depth === 0) { endIdx = i + 1; break; }
      }
      const parsed = JSON.parse(text.slice(startIdx, endIdx));
      if (parsed && QA_VALID_STATUSES.includes((parsed.status || '').toUpperCase())) {
        return parsed;
      }
    } catch (e) { /* fall through */ }
  }

  return null;
}

/**
 * Extract and parse a fenced ```review_result JSON block from text.
 * Returns the parsed object or null if not found/invalid.
 */
function extractReviewResult(text) {
  if (!text) return null;

  // Match ```review_result ... ``` fenced block
  const fenceMatch = text.match(/```review_result\s*\n([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed && REVIEW_VALID_STATUSES.includes((parsed.status || '').toUpperCase())) {
        return parsed;
      }
    } catch (e) { /* fall through */ }
  }

  // Fallback: try to find a raw JSON object with a "status" field matching review statuses
  const jsonMatch = text.match(/\{[\s\S]*?"status"\s*:\s*"([\w_]+)"[\s\S]*?\}/);
  if (jsonMatch && REVIEW_VALID_STATUSES.includes(jsonMatch[1].toUpperCase())) {
    try {
      const startIdx = text.indexOf(jsonMatch[0]);
      let depth = 0;
      let endIdx = startIdx;
      for (let i = startIdx; i < text.length; i++) {
        if (text[i] === '{') depth++;
        if (text[i] === '}') depth--;
        if (depth === 0) { endIdx = i + 1; break; }
      }
      const parsed = JSON.parse(text.slice(startIdx, endIdx));
      if (parsed && REVIEW_VALID_STATUSES.includes((parsed.status || '').toUpperCase())) {
        return parsed;
      }
    } catch (e) { /* fall through */ }
  }

  return null;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);

    // Only validate the ship-builder, ship-qa, and ship-reviewer agents
    if (!data.agent_name || !['ship-builder', 'ship-qa', 'ship-reviewer'].includes(data.agent_name)) {
      process.exit(0);
    }

    const lastMessage = data.last_assistant_message || '';

    if (data.agent_name === 'ship-reviewer') {
      const result = extractReviewResult(lastMessage);

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
            'REVIEWER AGENT STOPPED WITHOUT VALID RESULT. ' +
            'The reviewer agent did not emit a valid review_result JSON block with an expected status ' +
            '(APPROVED, NEEDS_FIXES). ' +
            'This likely means the reviewer hit its turn limit or encountered an error. ' +
            'Last output fragment:\n' + truncated + '\n\n' +
            'RECOVERY: Treat this phase\'s review as skipped — record a \'review skipped\' concern and proceed with the build. Do NOT retry the reviewer or block the phase.'
        }
      }));
      return;
    }

    if (data.agent_name === 'ship-qa') {
      const result = extractQaResult(lastMessage);

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
            'QA AGENT STOPPED WITHOUT VALID RESULT. ' +
            'The QA agent did not emit a valid qa_result JSON block with an expected status ' +
            '(PASS, FAIL). ' +
            'This likely means the QA agent hit its turn limit or encountered an error. ' +
            'Last output fragment:\n' + truncated + '\n\n' +
            'RECOVERY: Check if .planning/features/{name}/QA.md was written for partial results. ' +
            'Consider re-invoking the QA agent.'
        }
      }));
      return;
    }

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
