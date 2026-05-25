const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
function readSrc(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

describe('pipeline-rigor surface', () => {
  it('CLAUDE.md documents qa-failed status transition', () => {
    const content = readSrc('CLAUDE.md');
    assert.ok(content.includes('qa-failed'), 'CLAUDE.md should contain qa-failed');
    assert.ok(content.includes('rebuild via /ship:build'), 'CLAUDE.md should contain rebuild via /ship:build');
  });

  it('skills/qa/SKILL.md sets status to qa-failed on FAIL', () => {
    const content = readSrc('skills/qa/SKILL.md');
    assert.ok(content.includes('status: qa-failed'), 'qa skill should set status: qa-failed');
    // Sanity check: the old plan-verified rollback must not appear as a status-set action
    assert.ok(!content.includes('status: plan-verified'), 'qa skill must not set status: plan-verified');
  });

  it('skills/resume/SKILL.md routes qa-failed to /ship:build', () => {
    const content = readSrc('skills/resume/SKILL.md');
    assert.ok(content.includes('qa-failed'), 'resume skill should reference qa-failed');
    assert.ok(content.includes('/ship:build'), 'resume skill should route qa-failed to /ship:build');
  });

  it('skills/status/SKILL.md displays qa-failed first-class', () => {
    const content = readSrc('skills/status/SKILL.md');
    assert.ok(content.includes('qa-failed'), 'status skill should reference qa-failed');
    assert.ok(content.includes('/ship:build'), 'status skill should mention /ship:build for qa-failed');
    assert.ok(content.includes('fix bugs found by QA'), 'status skill should describe the qa-failed next step');
  });

  it('ship/workflows/go.md handles qa-failed', () => {
    const content = readSrc('ship/workflows/go.md');
    assert.ok(content.includes('qa-failed'), 'go workflow should reference qa-failed');
    assert.ok(
      content.includes('status set to `qa-failed`') || content.includes("status set to 'qa-failed'") || content.includes('status set to qa-failed'),
      'go workflow QA-handling block should say status set to qa-failed'
    );
  });

  it('agents/ship-brainstormer.md has NFR probe with infra signal detection', () => {
    const content = readSrc('agents/ship-brainstormer.md');
    assert.ok(content.includes('INFRA_DETECTED'), 'brainstormer should have INFRA_DETECTED flag');
    assert.ok(content.includes('Dockerfile'), 'brainstormer should detect Dockerfile signal');
    assert.ok(content.includes('kubernetes'), 'brainstormer should detect kubernetes signal');
    assert.ok(content.includes('NFR Probing'), 'brainstormer should have NFR Probing section');
    assert.ok(content.includes('package.json'), 'brainstormer should mention package.json signal');
    assert.ok(
      content.includes("This is just a library / CLI, NFRs don't apply"),
      'brainstormer rationalization table should include the library/CLI NFR rationalization'
    );
  });

  it('agents/ship-qa.md uses git merge-base for diff', () => {
    const content = readSrc('agents/ship-qa.md');
    assert.ok(content.includes('git merge-base HEAD main'), 'qa agent should use git merge-base HEAD main');
    assert.ok(content.includes('fall back to'), 'qa agent should describe fallback behaviour');
    assert.ok(content.includes('Reviewed files (from git diff)'), 'qa agent should require Reviewed files section in QA.md');
  });

  it('agents/ship-verifier.md has INCONCLUSIVE verdict logic', () => {
    const content = readSrc('agents/ship-verifier.md');
    assert.ok(content.includes('INCONCLUSIVE'), 'verifier should reference INCONCLUSIVE verdict');
    assert.ok(content.includes('criteria_verdicts'), 'verifier JSON schema should include criteria_verdicts');
    assert.ok(content.includes('criteria_inconclusive'), 'verifier JSON schema should include criteria_inconclusive');
    assert.ok(content.includes('QA.md exists'), 'verifier should describe QA.md exists path');
    // Forbidden Response phrase
    assert.ok(
      content.includes("I'll mark this PASS because the file exists") ||
      content.includes('mark this PASS because the file exists'),
      'verifier Forbidden Responses should include file-existence PASS warning'
    );
    // Rationalization table row about --accept-inconclusive
    assert.ok(
      content.includes('--accept-inconclusive'),
      'verifier rationalization table should reference --accept-inconclusive'
    );
  });

  it('ship/templates/VERIFY.md supports INCONCLUSIVE + override section', () => {
    const content = readSrc('ship/templates/VERIFY.md');
    // INCONCLUSIVE in frontmatter status enum
    assert.ok(content.includes('INCONCLUSIVE'), 'VERIFY.md template should include INCONCLUSIVE');
    // Verdict column header in Stage 1 table
    assert.ok(content.includes('| Verdict |'), 'VERIFY.md template Stage 1 table should use | Verdict | header');
    // Override section
    assert.ok(content.includes('## Inconclusive Override'), 'VERIFY.md template should include ## Inconclusive Override section');
  });

  it('skills/finish/SKILL.md parses --accept-inconclusive', () => {
    const content = readSrc('skills/finish/SKILL.md');
    assert.ok(content.includes('ACCEPT_INCONCLUSIVE'), 'finish skill should define ACCEPT_INCONCLUSIVE variable');
    assert.ok(content.includes('--accept-inconclusive'), 'finish skill should reference --accept-inconclusive flag');
    assert.ok(content.includes('git config user.email'), 'finish skill should record operator via git config user.email');
    // Error message about needing a quoted reason
    assert.ok(
      content.includes('requires a non-empty reason in quotes') ||
      content.includes('non-empty reason'),
      'finish skill should describe the error when reason is missing'
    );
  });

  it('skills/help/SKILL.md documents new behaviour', () => {
    const content = readSrc('skills/help/SKILL.md');
    assert.ok(content.includes('INCONCLUSIVE'), 'help skill should document INCONCLUSIVE concept');
    assert.ok(content.includes('--accept-inconclusive'), 'help skill should document --accept-inconclusive override flag');
    assert.ok(content.includes('qa-failed'), 'help skill should document qa-failed status');
  });
});
