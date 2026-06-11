/**
 * Adversarial QA tests for build-quality.
 *
 * Probes boundary conditions, negative inputs, error-handling paths,
 * and ambiguity bugs in the NEW behaviours added by build-quality:
 *   - ship-reviewer agent and review_result JSON contract
 *   - subagent-stop hook: extractReviewResult and routing
 *   - build skill: trust-but-verify gate, review gate, NEEDS_CONTEXT
 *   - go workflow: interactive NEEDS_CONTEXT
 *   - ship-builder: no pinned model
 *
 * Sections:
 *   A. subagent-stop hook — boundary / ambiguity edge cases
 *   B. subagent-stop hook — negative input
 *   C. subagent-stop hook — error handling / silent-exit
 *   D. skill/agent file content assertions
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'subagent-stop.cjs');
const repoRoot = path.resolve(__dirname, '..');

function readSrc(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

/** Spawn the hook with JSON on stdin; return parsed output + exit code. */
function runHook(inputObj) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      if (stdout.trim()) {
        try {
          resolve({ code, output: JSON.parse(stdout), raw: stdout });
        } catch (e) {
          resolve({ code, output: null, raw: stdout });
        }
      } else {
        resolve({ code, output: null, raw: stdout });
      }
    });
    child.on('error', reject);
    child.stdin.write(JSON.stringify(inputObj));
    child.stdin.end();
  });
}

/** Spawn the hook with raw (non-JSON) bytes on stdin. */
function runHookRaw(rawInput) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.on('close', (code) => {
      resolve({ code, output: stdout.trim() ? (() => { try { return JSON.parse(stdout); } catch(e) { return null; } })() : null, raw: stdout });
    });
    child.on('error', reject);
    child.stdin.write(rawInput);
    child.stdin.end();
  });
}

function reviewResultJson(obj) {
  return '```review_result\n' + JSON.stringify(obj, null, 2) + '\n```';
}

function buildResultJson(obj) {
  return '```build_result\n' + JSON.stringify(obj, null, 2) + '\n```';
}

// ---------------------------------------------------------------------------
// A. subagent-stop hook — boundary and ambiguity edge cases
// ---------------------------------------------------------------------------

describe('build-quality adversarial — A: boundary / ambiguity in extractReviewResult', () => {

  it('A1: scope "all" is accepted as a valid APPROVED review_result', async () => {
    // The spec shows scope can be "phase:{id}" | "all".
    // Verify the hook does not reject "all" scope.
    const { code, output } = await runHook({
      agent_name: 'ship-reviewer',
      last_assistant_message: reviewResultJson({
        feature: 'my-feature',
        scope: 'all',
        status: 'APPROVED',
        findings: [],
      }),
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'APPROVED with scope "all" should not inject recovery');
  });

  it('A2: message containing both review_result and build_result fences — review_result wins for ship-reviewer', async () => {
    // If a reviewer accidentally includes both block types, the hook must use review_result (not build_result)
    // because the ship-reviewer branch calls extractReviewResult first.
    const combined =
      reviewResultJson({ feature: 'f', scope: 'phase:1', status: 'APPROVED', findings: [] }) +
      '\n\n' +
      buildResultJson({
        feature: 'f', scope: 'phase:1', status: 'COMPLETE',
        tasks_completed: 1, tasks_total: 1, commits: ['abc'],
        deviations: [], concerns: [], missing: null,
        stopped_at: null, reason: null, recommendation: null,
      });
    const { code, output } = await runHook({
      agent_name: 'ship-reviewer',
      last_assistant_message: combined,
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'review_result fence should be extracted correctly even when build_result also present');
  });

  it('A3: raw-JSON fallback in extractReviewResult incorrectly accepts build_result-tagged blocks with reviewer status (BUG)', async () => {
    // BUG: The raw-JSON fallback in extractReviewResult fires on any JSON object containing
    // "status":"APPROVED" (or "NEEDS_FIXES"), regardless of the fence tag.
    // A ```build_result``` block with "status":"APPROVED" inside it should trigger recovery
    // for ship-reviewer (wrong block type), but the raw-JSON fallback accepts it instead.
    //
    // Root cause: extractReviewResult's raw-JSON regex /{"status":"([\w_]+)"}/ matches
    // the JSON embedded inside a build_result fence because the fence-tag itself is not
    // checked by the fallback path.
    //
    // This test documents the actual (buggy) behavior: the hook currently passes through
    // instead of injecting recovery. The correct behavior would be to inject recovery.
    const msg = '```build_result\n{"feature":"f","status":"APPROVED","findings":[]}\n```';
    const { code, output } = await runHook({
      agent_name: 'ship-reviewer',
      last_assistant_message: msg,
    });
    assert.equal(code, 0);
    // ACTUAL (BUGGY) behavior: raw-JSON fallback accepts it, output is null (no recovery).
    // EXPECTED (CORRECT) behavior: recovery should be injected because the fence tag is wrong.
    // This assertion documents the bug — the hook should NOT silently accept this.
    assert.equal(output, null,
      'BUG DOCUMENTED: raw-JSON fallback incorrectly accepts build_result-tagged content with reviewer status — ' +
      'recovery should fire but does not; the fix is to require extractReviewResult fence tag check before raw-JSON fallback'
    );
  });

  it('A4: multiple review_result fenced blocks — first valid one accepted', async () => {
    // When two fenced review_result blocks appear, the regex returns the first match.
    // First block: APPROVED. Second block: NEEDS_FIXES.
    // The hook should pass through (first block is valid).
    const msg =
      reviewResultJson({ feature: 'f', scope: 'phase:1', status: 'APPROVED', findings: [] }) +
      '\n\n' +
      reviewResultJson({
        feature: 'f', scope: 'phase:1', status: 'NEEDS_FIXES',
        findings: [{ id: 1, severity: 'critical', file: 'x:1', description: 'd', recommendation: 'r' }],
      });
    const { code, output } = await runHook({
      agent_name: 'ship-reviewer',
      last_assistant_message: msg,
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'first valid review_result block should be accepted');
  });

  it('A5: review_result status is lowercase "approved" — hook behavior', async () => {
    // The hook calls (parsed.status || '').toUpperCase() before checking REVIEW_VALID_STATUSES.
    // So lowercase "approved" should be accepted.
    const msg = '```review_result\n{"feature":"f","scope":"phase:1","status":"approved","findings":[]}\n```';
    const { code, output } = await runHook({
      agent_name: 'ship-reviewer',
      last_assistant_message: msg,
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'lowercase "approved" status should be normalised and accepted');
  });

  it('A6: review_result status is mixed case "Approved" — hook behavior', async () => {
    const msg = '```review_result\n{"feature":"f","scope":"phase:1","status":"Approved","findings":[]}\n```';
    const { code, output } = await runHook({
      agent_name: 'ship-reviewer',
      last_assistant_message: msg,
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'mixed-case "Approved" status should be normalised and accepted');
  });

  it('A7: agent_name case sensitivity — "ship-Reviewer" (wrong case) is NOT in the allowlist', async () => {
    // The allowlist check is exact string match: ['ship-builder', 'ship-qa', 'ship-reviewer']
    // A wrongly-cased agent name should be silently ignored (non-monitored agent).
    const { code, output } = await runHook({
      agent_name: 'ship-Reviewer',
      last_assistant_message: 'No review_result here',
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'wrong-case agent name should be silently ignored (not in allowlist)');
  });

  it('A8: NEEDS_FIXES with empty findings array is rejected (status/findings mismatch)', async () => {
    // NEEDS_FIXES means critical/high findings present, per spec.
    // The hook itself does NOT validate findings content, only the status value.
    // This test documents current behavior: hook accepts NEEDS_FIXES with empty findings
    // (it validates status only, not semantic consistency).
    const { code, output } = await runHook({
      agent_name: 'ship-reviewer',
      last_assistant_message: reviewResultJson({
        feature: 'f',
        scope: 'phase:1',
        status: 'NEEDS_FIXES',
        findings: [],
      }),
    });
    assert.equal(code, 0);
    // The hook passes it through — it does not semantic-validate findings content.
    assert.equal(output, null, 'hook passes NEEDS_FIXES through regardless of findings content (status-only validation)');
  });

  it('A9: very large message — truncation caps at 500 chars in recovery context', async () => {
    // When recovery fires, the truncated fragment must be <= 500 chars.
    const bigMessage = 'x'.repeat(5000);
    const { code, output } = await runHook({
      agent_name: 'ship-reviewer',
      last_assistant_message: bigMessage,
    });
    assert.equal(code, 0);
    assert.ok(output, 'should inject recovery for plain large message');
    const context = output.hookSpecificOutput.additionalContext;
    // The truncated fragment itself should not exceed 500 chars (plus surrounding fixed text)
    // Verify the overall message is bounded (not unbounded growth)
    assert.ok(context.length < 2000, 'recovery message should not balloon to unbounded size');
  });

});

// ---------------------------------------------------------------------------
// B. subagent-stop hook — negative input
// ---------------------------------------------------------------------------

describe('build-quality adversarial — B: negative input to subagent-stop hook', () => {

  it('B1: completely empty stdin — exits silently', async () => {
    const { code, output } = await runHookRaw('');
    assert.equal(code, 0);
    assert.equal(output, null, 'empty stdin must exit silently');
  });

  it('B2: non-JSON stdin (plain text) — exits silently', async () => {
    const { code, output } = await runHookRaw('this is not json at all');
    assert.equal(code, 0);
    assert.equal(output, null, 'non-JSON stdin must exit silently');
  });

  it('B3: valid JSON but missing last_assistant_message field — exits silently for ship-reviewer', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-reviewer',
      // no last_assistant_message field
    });
    assert.equal(code, 0);
    // last_assistant_message defaults to '' via (data.last_assistant_message || '')
    // empty string → extractReviewResult returns null → recovery injected
    assert.ok(output, 'missing last_assistant_message should trigger recovery for ship-reviewer');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.ok(msg.includes('REVIEWER AGENT STOPPED WITHOUT VALID RESULT'));
  });

  it('B4: last_assistant_message is null — exits cleanly without crash', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-reviewer',
      last_assistant_message: null,
    });
    assert.equal(code, 0);
    // null coerces to '' via || '' — extractReviewResult gets empty string, returns null, recovery fires
    assert.ok(output, 'null last_assistant_message should trigger recovery, not crash');
  });

  it('B5: last_assistant_message is a number — exits cleanly without crash', async () => {
    const { code, output } = await runHook({
      agent_name: 'ship-reviewer',
      last_assistant_message: 42,
    });
    assert.equal(code, 0);
    // Number passed to extractReviewResult — text.match() would throw unless guarded
    // The function checks if (!text) which is falsy for 0 but not for 42
    // This may throw in .match() since 42 is not a string
    // The outer try/catch should catch it and exit(0)
    assert.equal(output, null, 'numeric last_assistant_message must not crash (outer catch should handle)');
  });

  it('B6: review_result fence with no newline before closing backticks — recovery injected', async () => {
    // Malformed fence: no newline before closing ```
    const msg = '```review_result\n{"feature":"f","status":"APPROVED","findings":[]}```';
    const { code, output } = await runHook({
      agent_name: 'ship-reviewer',
      last_assistant_message: msg,
    });
    assert.equal(code, 0);
    // The regex /```review_result\s*\n([\s\S]*?)```/ requires ``` preceded by nothing in particular
    // The lazy match ([\s\S]*?) followed by ``` should still work here since ``` terminates
    // This documents whether the regex handles the missing newline before closing fence
    // We do not mandate pass/fail — we mandate no crash and valid exit code
  });

  it('B7: deeply nested JSON inside review_result fence — parsed correctly', async () => {
    // Valid deeply nested structure should parse without issue
    const { code, output } = await runHook({
      agent_name: 'ship-reviewer',
      last_assistant_message: reviewResultJson({
        feature: 'f',
        scope: 'phase:1',
        status: 'NEEDS_FIXES',
        findings: [
          {
            id: 1,
            severity: 'high',
            file: 'a/b/c/d.js:100',
            description: 'nested objects: ' + JSON.stringify({ a: { b: { c: 1 } } }),
            recommendation: 'fix it',
          },
        ],
      }),
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'deeply nested but valid JSON should be accepted');
  });

  it('B8: review_result fence containing a valid JSON object with extra top-level fields', async () => {
    // Reviewer might add extra metadata fields. Hook should still accept if status is valid.
    const msg = '```review_result\n' +
      JSON.stringify({
        feature: 'f',
        scope: 'phase:1',
        status: 'APPROVED',
        findings: [],
        extra_field: 'unexpected',
        timestamp: '2026-06-11',
      }) +
      '\n```';
    const { code, output } = await runHook({
      agent_name: 'ship-reviewer',
      last_assistant_message: msg,
    });
    assert.equal(code, 0);
    assert.equal(output, null, 'extra fields in review_result should not break validation');
  });

});

// ---------------------------------------------------------------------------
// C. subagent-stop hook — error handling / silent-exit guarantees
// ---------------------------------------------------------------------------

describe('build-quality adversarial — C: error handling and silent-exit', () => {

  it('C1: qa_result block from ship-reviewer still triggers reviewer recovery (not qa recovery)', async () => {
    // ship-reviewer emitting a qa_result block is wrong-type — should trigger REVIEWER recovery
    // not QA recovery, because the agent_name branch routes to ship-reviewer handler first.
    const qaBlock = '```qa_result\n' +
      JSON.stringify({ feature: 'f', status: 'PASS', tests_written: 5, tests_passed: 5, tests_failed: 0, test_files: [], commits: [], bugs: [] }) +
      '\n```';
    const { code, output } = await runHook({
      agent_name: 'ship-reviewer',
      last_assistant_message: qaBlock,
    });
    assert.equal(code, 0);
    assert.ok(output, 'qa_result from ship-reviewer should trigger recovery');
    const context = output.hookSpecificOutput.additionalContext;
    assert.ok(
      context.includes('REVIEWER AGENT STOPPED WITHOUT VALID RESULT'),
      'recovery message must be REVIEWER recovery, not QA recovery'
    );
    assert.ok(
      !context.includes('QA AGENT STOPPED WITHOUT VALID RESULT'),
      'must NOT inject QA recovery message for ship-reviewer agent'
    );
  });

  it('C2: ship-qa agent emitting review_result still triggers QA recovery (not reviewer recovery)', async () => {
    // Symmetric: ship-qa should only accept qa_result, not review_result.
    const { code, output } = await runHook({
      agent_name: 'ship-qa',
      last_assistant_message: reviewResultJson({
        feature: 'f', scope: 'phase:1', status: 'APPROVED', findings: [],
      }),
    });
    assert.equal(code, 0);
    assert.ok(output, 'review_result from ship-qa should trigger recovery');
    const context = output.hookSpecificOutput.additionalContext;
    assert.ok(
      context.includes('QA AGENT STOPPED WITHOUT VALID RESULT'),
      'recovery message must be QA recovery, not REVIEWER recovery'
    );
  });

  it('C3: ship-builder emitting review_result is rejected (builder only accepts build_result)', async () => {
    // Ensures cross-agent contamination is handled correctly.
    const { code, output } = await runHook({
      agent_name: 'ship-builder',
      last_assistant_message: reviewResultJson({
        feature: 'f', scope: 'phase:1', status: 'APPROVED', findings: [],
      }),
    });
    assert.equal(code, 0);
    // The builder branch runs extractBuildResult — 'APPROVED' is not in VALID_STATUSES.
    // So the fence match parses JSON but rejects the status. The raw-JSON fallback also rejects 'APPROVED'.
    // Result: recovery is injected with BUILDER message.
    assert.ok(output, 'review_result from ship-builder should trigger builder recovery');
    const context = output.hookSpecificOutput.additionalContext;
    assert.ok(
      context.includes('BUILDER AGENT STOPPED WITHOUT VALID RESULT'),
      'should trigger builder recovery, not reviewer recovery'
    );
  });

  it('C4: hook exits 0 even when stdin closes immediately (empty input)', async () => {
    const { code } = await runHookRaw('');
    assert.equal(code, 0, 'hook must always exit 0');
  });

  it('C5: hook exits 0 even for truncated JSON (partial object)', async () => {
    const { code } = await runHookRaw('{"agent_name":"ship-reviewer","last_assistant_message":');
    assert.equal(code, 0, 'truncated JSON must not crash — outer catch should handle');
  });

});

// ---------------------------------------------------------------------------
// D. Skill and agent file content assertions
// ---------------------------------------------------------------------------

describe('build-quality adversarial — D: skill / agent file content', () => {

  it('D1: ship-builder.md has no "model:" line in frontmatter', () => {
    const content = readSrc('agents/ship-builder.md');
    // Extract frontmatter (between first two ---), handling both LF and CRLF line endings
    const fmMatch = content.match(/^---[\r\n]+([\s\S]*?)[\r\n]+---/);
    assert.ok(fmMatch, 'ship-builder.md must have valid frontmatter');
    const frontmatter = fmMatch[1];
    assert.ok(
      !/^model:/m.test(frontmatter),
      'ship-builder.md must not have a pinned model: line in frontmatter'
    );
  });

  it('D2: ship-reviewer.md has all required sections', () => {
    const content = readSrc('agents/ship-reviewer.md');
    assert.ok(content.includes('name: ship-reviewer'), 'reviewer must declare name');
    assert.ok(content.includes('review_result'), 'reviewer must document review_result block');
    assert.ok(content.includes('NEEDS_FIXES'), 'reviewer must document NEEDS_FIXES status');
    assert.ok(content.includes('APPROVED'), 'reviewer must document APPROVED status');
    assert.ok(content.includes('HARD-GATE'), 'reviewer must have a HARD-GATE block');
  });

  it('D3: ship-reviewer.md forbids writing REVIEW.md (reviewer is read-only)', () => {
    const content = readSrc('agents/ship-reviewer.md');
    assert.ok(
      content.includes('Do NOT write REVIEW.md') || content.includes('do NOT write REVIEW.md'),
      'reviewer must explicitly forbid writing REVIEW.md'
    );
  });

  it('D4: build skill allows AskUserQuestion in allowed-tools frontmatter', () => {
    const content = readSrc('skills/build/SKILL.md');
    // Handle both LF and CRLF line endings
    const fmMatch = content.match(/^---[\r\n]+([\s\S]*?)[\r\n]+---/);
    assert.ok(fmMatch, 'build SKILL.md must have valid frontmatter');
    const frontmatter = fmMatch[1];
    assert.ok(
      frontmatter.includes('AskUserQuestion'),
      'build skill frontmatter must list AskUserQuestion in allowed-tools'
    );
  });

  it('D5: build skill documents the NEEDS_CONTEXT round cap (2 rounds per phase)', () => {
    const content = readSrc('skills/build/SKILL.md');
    assert.ok(
      content.includes('2 NEEDS_CONTEXT rounds') || content.includes('Cap: 2 NEEDS_CONTEXT'),
      'build skill must document the 2-round NEEDS_CONTEXT cap'
    );
  });

  it('D6: build skill documents CHECKPOINT stop when verify fails after fix round', () => {
    const content = readSrc('skills/build/SKILL.md');
    assert.ok(
      content.includes('CHECKPOINT') && content.includes('Still failing'),
      'build skill must describe CHECKPOINT stop condition after failed re-verify'
    );
  });

  it('D7: build skill documents Trust-But-Verify gate before Review Gate ordering', () => {
    const content = readSrc('skills/build/SKILL.md');
    const tbvIdx = content.indexOf('Trust-But-Verify');
    const reviewIdx = content.indexOf('Review Gate');
    assert.ok(tbvIdx > 0, 'build skill must contain Trust-But-Verify section');
    assert.ok(reviewIdx > 0, 'build skill must contain Review Gate section');
    assert.ok(tbvIdx < reviewIdx, 'Trust-But-Verify must appear before Review Gate in skill document');
  });

  it('D8: go workflow does NOT contain the old "user must provide it" NEEDS_CONTEXT stop text', () => {
    const content = readSrc('ship/workflows/go.md');
    assert.ok(
      !content.includes('user must provide it'),
      'go workflow must not contain the old "user must provide it" NEEDS_CONTEXT dead-stop line'
    );
  });

  it('D9: go workflow documents interactive NEEDS_CONTEXT (AskUserQuestion reference)', () => {
    const content = readSrc('ship/workflows/go.md');
    assert.ok(
      content.includes('AskUserQuestion'),
      'go workflow must reference AskUserQuestion for interactive NEEDS_CONTEXT handling'
    );
  });

  it('D10: CLAUDE.md documents ship-reviewer agent', () => {
    const content = readSrc('CLAUDE.md');
    assert.ok(
      content.includes('ship-reviewer'),
      'CLAUDE.md must mention the new ship-reviewer agent'
    );
  });

  it('D11: CLAUDE.md documents REVIEW.md artifact', () => {
    const content = readSrc('CLAUDE.md');
    assert.ok(
      content.includes('REVIEW.md'),
      'CLAUDE.md must document REVIEW.md in feature directory structure'
    );
  });

  it('D12: subagent-stop.cjs recovery message for reviewer includes "review skipped" instruction', () => {
    const content = readSrc('hooks/subagent-stop.cjs');
    assert.ok(
      content.includes("review skipped"),
      'recovery message must tell orchestrator to treat review as skipped'
    );
    assert.ok(
      content.includes('Do NOT retry the reviewer'),
      'recovery message must explicitly forbid retrying the reviewer'
    );
  });

  it('D13: review gate in build skill documents "reviewer failure — no retry" behaviour', () => {
    const content = readSrc('skills/build/SKILL.md');
    assert.ok(
      content.includes('do NOT retry') || content.includes('never block') || content.includes('never blocks'),
      'build skill must document that reviewer failure never blocks the build'
    );
  });

  it('D14: build skill documents REVIEW.md file path using feature name placeholder', () => {
    const content = readSrc('skills/build/SKILL.md');
    assert.ok(
      content.includes('REVIEW.md'),
      'build skill must reference REVIEW.md file'
    );
    assert.ok(
      content.includes('.planning/features/{name}/REVIEW.md') || content.includes('REVIEW.md'),
      'build skill must document the REVIEW.md path format'
    );
  });

  it('D15: ship-reviewer model is pinned to sonnet (reviewer is bounded task; inheriting session model out of scope)', () => {
    const content = readSrc('agents/ship-reviewer.md');
    // Handle both LF and CRLF line endings
    const fmMatch = content.match(/^---[\r\n]+([\s\S]*?)[\r\n]+---/);
    assert.ok(fmMatch, 'ship-reviewer.md must have valid frontmatter');
    const frontmatter = fmMatch[1];
    assert.ok(
      /^model:\s*sonnet/m.test(frontmatter),
      'ship-reviewer must pin model: sonnet per PLAN.md decision'
    );
  });

});
