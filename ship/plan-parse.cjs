#!/usr/bin/env node
// Ship PLAN.md parser — the one place that knows how `<phase>` and `<task>`
// elements are laid out in a feature's PLAN.md. Shared by tick.cjs,
// task-brief.cjs and plan-tasks.cjs so they cannot disagree about which task
// is which.
//
// Tags are recognised only at line starts. A plan's prose routinely mentions
// `<task …>` or `</task>` inline (a task's own action may describe the format),
// and an unanchored regex would open or close a task in the middle of a
// sentence and truncate it. An opening tag is a line matching
// `^\s*<task\b[^>]*>`; it closes at the first later line that is exactly
// `</task>` (surrounding whitespace allowed). Phases work the same way. While
// inside a task, phase and task tag lines are ignored — only `</task>` ends it.
//
// Ids are compared as strings after parsing and are never interpolated into a
// RegExp, so id "1" can never match id "10".
//
// A closing tag that is not alone on its line (`<verify>x</verify></task>`) is
// not recognised, so that task stays open and swallows the next one. Rather
// than guess, `parsePlan` reports every such shape as an anomaly: a task or
// phase still open at end of file, a line-start `<task …>` opener seen while a
// task is open, and a `<phase …>` opener seen while a phase is open. Consumers
// must surface anomalies (plan-tasks returns them as its `warning`, which
// sends the go skill to its per-phase fallback; tick and task-brief append
// them to "not found") rather than act on a silently truncated task list.
//
// Zero dependencies. Pure functions over a string: no I/O, nothing throws on
// odd input — an unclosed task is not returned, it is reported.

const TASK_OPEN = /^\s*<task\b[^>]*>/;
const TASK_CLOSE = /^\s*<\/task>\s*$/;
const PHASE_OPEN = /^\s*<phase\b[^>]*>/;
const PHASE_CLOSE = /^\s*<\/phase>\s*$/;

/** A slug is one path segment: non-empty, no separators, no `..`. */
function isValidSlug(slug) {
  if (typeof slug !== 'string') return false;
  if (slug.trim() === '') return false;
  if (slug.includes('/') || slug.includes('\\') || slug.includes('..')) return false;
  return true;
}

/** A task id is a short token: letters, digits, dot, underscore, dash. */
function isValidTaskId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9._-]+$/.test(id);
}

/**
 * Parse `key="value"` attributes out of an opening tag, in source order.
 *
 * @param {string} tag
 * @returns {Record<string, string>}
 */
function parseAttrs(tag) {
  const attrs = {};
  const re = /([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(tag)) !== null) {
    if (!Object.prototype.hasOwnProperty.call(attrs, m[1])) attrs[m[1]] = m[2];
  }
  return attrs;
}

/** Text of the first `<tag>…</tag>` inside `xml`, trimmed, or ''. */
function innerText(xml, tag) {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const i = xml.indexOf(open);
  if (i === -1) return '';
  const j = xml.indexOf(close, i + open.length);
  if (j === -1) return '';
  return xml.slice(i + open.length, j).trim();
}

/**
 * Split text into lines with their character offsets. `end` excludes the
 * line terminator.
 */
function lines(text) {
  const out = [];
  let pos = 0;
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    out.push({ text: text.slice(pos, end), start: pos, end });
    if (nl === -1) break;
    pos = nl + 1;
  }
  return out;
}

/**
 * Walk the plan once, collecting phases and tasks.
 *
 * @param {string} text
 */
function walk(text) {
  const src = typeof text === 'string' ? text : '';
  const phases = [];
  const tasks = [];
  const anomalies = [];
  let phase = null; // { attrs, start, tag, lineNo }
  let task = null; // { attrs, start, tag, tagStart, tagEnd, lineNo }
  const label = (attrs) => (attrs.id !== undefined ? String(attrs.id) : '(no id)');

  let lineNo = 0;
  for (const line of lines(src)) {
    lineNo += 1;
    const body = line.text.replace(/\r$/, '');

    if (task) {
      const inner = body.match(TASK_OPEN);
      if (inner) {
        anomalies.push(
          `line ${lineNo}: task ${label(parseAttrs(inner[0]))} opens inside task ${label(task.attrs)} (opened line ${task.lineNo}) — a closing \`</task>\` not alone on its line?`
        );
      }
      if (TASK_CLOSE.test(body)) {
        const end = line.start + body.length;
        const xml = src.slice(task.start, end);
        tasks.push({
          id: task.attrs.id !== undefined ? String(task.attrs.id) : '',
          attrs: task.attrs,
          name: innerText(xml, 'name'),
          files: innerText(xml, 'files'),
          xml,
          start: task.start,
          end,
          tag: task.tag,
          tagStart: task.tagStart,
          tagEnd: task.tagEnd,
          phaseId: phase ? (phase.attrs.id !== undefined ? String(phase.attrs.id) : '') : null,
        });
        task = null;
      }
      continue;
    }

    const t = body.match(TASK_OPEN);
    if (t) {
      const lead = t[0].length - t[0].trimStart().length;
      const tagStart = line.start + lead;
      const tag = t[0].trimStart();
      task = { attrs: parseAttrs(tag), start: tagStart, tag, tagStart, tagEnd: tagStart + tag.length, lineNo };
      // A one-line task (`<task …>…</task>` with the close on the same line
      // and nothing after it) is not a layout Ship plans use; it stays open
      // until a `</task>` line, like every other task.
      continue;
    }

    const p = body.match(PHASE_OPEN);
    if (p) {
      const lead = p[0].length - p[0].trimStart().length;
      const tag = p[0].trimStart();
      const attrs = parseAttrs(tag);
      if (phase) {
        anomalies.push(
          `line ${lineNo}: phase ${label(attrs)} opens while phase ${label(phase.attrs)} (opened line ${phase.lineNo}) is still open`
        );
      }
      phase = { attrs, start: line.start + lead, tag, lineNo };
      continue;
    }

    if (phase && PHASE_CLOSE.test(body)) {
      const end = line.start + body.length;
      phases.push({
        id: phase.attrs.id !== undefined ? String(phase.attrs.id) : '',
        attrs: phase.attrs,
        name: phase.attrs.name !== undefined ? phase.attrs.name : '',
        xml: src.slice(phase.start, end),
        start: phase.start,
        end,
        tag: phase.tag,
      });
      phase = null;
    }
  }

  if (task) anomalies.push(`task ${label(task.attrs)} (line ${task.lineNo}) is never closed by a \`</task>\` line`);
  if (phase) anomalies.push(`phase ${label(phase.attrs)} (line ${phase.lineNo}) is never closed by a \`</phase>\` line`);

  return { phases, tasks, anomalies };
}

/**
 * Phases, tasks and layout anomalies in one walk.
 *
 * @param {string} text
 * @returns {{ phases: object[], tasks: object[], anomalies: string[] }}
 */
function parsePlan(text) {
  return walk(text);
}

/**
 * Append a plan's anomalies to a one-line message, or return it unchanged.
 *
 * @param {string} message
 * @param {string[]} anomalies
 * @returns {string}
 */
function withAnomalies(message, anomalies) {
  if (!Array.isArray(anomalies) || anomalies.length === 0) return message;
  return `${message} — malformed PLAN.md: ${anomalies.join('; ')}`;
}

/**
 * Every closed `<task>` in document order.
 *
 * @param {string} text
 * @returns {{ id: string, attrs: Record<string,string>, name: string, files: string, xml: string, start: number, end: number, tag: string, tagStart: number, tagEnd: number, phaseId: string|null }[]}
 */
function parseTasks(text) {
  return walk(text).tasks;
}

/**
 * Every closed `<phase>` in document order.
 *
 * @param {string} text
 * @returns {{ id: string, attrs: Record<string,string>, name: string, xml: string, start: number, end: number, tag: string }[]}
 */
function parsePhases(text) {
  return walk(text).phases;
}

/** Comma-separated `depends` attribute → trimmed ids, empties dropped. */
function parseDepends(value) {
  if (typeof value !== 'string') return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

module.exports = {
  isValidSlug,
  isValidTaskId,
  parseAttrs,
  parsePlan,
  withAnomalies,
  parseTasks,
  parsePhases,
  parseDepends,
};
