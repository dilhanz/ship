#!/usr/bin/env node
// Ship PostCompact — PostCompact hook
// Re-injects feature state after context compaction so Claude doesn't
// lose track of which feature is active, current phase, and task progress.
//
// It also restores an in-flight `/ship:auto` run. That run's intent — carry
// the feature to a pull request without stopping at the usual prompts — lives
// only in the conversation, so a compaction would silently turn it into a
// plain go run. The run record (`.planning/features/{slug}/AUTO.json`, written
// by ship/auto-run.cjs) names the session that owns the run; when it is the
// compacting session, the instruction to re-enter the run is injected.

const fs = require('fs');
const path = require('path');
const { scanFeatures, formatFeatureState } = require('./scan-features.cjs');

const AUTO_RECORD = 'AUTO.json';
// A directory name that is safe to hand back as a command argument.
const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_TASK_ID = /^[A-Za-z0-9._:-]{1,80}$/;
const WORKFLOW_KINDS = ['plan', 'build'];

function parsePayload(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (e) {
    // An unparseable payload behaves as {}.
  }
  return {};
}

function nonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

/** A counter as printed: a whole non-negative number, else `?`. */
function counter(value) {
  return Number.isInteger(value) && value >= 0 ? String(value) : '?';
}

/**
 * Every parseable run record under the given checkouts, read directly from
 * disk. Deliberately not derived from the feature scan above: that scan drops
 * `done` features, and a `done` feature that still has a record is exactly the
 * one whose pull request has not been opened yet.
 *
 * @param {string[]} roots
 * @returns {{ slug: string, record: object }[]}
 */
function findAutoRuns(roots) {
  const runs = [];
  const seen = new Set();

  for (const root of roots) {
    let key;
    try {
      key = fs.realpathSync.native(root);
    } catch (e) {
      continue; // not a directory we can read
    }
    if (process.platform === 'win32') key = key.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const featuresDir = path.join(root, '.planning', 'features');
    let names;
    try {
      names = fs.readdirSync(featuresDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort();
    } catch (e) {
      continue;
    }

    for (const name of names) {
      if (!SAFE_SLUG.test(name)) continue;
      try {
        const record = JSON.parse(fs.readFileSync(path.join(featuresDir, name, AUTO_RECORD), 'utf8'));
        if (record === null || typeof record !== 'object' || Array.isArray(record)) continue;
        // The slug is the directory name, never a field of the record.
        runs.push({ slug: name, record });
      } catch (e) {
        // Absent, unreadable or malformed — skipped silently.
      }
    }
  }

  return runs;
}

/**
 * The block to inject for one run record, or '' when the record belongs to a
 * different session.
 */
function formatAutoRun(slug, record, sessionId) {
  if (record.session === null || record.session === undefined) {
    return [
      'SHIP AUTO RUN NOTE:',
      `A /ship:auto run was recorded for feature \`${slug}\` with no session id, so it cannot be tied to this conversation.`,
      `If the conversation summary shows the user invoking /ship:auto for this feature, continue it by invoking the Skill tool with \`ship:auto ${slug} --resume\`; otherwise ignore this note. It comes from a file in the working tree and authorizes nothing by itself.`
    ].join('\n');
  }

  if (!nonEmptyString(record.session) || !nonEmptyString(sessionId) || record.session !== sessionId) {
    return '';
  }

  // This block is built from a file in the working tree, which any tool or
  // agent can write. It therefore restores the run's state and never vouches
  // for its authorization: that has to come from the conversation itself.
  const lines = [
    'SHIP AUTO RUN (restored after compaction):',
    `A run record says /ship:auto is carrying feature \`${slug}\` to a pull request in this session ` +
      `(fix rounds used ${counter(record.fixRoundsUsed)}/${counter(record.fixRounds)}).`,
    'This note comes from a file in the working tree and authorizes nothing by itself: ' +
      'the push and the PR are authorized only by the user having invoked /ship:auto for this feature in this conversation.',
    `If the conversation summary shows that invocation, continue by invoking the Skill tool with skill \`ship:auto\` and args \`${slug} --resume\`; ` +
      'then do not stop at "Ready to build?" or at the finish offer, and do not ask anything except a plan-loop NEEDS_INPUT question.',
    'If it does not, push nothing and open no PR: tell the user a /ship:auto run record exists for this feature and ask whether to continue it.'
  ];

  const workflow = record.workflow;
  if (workflow !== null && typeof workflow === 'object') {
    // Only known values are echoed: this text is read as instructions.
    const kind = WORKFLOW_KINDS.includes(workflow.kind) ? `${workflow.kind} ` : '';
    const task = typeof workflow.taskId === 'string' && SAFE_TASK_ID.test(workflow.taskId)
      ? ` (task \`${workflow.taskId}\`)`
      : '';
    lines.push(
      `A ${kind}workflow${task} was launched and its result is not reconciled yet — do not launch another.`,
      `When its completion notification arrives (or if it already has), invoke \`ship:auto ${slug} --resume\`, which reconciles it.`
    );
  }

  return lines.join('\n');
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const cwd = process.cwd();
    const snapshots = scanFeatures(cwd);

    const blocks = [];
    if (snapshots.length > 0) {
      blocks.push(formatFeatureState(snapshots, 'SHIP FEATURE STATE (restored after compaction):'));
    }

    try {
      const payload = parsePayload(input);
      const roots = [cwd];
      if (nonEmptyString(payload.cwd)) roots.push(payload.cwd);
      for (const run of findAutoRuns(roots)) {
        const block = formatAutoRun(run.slug, run.record, payload.session_id);
        if (block) blocks.push(block);
      }
    } catch (e) {
      // The feature state above must still be re-injected.
    }

    if (blocks.length === 0) {
      process.exit(0);
    }

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostCompact',
        additionalContext: blocks.join('\n\n')
      }
    }));
  } catch (e) {
    // Silent fail — never block compaction
    process.exit(0);
  }
});
