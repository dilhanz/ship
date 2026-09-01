/**
 * go-path reliability invariants (v5.11.0).
 *
 * Field data over 35 GO COMPLETE runs found three defects on the /ship:go
 * spine, all of which are contract-level and therefore assertable here:
 *
 * 1. ship-verifier ran at the lowest turn cap of the four long-running agents
 *    while carrying the largest workload, and left nothing behind when it died.
 * 2. A network outage was reported as turn-budget exhaustion, complete with
 *    advice to split tasks that did not need splitting.
 * 3. Task `depends` was authored at plan time, validated by the plan reviewer,
 *    and never read on the build path.
 *
 * Each test below fails if the change it covers is reverted.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const wf = () => readSrc('ship/workflows/go.workflow.js');

// Slice a top-level `const NAME = {...}` declaration out of the workflow by
// finding its opening line and the matching column-0 closing brace.
const schemaBlock = (src, name) => {
  const start = src.indexOf(`const ${name} = {`);
  assert.ok(start > -1, `${name} must exist in go.workflow.js`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `${name} must be a closed object literal`);
  return src.slice(start, end + 3);
};

describe('turn-cap parity across the long-running agents', () => {
  it('all four schema-driven agents carry the same maxTurns, and it is 60', () => {
    // The verifier sat at 40 while the other three ran at 60 — the agent with
    // the largest workload had the smallest budget. Assert on the *set*, not on
    // four separate literals: the point is that the parity cannot drift again.
    const agents = ['ship-verifier', 'ship-reviewer', 'ship-builder', 'ship-plan-reviewer'];
    const caps = {};
    for (const a of agents) {
      const front = readSrc(`agents/${a}.md`).split('---')[1];
      const m = /^maxTurns:\s*(\d+)$/m.exec(front);
      assert.ok(m, `agents/${a}.md must declare maxTurns in its frontmatter`);
      caps[a] = Number(m[1]);
    }
    const distinct = new Set(Object.values(caps));
    assert.equal(distinct.size, 1,
      `the four long-running agents must share one turn cap, got ${JSON.stringify(caps)}`);
    assert.equal([...distinct][0], 60,
      `the shared cap must be 60 — a real review costs ~33 turns, got ${JSON.stringify(caps)}`);
  });
});

describe('transport failures are classified apart from spent rounds', () => {
  it('the workflow bounds consecutive transport deaths at 3', () => {
    assert.match(wf(), /const MAX_TRANSPORT_RETRIES = 3\b/,
      'a sustained outage must still terminate — the cap is what stops the retry loop');
  });

  it('the transport predicate classifies real outage messages, and only those', () => {
    // Evaluate the predicate as written rather than grepping for its patterns:
    // a regex that is present but never reached would pass a grep.
    const src = wf();
    const block = src.slice(src.indexOf('const TRANSPORT_PATTERNS'), src.indexOf('let lastFailure'));
    assert.ok(block.includes('isTransportError'), 'the predicate must sit with its pattern table');
    const isTransportError = new Function(`${block}\nreturn isTransportError`)();

    for (const message of [
      'API Error: ENOTFOUND api.anthropic.com',
      'read ECONNRESET',
      'connect ETIMEDOUT 1.2.3.4:443',
      'connect ECONNREFUSED',
      'getaddrinfo EAI_AGAIN',
      'TypeError: fetch failed',
      'socket hang up',
      'API is temporarily Overloaded',
      'API error: 503 Service Unavailable',
    ]) {
      assert.equal(isTransportError(new Error(message)), true,
        `"${message}" is an outage, not a spent round`);
    }

    for (const message of [
      'subagent completed without calling StructuredOutput',
      'agent stopped at maxTurns',
      'Error: invalid schema property',
      '',
    ]) {
      assert.equal(isTransportError(new Error(message)), false,
        `"${message}" is an agent failure — classifying it as transport would refund a spent round`);
    }
  });

  it('a transport death does not consume a build round', () => {
    const src = wf();
    const branch = src.slice(src.indexOf('} else if (lastFailure && lastFailure.transport) {'),
      src.indexOf('      // No result at all'));
    assert.ok(branch.length > 0, 'buildPhase must branch on the transport classification');
    assert.match(branch, /round -= 1/,
      'a round the builder never ran must not be charged against MAX_BUILD_ROUNDS');
    assert.ok(branch.indexOf('consecutiveTransportDeaths >= MAX_TRANSPORT_RETRIES') < branch.indexOf('round -= 1'),
      'the cap must be checked before the decrement, or the loop never terminates');
    assert.match(branch, /return \{/,
      'the cap must return, not break — falling through would mislabel the outage as EXHAUSTED');
  });

  it('the exhaustion reason is derived from the cause, not hardcoded', () => {
    const src = wf();
    assert.match(src, /const endedOnTransport = !!\(lastFailure && lastFailure\.transport\)/,
      'the derivation must read the recorded cause');

    // The exhaustion exit is the place the wrong story was told: a run whose
    // agents died on the network was reported as a run whose tasks were too
    // big. Both the reason and the recommendation must branch on the cause.
    const exit = src.slice(src.indexOf("status: 'EXHAUSTED',"), src.indexOf('rounds: MAX_BUILD_ROUNDS'));
    assert.ok(exit.length > 0, 'the EXHAUSTED return must still exist');
    assert.match(exit, /reason: endedOnTransport\s*\n\s*\?/,
      'the reason must be a conditional on the classification, not one hardcoded string');
    assert.match(exit, /recommendation: endedOnTransport\s*\n\s*\?/,
      'advice to split tasks must not be given to a run that lost its connection');

    const literal = 'turn budget exhausted with tasks still pending';
    assert.equal(src.split(literal).length - 1, 1,
      'the turn-budget wording must survive exactly once');
    const branch = exit.slice(exit.indexOf('reason: endedOnTransport'), exit.indexOf('recommendation:'));
    assert.ok(branch.includes(literal),
      'and it must sit on the else-branch of that conditional');
  });

  it('a transport-ended run recommends a re-run, never a resize', () => {
    assert.match(wf(), /Re-run \/ship:go \$\{feature\} — the plan is sound/,
      'the infrastructure recommendation must say the plan is fine and the run is resumable');
  });
});

describe('INFRASTRUCTURE is a terminal status the operator actually sees', () => {
  it('the workflow stops on it like the other three terminals', () => {
    const src = wf();
    assert.match(src, /build\.status === 'INFRASTRUCTURE'/,
      "the phase loop's stop test must include INFRASTRUCTURE, or a new status is swallowed");
    assert.match(src, /status: 'INFRASTRUCTURE'/,
      'buildPhase must be able to return the status');
  });

  it('a verifier lost to the outage reports through the same rendering path', () => {
    const src = wf();
    const block = src.slice(src.indexOf('if (!verdict && lastFailure && lastFailure.transport) {'));
    assert.ok(block.length > 0, 'a null verdict caused by an outage must be classified, not reported as a crash');
    assert.match(block, /phase: \{ id: 'verify', name: 'verify' \}/,
      'the verifier outage travels as a pseudo-phase through stoppedAt');
    assert.match(block, /status: 'INFRASTRUCTURE'/, 'and carries the same terminal status');
  });

  it('the go skill renders INFRASTRUCTURE and gives the opposite advice to EXHAUSTED', () => {
    const c = readSrc('skills/go/SKILL.md');
    const start = c.indexOf('**`INFRASTRUCTURE`**');
    assert.ok(start > -1, '§6.5 must give INFRASTRUCTURE its own paragraph');
    const para = c.slice(start, c.indexOf('\n\n', start));
    assert.match(para, /\/ship:go \{name\}/, 'the recommendation is a plain re-run');
    assert.match(para, /building/, 'CONTEXT.md stays at building — the run is resumable');
    assert.match(para, /Do \*\*NOT\*\* suggest splitting tasks/,
      "EXHAUSTED's advice must be explicitly ruled out here");
    assert.ok(!/suggest splitting its remaining tasks|split the remaining tasks into smaller/i.test(para),
      'the paragraph must not itself recommend resizing tasks');
    assert.match(c, /`CHECKPOINT`, `NEEDS_CONTEXT`, `EXHAUSTED`, or `INFRASTRUCTURE`/,
      'the stoppedAt branch must enumerate the new status alongside the other three');
  });

  it('the headless contract names infrastructure as an outcome', () => {
    const c = readSrc('ship/docs/headless.md');
    assert.match(c, /^\| `infrastructure` \|/m, 'the vocabulary table must carry the word');
    const row = /^\| `infrastructure` \|.*$/m.exec(c)[0];
    assert.match(row, /`building`/, 'the row must record the status left behind');
    assert.match(row, /exhausted/,
      'the row must distinguish itself from exhausted, which is the word that misled the team');
    assert.match(c, /exactly one of these 11 outcomes/,
      'the count must move with the vocabulary');
    assert.ok(!/these 12 outcomes/.test(c),
      'a stale count leaves the contract of record disagreeing with itself');
  });
});

describe('depends is enforced on the build path', () => {
  it('the builder refuses to mark a task done ahead of its dependency', () => {
    const c = readSrc('agents/ship-builder.md');
    assert.match(c, /Never set `status="done"` on a task while any task in its `depends` list is still pending/,
      'the refusal must be stated as a rule in the execution loop');
    assert.match(c, /`depends="\.\.\."` attribute/,
      'step 1 must tell the builder to read the attribute in the first place');
  });

  it('an unmet dependency is a deviation, not a silent skip', () => {
    const c = readSrc('agents/ship-builder.md');
    const section = c.slice(c.indexOf('Unmet `depends` is a deviation'), c.indexOf('## Turn Budget'));
    assert.ok(section.length > 0, 'the handling must be spelled out, not left to judgment');
    assert.match(section, /Rule 1/, 'a reorderable dependency is handled under the deviation rules');
    assert.match(section, /CHECKPOINT/, 'an out-of-scope dependency terminates rather than being worked around');
    assert.match(section, /forbidden/,
      'skipping quietly or marking it done anyway must be named as forbidden');
  });

  it('the progress probe reports ordering corruption it can see', () => {
    const src = wf();
    const schema = schemaBlock(src, 'PROGRESS_SCHEMA');
    assert.match(schema, /out_of_order: \{ type: 'array', items: \{ type: 'string' \} \}/,
      'PROGRESS_SCHEMA must declare out_of_order');
    const required = /required: \[([^\]]*)\]/.exec(schema)[1];
    assert.ok(!required.includes('out_of_order'),
      'out_of_order must stay optional — a probe result without it must still validate');
    assert.match(src, /- out_of_order —/, 'progressPrompt must ask the probe for it');
    assert.match(src, /PLAN\.md ordering violated/,
      'a non-empty out_of_order must reach the phase concerns the go skill renders');
  });
});

describe('salvage events are reported, not just performed', () => {
  it('the workflow returns them as a fifth field', () => {
    assert.match(wf(), /return \{ feature, stoppedAt, completed, verdict, salvageEvents \}/,
      'the events must reach the go skill through the workflow result');
    assert.match(wf(), /salvageEvents\.push\(\{ agent: labelDisplay, record: salvageRecord, outcome \}\)/,
      'safeAgent must record one event per salvage retry, naming the agent and the record');
  });

  it('both result schemas accept an optional salvaged field', () => {
    const src = wf();
    for (const name of ['REVIEW_SCHEMA', 'VERIFY_SCHEMA']) {
      const block = schemaBlock(src, name);
      assert.match(block, /salvaged: \{ enum: \['adopted', 'rejected'\] \}/,
        `${name} must declare salvaged — additionalProperties is false, so an undeclared field is rejected outright`);
      const required = /required: \[([^\]]*)\]/.exec(block)[1];
      assert.ok(!required.includes('salvaged'),
        `${name} must not require salvaged — that would break every non-salvage result`);
    }
  });

  it('the GO COMPLETE report renders the events', () => {
    const c = readSrc('skills/go/SKILL.md');
    assert.match(c, /\[If salvageEvents is non-empty:\] Salvage events:/,
      'the report must carry a conditional salvage-events block');
    assert.match(c, /\{adopted \| rejected \| unknown \| no result\}/,
      'each event must name its outcome');
    assert.match(c, /\{ feature, stoppedAt, completed, verdict, salvageEvents \}/,
      'every description of the workflow return shape must include the new field');
  });
});

describe('the go workflow still parses', () => {
  it('node --check passes on go.workflow.js', () => {
    const r = spawnSync(process.execPath, ['--check', path.join(repoRoot, 'ship/workflows/go.workflow.js')], { encoding: 'utf8' });
    assert.equal(r.status, 0, `go.workflow.js must parse: ${r.stderr}`);
  });
});
