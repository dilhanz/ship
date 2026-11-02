#!/usr/bin/env node
// Ship quiet tick — marks one PLAN.md task done (status + commit) and prints
// one line. It replaces the builder's hand edit / `sed` of PLAN.md, which on a
// large plan dumped tens of thousands of characters into the builder's context
// that every later turn then re-read.
//
// PLAN.md stays the progress record: scan-features, /ship:status, the manual
// build skill, the reviewer and the go workflow's progress probe all read the
// `status="done" commit="…"` attributes this script writes, in exactly the
// form a hand edit produced.
//
// It refuses (exit 2) while any task in the explicit `depends` list is not
// done, so PLAN.md's record of ordering cannot be made to lie.
//
// Zero dependencies. At most one line of output on every path, never a stack
// trace. Exit codes: 0 done (or already done), 1 invalid input / not found /
// error, 2 refused on depends.
//
// Usage (from the repo root): node tick.cjs <feature> <task-id> <commit>

const fs = require('fs');
const path = require('path');
const { isValidSlug, isValidTaskId, parsePlan, withAnomalies, parseDepends } = require(path.join(__dirname, 'plan-parse.cjs'));

function result(ok, code, line) {
  return { ok, code, line };
}

/**
 * Rewrite one opening `<task …>` tag: status set to done, commit set or
 * replaced, every other attribute kept in place.
 *
 * @param {string} tag
 * @param {string} commit
 * @returns {string}
 */
function rewriteTag(tag, commit) {
  let out = tag;
  const statusRe = /(\s)status\s*=\s*"[^"]*"/;
  const commitRe = /(\s)commit\s*=\s*"[^"]*"/;

  const insert = (s, attr) => {
    const close = s.endsWith('/>') ? '/>' : '>';
    const head = s.slice(0, s.length - close.length).replace(/\s+$/, '');
    return `${head} ${attr}${close}`;
  };

  out = statusRe.test(out) ? out.replace(statusRe, (m, sp) => `${sp}status="done"`) : insert(out, 'status="done"');
  out = commitRe.test(out) ? out.replace(commitRe, (m, sp) => `${sp}commit="${commit}"`) : insert(out, `commit="${commit}"`);
  return out;
}

/**
 * Mark a task done in `.planning/features/{feature}/PLAN.md` under `cwd`.
 *
 * @param {{ cwd?: string, feature: string, taskId: string, commit: string }} opts
 * @returns {{ ok: boolean, code: number, line: string }}
 */
function tick(opts) {
  try {
    const o = opts || {};
    const cwd = typeof o.cwd === 'string' && o.cwd !== '' ? o.cwd : process.cwd();
    const { feature, taskId, commit } = o;

    if (!isValidSlug(feature)) return result(false, 1, `tick: invalid feature '${String(feature)}'`);
    if (!isValidTaskId(taskId)) return result(false, 1, `tick: invalid task-id '${String(taskId)}'`);
    if (typeof commit !== 'string' || !/^[0-9a-f]{4,40}$/.test(commit)) {
      return result(false, 1, `tick: invalid commit '${String(commit)}'`);
    }

    const planPath = path.join(cwd, '.planning', 'features', feature, 'PLAN.md');
    let text;
    try {
      text = fs.readFileSync(planPath, 'utf8');
    } catch (e) {
      return result(false, 1, `tick: PLAN.md not found for ${feature}`);
    }

    const { tasks, anomalies } = parsePlan(text);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return result(false, 1, withAnomalies(`tick: task ${taskId} not found in PLAN.md`, anomalies));

    const blocking = parseDepends(task.attrs.depends).filter((dep) => {
      const d = tasks.find((t) => t.id === dep);
      return !d || d.attrs.status !== 'done';
    });
    if (blocking.length > 0) {
      return result(true, 2, `tick: refused — task ${taskId} depends on ${blocking.join(',')} (not done)`);
    }

    if (task.attrs.status === 'done' && task.attrs.commit === commit) {
      return result(true, 0, `tick: task ${taskId} already done (${commit})`);
    }

    const newTag = rewriteTag(task.tag, commit);
    const updated = text.slice(0, task.tagStart) + newTag + text.slice(task.tagEnd);

    const tmp = path.join(path.dirname(planPath), `PLAN.md.tick-${process.pid}`);
    try {
      fs.writeFileSync(tmp, updated);
      fs.renameSync(tmp, planPath);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch (_) { /* best effort */ }
      throw e;
    }

    const after = parsePlan(updated).tasks;
    const done = after.filter((t) => t.attrs.status === 'done').length;
    return result(true, 0, `tick: task ${taskId} done (${commit}) — ${done}/${after.length} tasks done`);
  } catch (e) {
    const msg = String((e && e.message) || e).split('\n')[0];
    return result(false, 1, `tick: error — ${msg}`);
  }
}

module.exports = { tick, rewriteTag };

if (require.main === module) {
  let r;
  try {
    const [feature, taskId, commit] = process.argv.slice(2);
    r = tick({ cwd: process.cwd(), feature, taskId, commit });
  } catch (e) {
    r = result(false, 1, `tick: error — ${String((e && e.message) || e).split('\n')[0]}`);
  }
  process.stdout.write(String(r.line).split('\n')[0] + '\n');
  process.exitCode = r.code;
}
