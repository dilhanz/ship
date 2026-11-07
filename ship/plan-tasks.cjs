#!/usr/bin/env node
// Ship pending-task lister — tells the go skill which phases are still to be
// built and which tasks each holds, so the go workflow (which cannot read
// PLAN.md itself) can dispatch one builder per task.
//
// Semantics match the go skill's section 4:
//   - a phase is listed when its `<phase>` status is not `done`; its tasks are
//     its `<task>` children whose status is not `done`, in document order. A
//     pending phase with no pending tasks is still listed with `tasks: []`,
//     and the workflow builds it per-phase, as before.
//   - a flat plan (no `<phase>` elements) is one `{ id: 'all', name: 'all' }`
//     phase holding every pending task.
//   - when no phase is pending but pending tasks sit outside any phase (fix
//     tasks appended by an older verifier), they form the `all` phase.
//
// Each task carries `docsOnly` from `isDocsOnly(<files>)`: true only when every
// file is prose nothing executes. Files under `agents/` or `skills/`, and
// SKILL.md / CLAUDE.md / AGENTS.md, are prompts to models — writing them is
// judgment, not mechanics — so they never count as docs-only.
//
// Zero dependencies. The CLI prints one JSON line and always exits 0; any
// error yields `phases: []` with `warning` naming it. No process.exit().
//
// Usage (from the repo root): node plan-tasks.cjs <feature>

const fs = require('fs');
const path = require('path');
const { isValidSlug, parsePlan } = require(path.join(__dirname, 'plan-parse.cjs'));

const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc']);
const PROMPT_DIRS = new Set(['agents', 'skills']);
const PROMPT_FILES = new Set(['skill.md', 'claude.md', 'agents.md']);

/**
 * True when a task's `<files>` list is non-empty and entirely prose that
 * nothing executes.
 *
 * @param {string} files
 * @returns {boolean}
 */
function isDocsOnly(files) {
  if (typeof files !== 'string') return false;
  const entries = files.split(',').map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) return false;
  return entries.every((entry) => {
    const segments = entry.split(/[\\/]+/).filter(Boolean);
    if (segments.some((s) => PROMPT_DIRS.has(s))) return false;
    const base = segments.length > 0 ? segments[segments.length - 1] : entry;
    if (PROMPT_FILES.has(base.toLowerCase())) return false;
    return DOC_EXTENSIONS.has(path.extname(base).toLowerCase());
  });
}

function taskEntry(t) {
  return { id: t.id, name: t.name, docsOnly: isDocsOnly(t.files) };
}

/**
 * List pending phases with their pending tasks.
 *
 * @param {{ cwd?: string, feature: string }} opts
 * @returns {{ feature: string|null, phases: { id: string, name: string, tasks: { id: string, name: string, docsOnly: boolean }[] }[], warning: string|null }}
 */
function listPendingTasks(opts) {
  const o = opts || {};
  const feature = typeof o.feature === 'string' ? o.feature : null;
  try {
    const cwd = typeof o.cwd === 'string' && o.cwd !== '' ? o.cwd : process.cwd();
    if (!isValidSlug(feature)) {
      return { feature, phases: [], warning: `invalid feature '${String(o.feature)}' — a slug is one path segment` };
    }

    let text;
    try {
      text = fs.readFileSync(path.join(cwd, '.planning', 'features', feature, 'PLAN.md'), 'utf8');
    } catch (e) {
      return { feature, phases: [], warning: `PLAN.md not found for ${feature}` };
    }

    const { phases, tasks, anomalies } = parsePlan(text);
    // A malformed layout means the task list below may be missing tasks. Say
    // so: a non-null warning sends the go skill to its per-phase fallback.
    const warning = anomalies.length > 0 ? `malformed PLAN.md: ${anomalies.join('; ')}` : null;
    const pending = (t) => t.attrs.status !== 'done';

    if (phases.length === 0) {
      return { feature, phases: [{ id: 'all', name: 'all', tasks: tasks.filter(pending).map(taskEntry) }], warning };
    }

    const inside = (t, ph) => t.start > ph.start && t.end < ph.end;
    const listed = phases
      .filter((ph) => ph.attrs.status !== 'done')
      .map((ph) => ({
        id: ph.id,
        name: ph.name,
        tasks: tasks.filter((t) => inside(t, ph) && pending(t)).map(taskEntry),
      }));

    if (listed.length > 0) return { feature, phases: listed, warning };

    const orphans = tasks.filter((t) => pending(t) && !phases.some((ph) => inside(t, ph)));
    if (orphans.length > 0) {
      return { feature, phases: [{ id: 'all', name: 'all', tasks: orphans.map(taskEntry) }], warning };
    }

    return { feature, phases: [], warning };
  } catch (e) {
    return { feature, phases: [], warning: `plan-tasks failed (${String((e && e.message) || e).split('\n')[0]})` };
  }
}

module.exports = { listPendingTasks, isDocsOnly };

if (require.main === module) {
  let r;
  try {
    const feature = process.argv.slice(2).find((a) => !a.startsWith('--'));
    r = listPendingTasks({ cwd: process.cwd(), feature: feature === undefined ? null : feature });
  } catch (e) {
    r = { feature: null, phases: [], warning: `plan-tasks failed (${String((e && e.message) || e).split('\n')[0]})` };
  }
  process.stdout.write(JSON.stringify(r) + '\n');
}
