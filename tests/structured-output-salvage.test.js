/**
 * Structured output + salvage retry invariants.
 *
 * Two failures were burning ~100k tokens per phase in /ship:go:
 *
 * 1. Every workflow agent was told to emit a fenced result block "as your
 *    final message — nothing after the closing fence". Inside a workflow the
 *    harness requires a StructuredOutput *tool call* as the final action, so
 *    the agent obeyed Ship, stopped at the fence, and agent() threw
 *    "subagent completed without calling StructuredOutput".
 *
 * 2. safeAgent then re-ran the entire review from scratch — paying full price
 *    for work that had already been done.
 *
 * These tests lock in the fix: the exception is documented in every agent
 * that a workflow calls with a schema, and the retry reads a durable record
 * instead of redoing the work.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

// Every agent a workflow invokes with a `schema` — these are the agents whose
// runs die when StructuredOutput is never called.
const SCHEMA_AGENTS = [
  'agents/ship-builder.md',
  'agents/ship-reviewer.md',
  'agents/ship-verifier.md',
  'agents/ship-plan-reviewer.md',
  'agents/ship-replanner.md',
];

describe('StructuredOutput instruction conflict', () => {
  it('every schema-driven agent documents the StructuredOutput exception', () => {
    for (const f of SCHEMA_AGENTS) {
      const c = readSrc(f);
      assert.ok(c.includes('StructuredOutput'),
        `${f} must tell the agent that StructuredOutput is the final action inside a workflow`);
      assert.ok(/IS your final action/.test(c),
        `${f} must state that calling StructuredOutput IS the final action, overriding the fence rule`);
    }
  });

  it('no agent still claims structured output is "enforced separately"', () => {
    // The old wording let the agent believe the fence was enough and something
    // else would handle the tool call. Nothing else does.
    for (const f of SCHEMA_AGENTS) {
      assert.ok(!readSrc(f).includes('enforced separately'),
        `${f} must not imply structured output happens without the agent calling the tool`);
    }
  });

  it('the fenced block survives for the manual (non-workflow) skill paths', () => {
    // /ship:build and /ship:plan-verify parse the fenced block; removing it
    // would break them.
    const blocks = {
      'agents/ship-builder.md': 'build_result',
      'agents/ship-reviewer.md': 'review_result',
      'agents/ship-verifier.md': 'verify_result',
      'agents/ship-plan-reviewer.md': 'plan_review_result',
      'agents/ship-replanner.md': 'replan_result',
    };
    for (const [f, tag] of Object.entries(blocks)) {
      assert.ok(readSrc(f).includes('```' + tag),
        `${f} must still show the ${tag} fenced block for the manual path`);
    }
  });
});

describe('salvage retry — reviewer', () => {
  const reviewer = () => readSrc('agents/ship-reviewer.md');

  it('reviewer can write its scratch record', () => {
    const front = reviewer().split('---')[1];
    assert.match(front, /tools:.*\bWrite\b/,
      'reviewer needs Write to persist findings before returning');
  });

  it('reviewer writes findings to the scratch file before emitting', () => {
    const c = reviewer();
    assert.ok(c.includes('.review-scratch/'),
      'reviewer must record findings under .planning/features/{name}/.review-scratch/');
    assert.ok(/write the scratch record/i.test(c),
      'writing the scratch record must come before the result is emitted');
  });

  it('reviewer checks the scratch file before re-doing the work', () => {
    const c = reviewer();
    assert.ok(/Step 0 — Salvage Check/.test(c),
      'reviewer must run a salvage check before Step 1');
    assert.ok(c.indexOf('Salvage Check') < c.indexOf('Step 1 — Trust-but-Verify'),
      'the salvage check must precede the expensive verify re-runs');
  });

  it('reviewer HARD-GATE still bans editing anything but the scratch file', () => {
    const gate = reviewer().split('<HARD-GATE>')[1].split('</HARD-GATE>')[0];
    assert.ok(/Do not modify any file/.test(gate),
      'the read-only guarantee over source must survive the new Write tool');
    assert.ok(gate.includes('.review-scratch/'),
      'the gate must name the single permitted write path');
  });
});

describe('salvage retry — verifier', () => {
  it('verifier salvages a complete VERIFY.md instead of re-verifying', () => {
    const c = readSrc('agents/ship-verifier.md');
    assert.ok(/Stage 0 — Salvage Check/.test(c),
      'verifier must check for an existing complete VERIFY.md before re-running everything');
    assert.ok(/stale/i.test(c.split('## Gate Function')[0]),
      'the salvage check must reject a stale report from an earlier build round');
  });
});

describe('salvage retry — go workflow wiring', () => {
  const wf = () => readSrc('ship/workflows/go.workflow.js');

  it('safeAgent accepts a distinct retry prompt', () => {
    const c = wf();
    assert.ok(/retryPrompt\s*=\s*null/.test(c),
      'safeAgent must support an optional retryPrompt, defaulting to none');
    assert.ok(c.includes('agent(retryPrompt || prompt, retryOpts)'),
      'the retry must use the salvage prompt when one is supplied, else the original');
  });

  it('review, re-review, and verify all pass a salvage prompt', () => {
    const c = wf();
    for (const call of ['salvageReviewPrompt(ph, reviewScope,', 'salvageReviewPrompt(ph, `${reviewScope}-rereview`,', 'salvageVerifyPrompt(verifyFull)']) {
      assert.ok(c.includes(call), `expected a salvage retry wired at: ${call}`);
    }
  });

  it('every scope the workflow can request is a name the reviewer contract defines', () => {
    // The workflow derives scopes from the phase id: `phase-{id}` /
    // `phase-{id}-rereview`, collapsing to `all` / `all-rereview` for the
    // unphased pseudo-phase `{id: 'all'}`. A scope the reviewer has no name
    // for means it writes its record somewhere the salvage lookup never
    // checks — safe, but it pays for a full review it had already done.
    assert.ok(wf().includes("ph.id === 'all' ? 'all' : `phase-${ph.id}`"),
      'the unphased pseudo-phase must map to the contract name `all`');

    const contract = readSrc('agents/ship-reviewer.md');
    for (const scope of ['phase-{id}', 'phase-{id}-rereview', 'all', 'all-rereview']) {
      assert.ok(contract.includes(`\`${scope}\``),
        `the reviewer contract must name the ${scope} scratch record`);
    }
  });

  it('the salvage prompt forbids redoing the work but allows a genuine fallback', () => {
    const c = wf();
    const prompt = c.split('const salvageReviewPrompt')[1].split('// Same principle')[0];
    assert.ok(/Do NOT re-run verify commands/.test(prompt),
      'a salvaged review must not re-run the verify commands it is salvaging');
    assert.ok(/Fall back to the full review/.test(prompt),
      'a missing scratch file must still produce a real review, not an empty pass');
    assert.ok(/empty findings array is a valid result/i.test(prompt),
      'a clean review must not be mistaken for a lost one');
  });

  it('the builder keeps its own continuation loop instead of a blind retry', () => {
    // PLAN.md is the builder's durable record; retrying it blindly is what the
    // continuation loop and progress probe already handle.
    assert.ok(/retry: false/.test(wf()),
      'the builder call site must still opt out of safeAgent retries');
  });
});

describe('precomputed diff range', () => {
  const wf = () => readSrc('ship/workflows/go.workflow.js');

  it('the workflow derives the range instead of making the reviewer do it', () => {
    const c = wf();
    assert.ok(/const diffRange = \(commits\)/.test(c),
      'go workflow must compute the phase diff range from the reported commits');
    assert.ok(c.includes('~1..HEAD'), 'the derived range must be {oldest}~1..HEAD');
    assert.ok(!/confirm their order with .git log./.test(c),
      'the reviewer must no longer be told to re-derive the range with git log');
  });

  it('both the review and re-review prompts carry a range', () => {
    const c = wf();
    assert.ok(c.includes('rangeInstruction(diffRange(commits))'),
      'the phase review must receive the derived range');
    assert.ok(c.includes('rangeInstruction(diffRange(fixCommits))'),
      'the re-review must receive a range derived from the fix commits');
  });

  it('the range instruction keeps a fallback for the cases that break it', () => {
    const c = wf();
    const instr = c.split('const rangeInstruction')[1].split('const reviewPrompt')[0];
    assert.ok(/root commit/.test(instr),
      'a phase starting at the root commit has no ~1 — the fallback must cover it');
    assert.ok(instr.includes('4b825dc642cb6eb9a060e54bf8d69288fbee4904'),
      'the root-commit fallback must diff against the empty tree');
    assert.ok(/No commits were reported/.test(instr),
      'a phase with no commits must still get working-tree review instructions');
  });

  it('the reviewer prefers a supplied range over deriving one', () => {
    const c = readSrc('agents/ship-reviewer.md');
    assert.ok(/do not spend turns re-deriving/i.test(c),
      'reviewer must use the range it is handed rather than rediscovering it');
  });

  it('the builder promises the commit order the range depends on', () => {
    const c = readSrc('agents/ship-builder.md');
    assert.ok(/`commits` must be \*\*oldest first\*\*/.test(c),
      'the derived range assumes oldest-first commits — the builder must guarantee it');
  });
});

describe('stale-scratch fingerprints', () => {
  it('build review scratch is stamped with HEAD and checked against it', () => {
    const agent = readSrc('agents/ship-reviewer.md');
    assert.ok(/git rev-parse HEAD/.test(agent),
      'the scratch record must be fingerprinted with the commit it reviewed');
    assert.ok(/different `head`|different scope or head/.test(agent + readSrc('ship/workflows/go.workflow.js')),
      'a record stamped with another HEAD must be rejected, not salvaged');
  });

  it('VERIFY.md carries a head stamp, and salvage keys staleness on it', () => {
    // The FAIL path reverts the feature to plan-verified and appends fix
    // tasks, so re-verification after a fix round always finds a *complete*
    // VERIFY.md from the previous round. Only a head stamp separates the two —
    // "Verified: {date}" does not.
    assert.ok(/\*\*Head:\*\*/.test(readSrc('ship/templates/VERIFY.md')),
      'the VERIFY.md template must reserve a line for the verified HEAD');

    const agent = readSrc('agents/ship-verifier.md');
    assert.ok(/git rev-parse HEAD/.test(agent),
      'the verifier must stamp the report with the commit it verified');

    // go.workflow.js embeds the prompt in a template literal, so its backticks
    // arrive escaped — match the wording, not the quoting.
    for (const c of [agent, readSrc('ship/workflows/go.workflow.js')]) {
      assert.ok(/no \\?`\*\*Head:\*\*\\?` line at all/.test(c),
        'an unstamped VERIFY.md predates the rule and must fall back, not salvage');
      assert.ok(/matches (that SHA|`git rev-parse HEAD`)/.test(c),
        'salvage must require the stamp to match the current HEAD');
    }
  });

  it('plan review scratch is fingerprinted on PLAN.md content, not the round', () => {
    // Round numbers repeat across re-invocations (roundOffset only shifts the
    // history label), so the round alone cannot tell a stale record apart.
    for (const f of ['agents/ship-plan-reviewer.md', 'ship/workflows/plan.workflow.js']) {
      const c = readSrc(f);
      assert.ok(c.includes('plan_hash'), `${f} must key plan-review salvage on a plan fingerprint`);
      assert.ok(/git hash-object/.test(c), `${f} must compute that fingerprint from PLAN.md content`);
    }
  });
});

describe('salvage retry — plan workflow', () => {
  const wf = () => readSrc('ship/workflows/plan.workflow.js');

  it('plan safeAgent supports a salvage prompt, like the go workflow', () => {
    const c = wf();
    assert.ok(/retryPrompt\s*=\s*null/.test(c), 'plan safeAgent must accept an optional retryPrompt');
    assert.ok(c.includes('agent(retryPrompt || prompt, retryOpts)'),
      'the plan retry must use the salvage prompt when supplied');
  });

  it('both plan-loop agents get a salvage retry', () => {
    const c = wf();
    assert.ok(c.includes('salvagePlanReviewPrompt(round, reviewFull)'),
      'the plan reviewer must retry via salvage');
    assert.ok(c.includes('salvageReplanPrompt(round, replanFull)'),
      'the replanner must retry via salvage');
  });

  it('the reviewer is told which round it is, so it can name its scratch file', () => {
    assert.ok(/Review round: \$\{round\}/.test(wf()),
      'without the round number the reviewer cannot find or write its scratch record');
  });

  it('replan salvage reads PLAN.md rather than re-revising', () => {
    const c = wf();
    const prompt = c.split('const salvageReplanPrompt')[1].split('// Convergence key')[0];
    assert.ok(/### Round \$\{round \+ roundOffset\}/.test(prompt),
      'the salvage must look for the same round heading the replanner writes');
    assert.ok(/double-apply/.test(prompt),
      'the danger of a blind replan retry is double-applied edits — say so');
    assert.ok(/escalation is not recoverable/.test(prompt),
      'a NEEDS_INPUT escalation leaves no subsection and must be re-decided, not salvaged');
  });

  it('a one-off plan-verify writes no scratch record', () => {
    // /ship:plan-verify has no loop to salvage, and a stray record there could
    // outlive the plan it reviewed.
    const c = readSrc('agents/ship-plan-reviewer.md');
    assert.ok(/only when you were given a round number/.test(c),
      'the scratch write must be scoped to loop rounds');
  });

  it('plan reviewer can write its scratch record but nothing else', () => {
    const c = readSrc('agents/ship-plan-reviewer.md');
    assert.match(c.split('---')[1], /tools:.*\bWrite\b/, 'plan reviewer needs Write for the scratch record');
    const gate = c.split('<HARD-GATE>')[1].split('</HARD-GATE>')[0];
    assert.ok(/never PLAN\.md/.test(gate),
      'the plan reviewer gaining Write must not become able to revise the plan it reviews');
    assert.ok(gate.includes('.review-scratch/'), 'the gate must name the single permitted write path');
  });

  it('replanner checks for an already-written round before revising again', () => {
    const c = readSrc('agents/ship-replanner.md');
    assert.ok(/Salvage check first/.test(c),
      'the replanner must detect its own completed round before redoing it');
  });
});

describe('salvage retry — scratch cleanup', () => {
  it('the plan loop clears its round records on terminal outcomes', () => {
    const c = readSrc('skills/go/SKILL.md');
    assert.ok(c.includes('.review-scratch/plan-round-*.json'),
      'go must clear the plan-loop scratch records when the loop ends');
    assert.ok(/except `NEEDS_INPUT`/.test(c),
      'a NEEDS_INPUT re-invocation still needs those records — it must be excluded');
  });

  it('both orchestrators clear the scratch cache once findings are persisted', () => {
    for (const f of ['skills/go/SKILL.md', 'skills/build/SKILL.md']) {
      const c = readSrc(f);
      assert.ok(c.includes('.review-scratch/'),
        `${f} must account for the reviewer's scratch cache`);
      assert.ok(/Delete `\.planning\/features\/\{name\}\/\.review-scratch\/`/.test(c),
        `${f} must delete the scratch cache so a later run cannot salvage stale findings`);
    }
  });
});
