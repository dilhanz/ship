/**
 * Adversarial QA tests for build-context-isolation.
 *
 * The builder-provided test suite (build-context-isolation.test.js) asserts
 * that specific literal phrases exist anywhere in the target files. These
 * adversarial tests go further:
 *
 *   A. Constraint location — are the new instructions in the RIGHT SECTION, not
 *      accidentally in a comment, example, or unrelated section?
 *   B. Graceful-degradation coherence — does the exact error concern string the
 *      skill produces match what the test expects? Is the degradation sentence
 *      complete and unambiguous?
 *   C. Internal consistency — does the builder-invocation template reference the
 *      new "from Explore digest" label, and is the old "pre-read by orchestrator"
 *      label completely absent?
 *   D. Constraint sentence completeness — is the JSON-only handoff constraint
 *      a full, properly terminating sentence (not a fragment)?
 *   E. Test-suite foolability — would the builder-provided assertions still pass
 *      if the key phrases had appeared in the WRONG file? (Cross-file isolation)
 *   F. CLAUDE.md coherence — does CLAUDE.md document both the delegated digest
 *      AND the bounded capture in the right bullet?
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
function readSrc(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

/**
 * Extract the content of a named section (from its heading to the next same-level heading).
 * Works for ## and ### headings.
 */
function extractSection(content, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match from heading to the next heading of same or higher level
  const level = heading.match(/^(#+)/)[1].length;
  const higherOrSame = '#'.repeat(level);
  const re = new RegExp(`${escaped}[\\s\\S]*?(?=\\n${higherOrSame}[^#]|$)`);
  const m = content.match(re);
  return m ? m[0] : null;
}

// ---------------------------------------------------------------------------
// A. Constraint location tests
// ---------------------------------------------------------------------------

describe('build-context-isolation adversarial — A: constraint location', () => {

  it('A1: "Do NOT Read the candidate file bodies" is in the Pre-Build Context Loading section, not elsewhere', () => {
    const content = readSrc('skills/build/SKILL.md');
    const section = extractSection(content, '## Pre-Build Context Loading');
    assert.ok(section, 'Pre-Build Context Loading section must exist');
    assert.ok(
      section.includes('Do NOT Read the candidate file bodies'),
      'The prohibition on direct reads must appear inside the Pre-Build Context Loading section'
    );
    // Paranoia check: confirm the phrase only appears once in the whole file
    // (not duplicated in an example or comment)
    const occurrences = (content.match(/Do NOT Read the candidate file bodies/g) || []).length;
    assert.equal(occurrences, 1, 'The prohibition phrase must appear exactly once — no accidental duplication');
  });

  it('A2: "Decide pass/fail on the exit code alone" is in the Trust-But-Verify section (3.1), not elsewhere', () => {
    const content = readSrc('skills/build/SKILL.md');
    const section = extractSection(content, '### 3.1 Trust-But-Verify');
    assert.ok(section, '### 3.1 Trust-But-Verify section must exist');
    assert.ok(
      section.includes('Decide pass/fail on the exit code alone'),
      'The exit-code decision instruction must be inside the Trust-But-Verify section, not a stray occurrence'
    );
  });

  it('A3: "last 5 lines" instruction is in the Trust-But-Verify section (3.1)', () => {
    const content = readSrc('skills/build/SKILL.md');
    const section = extractSection(content, '### 3.1 Trust-But-Verify');
    assert.ok(section, '### 3.1 Trust-But-Verify section must exist');
    assert.ok(
      section.includes('last 5 lines'),
      '"last 5 lines" must be stated inside the Trust-But-Verify section'
    );
  });

  it('A4: "no trailing prose" constraint is in the Output section of ship-builder.md', () => {
    const content = readSrc('agents/ship-builder.md');
    const section = extractSection(content, '## Output');
    assert.ok(section, '## Output section must exist in ship-builder.md');
    assert.ok(
      section.includes('no trailing prose'),
      '"no trailing prose" must appear inside the ## Output section of ship-builder.md'
    );
    // Confirm it does NOT appear outside the Output section
    const beforeOutput = content.split('## Output')[0];
    assert.ok(
      !beforeOutput.includes('no trailing prose'),
      '"no trailing prose" must not appear before the Output section (wrong location)'
    );
  });

  it('A5: "no trailing prose" constraint is in the Output section of ship-reviewer.md', () => {
    const content = readSrc('agents/ship-reviewer.md');
    const section = extractSection(content, '## Output');
    assert.ok(section, '## Output section must exist in ship-reviewer.md');
    assert.ok(
      section.includes('no trailing prose'),
      '"no trailing prose" must appear inside the ## Output section of ship-reviewer.md'
    );
    // Confirm it does NOT appear outside the Output section
    const beforeOutput = content.split('## Output')[0];
    assert.ok(
      !beforeOutput.includes('no trailing prose'),
      '"no trailing prose" must not appear before the Output section in ship-reviewer.md'
    );
  });

  it('A6: "digest is an optimization, never a gate" is in the Pre-Build Context Loading section', () => {
    const content = readSrc('skills/build/SKILL.md');
    const section = extractSection(content, '## Pre-Build Context Loading');
    assert.ok(section, 'Pre-Build Context Loading section must exist');
    assert.ok(
      section.includes('digest is an optimization, never a gate'),
      'The "never a gate" sentence must be in the Pre-Build Context Loading section'
    );
  });

});

// ---------------------------------------------------------------------------
// B. Graceful-degradation coherence
// ---------------------------------------------------------------------------

describe('build-context-isolation adversarial — B: graceful-degradation coherence', () => {

  it('B1: the exact concern string used in graceful degradation is "Key File Context unavailable — digest subagent failed"', () => {
    const content = readSrc('skills/build/SKILL.md');
    assert.ok(
      content.includes('Key File Context unavailable — digest subagent failed'),
      'The skill must include the exact concern string so builders record it consistently'
    );
  });

  it('B2: the graceful-degradation sentence specifies both consequences (empty context AND record concern)', () => {
    const content = readSrc('skills/build/SKILL.md');
    // Must instruct both: (1) proceed with empty Key File Context, (2) record a concern
    assert.ok(
      content.includes('proceed with an empty Key File Context block'),
      'Graceful degradation must explicitly say to use an empty Key File Context block'
    );
    assert.ok(
      content.includes('record a'),
      'Graceful degradation must also instruct recording a concern'
    );
  });

  it('B3: graceful-degradation sentence ends with "never stop the build" — is actionable, not vague', () => {
    const content = readSrc('skills/build/SKILL.md');
    assert.ok(
      content.includes('never stop the build'),
      'The graceful-degradation text must include "never stop the build" as an explicit prohibition'
    );
  });

  it('B4: the skill does not tell the orchestrator to stop if Explore returns nothing (no "stop" near the digest failure)', () => {
    const content = readSrc('skills/build/SKILL.md');
    const section = extractSection(content, '## Pre-Build Context Loading');
    assert.ok(section, 'Pre-Build Context Loading section must exist');
    // The word "stop" must not appear in the Pre-Build Context Loading section
    // except as part of the "never stop the build" prohibition
    const stopMatches = (section.match(/\bstop\b/gi) || []);
    // Only the "never stop the build" occurrence is acceptable
    const legitimateStop = (section.match(/never stop the build/gi) || []).length;
    assert.ok(
      stopMatches.length === legitimateStop,
      `Pre-Build Context Loading section must not contain "stop" except in "never stop the build"; found ${stopMatches.length} "stop" occurrences vs ${legitimateStop} legitimate uses`
    );
  });

});

// ---------------------------------------------------------------------------
// C. Internal consistency — builder invocation template
// ---------------------------------------------------------------------------

describe('build-context-isolation adversarial — C: internal consistency', () => {

  it('C1: the builder invocation template (Invoke Builder Agent section) contains "from Explore digest" label', () => {
    const content = readSrc('skills/build/SKILL.md');
    const section = extractSection(content, '### 2. Invoke Builder Agent');
    assert.ok(section, '### 2. Invoke Builder Agent section must exist');
    assert.ok(
      section.includes('from Explore digest'),
      'The builder-invocation template must use "from Explore digest" as the heading label'
    );
  });

  it('C2: the builder invocation template does not contain the old "pre-read by orchestrator" label', () => {
    const content = readSrc('skills/build/SKILL.md');
    // The old label must be gone from everywhere in the file
    assert.ok(
      !content.includes('pre-read by orchestrator'),
      'The old "pre-read by orchestrator" label must be completely removed from the build skill'
    );
  });

  it('C3: the "from Explore digest" label appears exactly once in the build skill (no duplicate)', () => {
    const content = readSrc('skills/build/SKILL.md');
    const occurrences = (content.match(/from Explore digest/g) || []).length;
    assert.equal(occurrences, 1, '"from Explore digest" must appear exactly once — in the builder-invocation template');
  });

  it('C4: the Pre-Build Context Loading section does not still instruct the orchestrator to Read files directly', () => {
    const content = readSrc('skills/build/SKILL.md');
    const section = extractSection(content, '## Pre-Build Context Loading');
    assert.ok(section, 'Pre-Build Context Loading section must exist');
    // The old "Read" instruction for candidate files must not be in this section
    assert.ok(
      !section.includes('Read up to'),
      'The pre-build section must not contain any "Read up to N" instruction for candidate files'
    );
  });

  it('C5: the builder-invocation prompt template references "from Explore digest" inside a fenced code block', () => {
    const content = readSrc('skills/build/SKILL.md');
    // Find the fenced block inside the Invoke Builder Agent section
    const section = extractSection(content, '### 2. Invoke Builder Agent');
    assert.ok(section, '### 2. Invoke Builder Agent section must exist');
    // The template is wrapped in backtick fences (``` ... ```)
    const fenceMatch = section.match(/```[\s\S]*?```/);
    assert.ok(fenceMatch, 'Invoke Builder Agent section must contain a fenced template block');
    assert.ok(
      fenceMatch[0].includes('from Explore digest'),
      'The "from Explore digest" label must be inside the fenced template block (not in surrounding prose)'
    );
  });

});

// ---------------------------------------------------------------------------
// D. Constraint sentence completeness
// ---------------------------------------------------------------------------

describe('build-context-isolation adversarial — D: constraint sentence completeness', () => {

  it('D1: ship-builder.md JSON-only constraint is a complete sentence (ends with "closing fence.")', () => {
    const content = readSrc('agents/ship-builder.md');
    assert.ok(
      content.includes('no trailing prose, commentary, or summary after the closing fence.'),
      'The JSON-only constraint sentence in ship-builder.md must be complete and include "after the closing fence."'
    );
  });

  it('D2: ship-reviewer.md JSON-only constraint is a complete sentence (ends with "closing fence.")', () => {
    const content = readSrc('agents/ship-reviewer.md');
    assert.ok(
      content.includes('no trailing prose, commentary, or summary after the closing fence.'),
      'The JSON-only constraint sentence in ship-reviewer.md must be complete and include "after the closing fence."'
    );
  });

  it('D3: the build_result fence tag and no-trailing-prose constraint co-occur in the same sentence in ship-builder.md', () => {
    const content = readSrc('agents/ship-builder.md');
    // Find the sentence containing the constraint
    const constraintLine = content.split('\n').find(l => l.includes('no trailing prose'));
    assert.ok(constraintLine, 'A line containing "no trailing prose" must exist in ship-builder.md');
    assert.ok(
      constraintLine.includes('build_result'),
      'The "no trailing prose" constraint must co-occur with "build_result" in the same line/sentence'
    );
  });

  it('D4: the review_result fence tag and no-trailing-prose constraint co-occur in the same sentence in ship-reviewer.md', () => {
    const content = readSrc('agents/ship-reviewer.md');
    const constraintLine = content.split('\n').find(l => l.includes('no trailing prose'));
    assert.ok(constraintLine, 'A line containing "no trailing prose" must exist in ship-reviewer.md');
    assert.ok(
      constraintLine.includes('review_result'),
      'The "no trailing prose" constraint must co-occur with "review_result" in the same line/sentence'
    );
  });

});

// ---------------------------------------------------------------------------
// E. Cross-file isolation — test-suite foolability probe
// ---------------------------------------------------------------------------

describe('build-context-isolation adversarial — E: cross-file isolation', () => {

  it('E1: "Do NOT Read the candidate file bodies" does NOT appear in agents/ship-builder.md', () => {
    const content = readSrc('agents/ship-builder.md');
    assert.ok(
      !content.includes('Do NOT Read the candidate file bodies'),
      'The pre-read prohibition must be confined to skills/build/SKILL.md, not accidentally in ship-builder.md'
    );
  });

  it('E2: "Do NOT Read the candidate file bodies" does NOT appear in agents/ship-reviewer.md', () => {
    const content = readSrc('agents/ship-reviewer.md');
    assert.ok(
      !content.includes('Do NOT Read the candidate file bodies'),
      'The pre-read prohibition must be confined to skills/build/SKILL.md, not accidentally in ship-reviewer.md'
    );
  });

  it('E3: "Decide pass/fail on the exit code alone" does NOT appear in agents/ship-builder.md', () => {
    // This instruction belongs to the orchestrator (build SKILL.md), not the builder agent
    const content = readSrc('agents/ship-builder.md');
    assert.ok(
      !content.includes('Decide pass/fail on the exit code alone'),
      'The bounded-capture instruction must not leak into ship-builder.md (it is orchestrator behaviour)'
    );
  });

  it('E4: the "build_result" and "review_result" constraints are in the correct agent files', () => {
    const builder = readSrc('agents/ship-builder.md');
    const reviewer = readSrc('agents/ship-reviewer.md');
    // The constraint about build_result must be in ship-builder.md
    assert.ok(
      builder.includes('final message must be the fenced `build_result` block only'),
      'ship-builder.md must contain the build_result final-message constraint'
    );
    // The constraint about review_result must be in ship-reviewer.md
    assert.ok(
      reviewer.includes('final message must be the fenced `review_result` block only'),
      'ship-reviewer.md must contain the review_result final-message constraint'
    );
    // Cross-check: review_result constraint must NOT be in ship-builder.md Output section
    const builderOutput = extractSection(builder, '## Output');
    assert.ok(
      !(builderOutput || '').includes('final message must be the fenced `review_result`'),
      'ship-builder.md Output section must not contain the review_result constraint'
    );
  });

});

// ---------------------------------------------------------------------------
// F. CLAUDE.md coherence
// ---------------------------------------------------------------------------

describe('build-context-isolation adversarial — F: CLAUDE.md coherence', () => {

  it('F1: CLAUDE.md documents delegated context digest in Key Concepts', () => {
    const content = readSrc('CLAUDE.md');
    assert.ok(
      content.includes('Delegated context digest'),
      'CLAUDE.md must document the delegated context digest in Key Concepts'
    );
    assert.ok(
      content.includes('Explore'),
      'CLAUDE.md Key Concepts delegated digest bullet must reference the Explore agent'
    );
  });

  it('F2: CLAUDE.md Trust-but-verify bullet mentions bounded capture', () => {
    const content = readSrc('CLAUDE.md');
    assert.ok(
      content.includes('bounded') || content.includes('5-line tail'),
      'CLAUDE.md Trust-but-verify bullet must reference bounded capture or 5-line tail'
    );
  });

  it('F3: CLAUDE.md version in Key Concepts or architecture is consistent (3.6.0 referenced in CHANGELOG)', () => {
    const changelog = readSrc('CHANGELOG.md');
    assert.ok(
      changelog.includes('3.6.0'),
      'CHANGELOG.md must include a 3.6.0 entry'
    );
  });

  it('F4: CHANGELOG.md 3.6.0 entry mentions all three changes (delegated digest, bounded capture, JSON-only)', () => {
    const content = readSrc('CHANGELOG.md');
    // Find the 3.6.0 section
    const idx = content.indexOf('## 3.6.0');
    assert.ok(idx >= 0, 'CHANGELOG.md must have a ## 3.6.0 section');
    // Extract from 3.6.0 header to the next ## header
    const section36 = content.slice(idx, content.indexOf('\n## ', idx + 1));
    assert.ok(
      section36.includes('Delegated pre-build digest') || section36.includes('delegated'),
      'CHANGELOG 3.6.0 must document the delegated digest change'
    );
    assert.ok(
      section36.includes('Bounded trust-but-verify') || section36.includes('bounded'),
      'CHANGELOG 3.6.0 must document the bounded capture change'
    );
    assert.ok(
      section36.includes('JSON-only') || section36.includes('trailing prose'),
      'CHANGELOG 3.6.0 must document the JSON-only handoff change'
    );
  });

});
