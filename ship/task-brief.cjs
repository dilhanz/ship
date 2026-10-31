#!/usr/bin/env node
// Ship task brief — extracts everything one task's builder needs into a single
// file, so a per-task builder never reads the whole PLAN.md or CONTEXT.md.
//
// The brief has exactly four parts, in this order:
//   1. the task's own `<task …>…</task>` XML, verbatim
//   2. CONTEXT.md's "## Decisions" and "## Scope" section bodies, verbatim
//   3. the tasks it depends on — status, commit, files, and `git show --stat`
//   4. the repo verify checklist's bullets and Build: line
// Nothing else: no exploration summary, no acceptance criteria, no other tasks.
//
// Dependencies are the explicit `depends` list, else the task immediately
// before this one in PLAN.md document order, else none. The brief is generated
// at dispatch time, so it sees commits that earlier tasks in the same run just
// ticked.
//
// Zero dependencies. One line of output: the brief's repo-relative path on
// success, `task-brief: {reason}` with exit 1 on failure (nothing written).
//
// Usage (from the repo root): node task-brief.cjs <feature> <task-id>

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { isValidSlug, isValidTaskId, parseTasks, parseDepends } = require(path.join(__dirname, 'plan-parse.cjs'));

const STAT_CAP = 40;

function fail(line) {
  return { ok: false, code: 1, path: null, content: null, line };
}

/**
 * Body of a `## {name}` section: from the line after the heading to the next
 * `## ` heading or EOF, trimmed. Null when the section is absent.
 *
 * @param {string} text
 * @param {string} name
 * @returns {string|null}
 */
function sectionBody(text, name) {
  const lines = String(text).split('\n');
  const heading = `## ${name}`;
  const i = lines.findIndex((l) => l.replace(/\r$/, '').trimEnd() === heading);
  if (i === -1) return null;
  let j = i + 1;
  while (j < lines.length && !/^## /.test(lines[j])) j++;
  return lines.slice(i + 1, j).join('\n').trim();
}

/** `git show --stat` for a commit, indented and capped; never throws. */
function commitStat(cwd, commit) {
  // The commit comes from a PLAN.md attribute; only a hex hash reaches git, so
  // a hand-edited value can never be read as an option.
  if (!/^[0-9a-f]{4,40}$/.test(commit)) return `(git show skipped: '${commit}' is not a commit hash)`;
  try {
    const out = execFileSync('git', ['show', '--stat', '--format=%s', commit, '--'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
    const lines = out.replace(/\s+$/, '').split('\n');
    const capped = lines.length > STAT_CAP ? lines.slice(0, STAT_CAP).concat(['… (truncated)']) : lines;
    return capped.map((l) => `    ${l}`).join('\n');
  } catch (e) {
    const stderr = e && e.stderr ? String(e.stderr) : '';
    const first = (stderr.trim() || String((e && e.message) || e)).split('\n')[0];
    return `(git show failed: ${first})`;
  }
}

/**
 * Build (and write) the brief for one task.
 *
 * @param {{ cwd?: string, feature: string, taskId: string }} opts
 * @returns {{ ok: boolean, code: number, path: string|null, content: string|null, line: string }}
 */
function buildBrief(opts) {
  try {
    const o = opts || {};
    const cwd = typeof o.cwd === 'string' && o.cwd !== '' ? o.cwd : process.cwd();
    const { feature, taskId } = o;

    if (!isValidSlug(feature)) return fail(`task-brief: invalid feature '${String(feature)}'`);
    if (!isValidTaskId(taskId)) return fail(`task-brief: invalid task-id '${String(taskId)}'`);

    const featDir = path.join(cwd, '.planning', 'features', feature);
    let plan;
    try {
      plan = fs.readFileSync(path.join(featDir, 'PLAN.md'), 'utf8');
    } catch (e) {
      return fail(`task-brief: PLAN.md not found for ${feature}`);
    }

    const tasks = parseTasks(plan);
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return fail(`task-brief: task ${taskId} not found in PLAN.md`);
    const task = tasks[idx];

    let context;
    try {
      context = fs.readFileSync(path.join(featDir, 'CONTEXT.md'), 'utf8');
    } catch (e) {
      return fail(`task-brief: CONTEXT.md not found for ${feature}`);
    }

    const decisions = sectionBody(context, 'Decisions');
    const scope = sectionBody(context, 'Scope');

    const explicit = parseDepends(task.attrs.depends);
    let depIds;
    if (explicit.length > 0) depIds = explicit;
    else if (idx > 0) depIds = [tasks[idx - 1].id];
    else depIds = [];

    const depBlocks = depIds.map((id) => {
      const d = tasks.find((t) => t.id === id);
      if (!d) return `### Task ${id} — (not found in PLAN.md)`;
      const commit = d.attrs.commit || '';
      const lines = [
        `### Task ${d.id} — ${d.name}`,
        `Status: ${d.attrs.status || 'unknown'} · Commit: ${commit || 'none'}`,
        `Files: ${d.files}`,
      ];
      if (commit) lines.push('', commitStat(cwd, commit));
      return lines.join('\n');
    });

    let checklist;
    try {
      const raw = fs.readFileSync(path.join(cwd, '.planning', 'verify-checklist.md'), 'utf8');
      const picked = raw
        .split('\n')
        .map((l) => l.replace(/\r$/, ''))
        .filter((l) => {
          const t = l.trim();
          return t.startsWith('- ') || t.startsWith('* ') || l.startsWith('Build:');
        });
      checklist = picked.length > 0 ? picked.join('\n') : '(.planning/verify-checklist.md has no bullets)';
    } catch (e) {
      checklist = 'No repo checklist (.planning/verify-checklist.md is absent).';
    }

    const content = [
      `# Task ${task.id} brief — ${feature}`,
      '',
      '## Task',
      '',
      task.xml,
      '',
      '## Decisions and Scope',
      '',
      decisions !== null ? decisions : '(CONTEXT.md has no Decisions section)',
      '',
      scope !== null ? scope : '(CONTEXT.md has no Scope section)',
      '',
      '## Dependencies',
      '',
      depBlocks.length > 0 ? depBlocks.join('\n\n') : 'None — this task depends on nothing earlier.',
      '',
      '## Verify checklist',
      '',
      checklist,
      '',
    ].join('\n');

    const rel = path.posix.join('.planning', 'features', feature, '.review-scratch', 'briefs', `task-${task.id}.md`);
    const abs = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);

    return { ok: true, code: 0, path: rel, content, line: rel };
  } catch (e) {
    return fail(`task-brief: error — ${String((e && e.message) || e).split('\n')[0]}`);
  }
}

module.exports = { buildBrief, sectionBody };

if (require.main === module) {
  let r;
  try {
    const [feature, taskId] = process.argv.slice(2);
    r = buildBrief({ cwd: process.cwd(), feature, taskId });
  } catch (e) {
    r = fail(`task-brief: error — ${String((e && e.message) || e).split('\n')[0]}`);
  }
  process.stdout.write(String(r.line).split('\n')[0] + '\n');
  process.exitCode = r.code;
}
