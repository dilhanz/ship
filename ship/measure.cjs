#!/usr/bin/env node
// Ship measure — per-agent cost of one or more Claude Code sessions, read from
// their transcripts. It is the before/after measure for the build context
// diet: turns, peak context, re-read (cache read) tokens, output tokens and an
// estimated dollar cost for the main session and every subagent it spawned,
// workflow agents included.
//
// Transcript layout:
//   {projectsDir}/{project}/{sessionId}.jsonl                       main session
//   {projectsDir}/{project}/{sessionId}/subagents/**/agent-*.jsonl  subagents
//   ... agent-{id}.meta.json beside each one carries `description` (the
//   agent() label) and `agentType`.
//
// Zero dependencies. Unparseable lines are skipped, never fatal.
//
// Usage: node measure.cjs <session-id> [<session-id>…] [--projects-dir <dir>] [--json]

const fs = require('fs');
const os = require('os');
const path = require('path');

// $ per MTok. Source: the claude-api skill, cached 2026-10-06. Cache writes use
// the standard multipliers (1.25x input for 5m, 2x input for 1h); Haiku's cache
// read is assumed at 0.1x input. Matched by model-id prefix.
const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.20, cacheWrite5m: 5, cacheWrite1h: 8 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.20, cacheWrite5m: 2.5, cacheWrite1h: 4 },
  'claude-haiku-5-5': { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.20 },
};
const FALLBACK_MODEL = 'claude-opus-5-5';

const SESSION_ID = /^[A-Za-z0-9-]+$/;

function defaultProjectsDir() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

function priceFor(model) {
  const key = Object.keys(PRICES).find(k => typeof model === 'string' && model.startsWith(k));
  return key ? { price: PRICES[key], known: true } : { price: PRICES[FALLBACK_MODEL], known: false };
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function findAgentFiles(dir, out) {
  for (const ent of safeReaddir(dir)) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) findAgentFiles(full, out);
    else if (ent.isFile() && /^agent-.*\.jsonl$/.test(ent.name)) out.push(full);
  }
  return out;
}

function labelFor(file) {
  const stem = path.basename(file, '.jsonl');
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(path.dirname(file), `${stem}.meta.json`), 'utf8'));
    if (meta && typeof meta.description === 'string' && meta.description) return meta.description;
    if (meta && typeof meta.agentType === 'string' && meta.agentType) return meta.agentType;
  } catch {
    // no meta, or unreadable — fall through to the stem
  }
  return stem;
}

function discover(projectsDir, id) {
  const found = [];
  for (const proj of safeReaddir(projectsDir)) {
    if (!proj.isDirectory()) continue;
    const projDir = path.join(projectsDir, proj.name);
    const main = path.join(projDir, `${id}.jsonl`);
    if (fs.existsSync(main)) found.push({ file: main, label: 'main' });
    for (const file of findAgentFiles(path.join(projDir, id, 'subagents'), []).sort()) {
      found.push({ file, label: labelFor(file) });
    }
  }
  return found;
}

/** Measure one transcript file. */
function measureTranscript(file) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    text = '';
  }
  const byId = new Map();
  let firstTs = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    if (typeof obj.timestamp === 'string' && (firstTs === null || obj.timestamp < firstTs)) firstTs = obj.timestamp;
    const msg = obj.message;
    if (obj.type !== 'assistant' || !msg || !msg.usage || typeof msg.id !== 'string') continue;
    // Harness-written `<synthetic>` messages (API errors, interrupts) carry
    // zero usage and were never a model turn: skip them before any aggregate
    // (turns, pricing, the estimate flag, the row's model) can see them.
    if (msg.model === '<synthetic>') continue;
    byId.set(msg.id, msg); // last line wins
  }

  let peak = 0;
  let reread = 0;
  let output = 0;
  let cost = 0;
  let estimated = false;
  const modelCounts = new Map();
  for (const msg of byId.values()) {
    const u = msg.usage;
    const input = num(u.input_tokens);
    const create = num(u.cache_creation_input_tokens);
    const read = num(u.cache_read_input_tokens);
    const out = num(u.output_tokens);
    peak = Math.max(peak, input + create + read);
    reread += read;
    output += out;

    let w5m = create;
    let w1h = 0;
    const cc = u.cache_creation;
    if (cc && (typeof cc.ephemeral_5m_input_tokens === 'number' || typeof cc.ephemeral_1h_input_tokens === 'number')) {
      w5m = num(cc.ephemeral_5m_input_tokens);
      w1h = num(cc.ephemeral_1h_input_tokens);
    }
    const { price, known } = priceFor(msg.model);
    if (!known) estimated = true;
    cost += (input * price.input + out * price.output + read * price.cacheRead
      + w5m * price.cacheWrite5m + w1h * price.cacheWrite1h) / 1e6;

    const m = typeof msg.model === 'string' ? msg.model : 'unknown';
    modelCounts.set(m, (modelCounts.get(m) || 0) + 1);
  }

  let model = null;
  let best = 0;
  for (const [m, c] of modelCounts) {
    if (c > best) {
      model = m;
      best = c;
    }
  }

  return { turns: byId.size, peak, reread, output, cost, model, estimated, firstTimestamp: firstTs };
}

function sumTotals(rows) {
  const total = { turns: 0, peak: 0, reread: 0, output: 0, cost: 0, estimated: false };
  for (const r of rows) {
    total.turns += r.turns;
    total.peak = Math.max(total.peak, r.peak);
    total.reread += r.reread;
    total.output += r.output;
    total.cost += r.cost;
    if (r.estimated) total.estimated = true;
  }
  return total;
}

/**
 * @param {{ sessionIds: string[], projectsDir?: string }} opts
 * @returns {{ ok: true, sessions: object[], total: object } | { ok: false, error: string }}
 */
function measureSessions({ sessionIds, projectsDir } = {}) {
  const dir = projectsDir || defaultProjectsDir();
  const ids = Array.isArray(sessionIds) ? sessionIds : [];
  if (ids.length === 0) return { ok: false, error: 'measure: usage: measure.cjs <session-id> [<session-id>…] [--projects-dir <dir>] [--json]' };
  for (const id of ids) {
    if (typeof id !== 'string' || !SESSION_ID.test(id)) return { ok: false, error: `measure: invalid session id '${id}'` };
  }
  const sessions = [];
  for (const id of ids) {
    const files = discover(dir, id);
    if (files.length === 0) return { ok: false, error: `measure: session ${id} not found under ${dir}` };
    const agents = files.map(({ file, label }) => ({ label, ...measureTranscript(file) }));
    agents.sort((a, b) => {
      const ta = a.firstTimestamp || '￿';
      const tb = b.firstTimestamp || '￿';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    sessions.push({ id, agents, total: sumTotals(agents) });
  }
  return { ok: true, sessions, total: sumTotals(sessions.map(s => s.total)) };
}

function fmtCost(row) {
  return row.cost.toFixed(4) + (row.estimated ? '~' : '');
}

function renderTable(rows, total) {
  const header = ['agent', 'model', 'turns', 'peak ctx', 're-read', 'output', 'est $'];
  const cells = rows.map(r => [r.label, r.model || '-', String(r.turns), String(r.peak), String(r.reread), String(r.output), fmtCost(r)]);
  cells.push(['TOTAL', '', String(total.turns), String(total.peak), String(total.reread), String(total.output), fmtCost(total)]);
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map(c => c[i].length)));
  const line = c => c.map((v, i) => (i < 2 ? v.padEnd(widths[i]) : v.padStart(widths[i]))).join('  ').trimEnd();
  return [line(header), ...cells.map(line)].join('\n');
}

function render(result) {
  const parts = [];
  for (const s of result.sessions) {
    parts.push(`session ${s.id}\n${renderTable(s.agents, s.total)}`);
  }
  if (result.sessions.length > 1) {
    const t = result.total;
    parts.push(`all sessions\n${renderTable([], t)}`);
  }
  return parts.join('\n\n');
}

function stripInternal(rows) {
  return rows.map(({ label, model, turns, peak, reread, output, cost, estimated }) =>
    ({ label, model, turns, peak, reread, output, cost, estimated }));
}

module.exports = { PRICES, measureSessions, measureTranscript, defaultProjectsDir };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const ids = [];
  let projectsDir;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--projects-dir') projectsDir = argv[++i];
    else if (a.startsWith('--projects-dir=')) projectsDir = a.slice('--projects-dir='.length);
    else ids.push(a);
  }
  let result;
  try {
    result = measureSessions({ sessionIds: ids, projectsDir });
  } catch (e) {
    result = { ok: false, error: `measure: ${e && e.message}` };
  }
  if (!result.ok) {
    process.stdout.write(result.error + '\n');
    process.exitCode = 1;
  } else if (json) {
    const out = {
      sessions: result.sessions.map(s => ({ id: s.id, agents: stripInternal(s.agents), total: s.total })),
      total: result.total,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else {
    process.stdout.write(render(result) + '\n');
  }
}
