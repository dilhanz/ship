#!/usr/bin/env node
// Ship Safety Gate — PreToolUse hook
// Blocks dangerous git patterns during builds to enforce atomic commits.
// Matcher: Bash (only fires on Bash tool uses)

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const command = data.tool_input?.command || '';

    // Block git add . and git add -A (enforce atomic staging)
    const dangerousPatterns = [
      /\bgit\s+add\s+\.\s*$/,
      /\bgit\s+add\s+\.\s*[;&|]/,
      /\bgit\s+add\s+-A\b/,
      /\bgit\s+add\s+--all\b/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        process.stderr.write(
          'BLOCKED by Ship safety gate: "git add ." and "git add -A" are not allowed. ' +
          'Ship uses atomic commits — stage specific files instead: git add file1.ts file2.ts'
        );
        process.exit(2);
      }
    }

    // Allow everything else
    process.exit(0);
  } catch (e) {
    // Silent fail — never block on hook errors
    process.exit(0);
  }
});
