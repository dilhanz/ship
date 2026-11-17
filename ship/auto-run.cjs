#!/usr/bin/env node
// Ship auto-run record — owns `.planning/features/{slug}/AUTO.json`, the one
// durable record of a `/ship:auto` run: which session is carrying the feature
// to a pull request, the flags it was started with, the fix-round counters and
// any workflow still in flight. The auto skill writes it, the post-compact
// hook reads it to restore the run's intent, and every ending deletes it.
//
// The fix-round decision (`verdict`) lives here rather than in skill prose so
// it is deterministic: budget, pending fix task, shrinking failing set — the
// rules of the go skill's section 6b.
//
// Zero dependencies. The CLI prints one JSON line and always exits 0; bad
// input comes back as `{ ok: false, warning }`. No process.exit(). A slug that
// is not one path segment never touches the filesystem.
//
// Usage (from the checkout that holds the feature):
//   node auto-run.cjs start <slug> --session <id> [--fix-rounds <n>] [--profile <p>] [--resume]
//   node auto-run.cjs get <slug>
//   node auto-run.cjs workflow <slug> <plan|build> <taskId>
//   node auto-run.cjs workflow <slug> clear
//   node auto-run.cjs verdict <slug> <failingCount>
//   node auto-run.cjs bump <slug> planRounds --cap <n>
//   node auto-run.cjs end <slug>

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { isValidSlug } = require(path.join(__dirname, 'plan-parse.cjs'));
const { listPendingTasks } = require(path.join(__dirname, 'plan-tasks.cjs'));

const RECORD_FILE = 'AUTO.json';
const LOCK_FILE = 'AUTO.json.lock';
const DEFAULT_FIX_ROUNDS = 2;
const MAX_FIX_ROUNDS = 3;
const WORKFLOW_KINDS = ['plan', 'build'];
const BUMP_FIELDS = ['planRounds', 'continueRounds'];
const UNSUBSTITUTED_SESSION = 'CLAUDE_SESSION_ID';
const LOCK_WAIT_MS = 5000;
// Stale threshold stays below the wait, so a waiter outlives a lock a killed
// command left behind and takes it over instead of giving up. The critical
// section is a few milliseconds.
const LOCK_STALE_MS = 2000;
const LOCK_POLL_MS = 20;

function fail(warning) {
  return { ok: false, warning };
}

function firstLine(e) {
  return String((e && e.message) || e).split('\n')[0];
}

function resolveCwd(opts) {
  const o = opts || {};
  return typeof o.cwd === 'string' && o.cwd !== '' ? o.cwd : process.cwd();
}

function featureDir(cwd, slug) {
  return path.join(cwd, '.planning', 'features', slug);
}

function invalidSlug(slug) {
  return fail(`invalid slug '${String(slug)}' — a slug is one path segment`);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` while holding the record's lock file, so two read-modify-write
 * commands on the same record cannot lose one another's update. A lock older
 * than LOCK_STALE_MS belongs to a process that died and is taken over.
 */
function withLock(dir, fn) {
  const lock = path.join(dir, LOCK_FILE);
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lock, 'wx');
    } catch (e) {
      // EPERM / EACCES: Windows reports a lock file mid-delete this way.
      if (!e || (e.code !== 'EEXIST' && e.code !== 'EPERM' && e.code !== 'EACCES')) throw e;
      let stale = false;
      try {
        stale = Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS;
      } catch (_) {
        // Released between the open and the stat — just try again.
      }
      if (stale) {
        try { fs.unlinkSync(lock); } catch (_) { /* someone else took it over */ }
        continue;
      }
      if (Date.now() > deadline) throw new Error('the run record is locked by another command');
      sleep(LOCK_POLL_MS);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch (_) { /* already closed */ }
    try { fs.unlinkSync(lock); } catch (_) { /* already gone */ }
  }
}

/** The parsed record, or null when the file is absent, unreadable or not a JSON object. */
function readRecord(dir) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, RECORD_FILE), 'utf8');
  } catch (e) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

/** Temp file + rename in the same directory: a reader never sees half a record. */
function writeRecord(dir, record) {
  const target = path.join(dir, RECORD_FILE);
  const tmp = path.join(dir, `${RECORD_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n');
    let lastError = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        fs.renameSync(tmp, target);
        return;
      } catch (e) {
        // Windows refuses the rename while a reader holds the target open.
        if (!e || (e.code !== 'EPERM' && e.code !== 'EACCES' && e.code !== 'EBUSY')) throw e;
        lastError = e;
        sleep(LOCK_POLL_MS);
      }
    }
    throw lastError;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* never written or already renamed */ }
    throw e;
  }
}

/** A session id as stored: a non-empty, substituted string, else null. */
function normalizeSession(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (v === '' || v.includes(UNSUBSTITUTED_SESSION)) return null;
  return v;
}

/** A fix-round budget: a whole number 0–3, else undefined (absent). */
function parseFixRounds(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= MAX_FIX_ROUNDS ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return /^[0-9]$/.test(v) && Number(v) <= MAX_FIX_ROUNDS ? Number(v) : undefined;
}

function normalizeProfile(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v === '' ? null : v;
}

/** A whole non-negative number from a CLI string or a number, else null. */
function parseCount(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!/^[0-9]+$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

function freshRecord(slug, session, fixRounds, profile) {
  return {
    feature: slug,
    session,
    started: new Date().toISOString(),
    fixRounds: fixRounds === undefined ? DEFAULT_FIX_ROUNDS : fixRounds,
    fixRoundsUsed: 0,
    failingSets: [],
    planRounds: 0,
    profile,
    workflow: null,
  };
}

/**
 * Start (or resume) a run record.
 *
 * @param {string} slug
 * @param {{ cwd?: string, session?: string, fixRounds?: string|number, profile?: string, resume?: boolean }} [opts]
 */
function start(slug, opts) {
  if (!isValidSlug(slug)) return invalidSlug(slug);
  try {
    const o = opts || {};
    const dir = featureDir(resolveCwd(o), slug);
    if (!fs.existsSync(path.join(dir, 'CONTEXT.md'))) {
      return fail(`CONTEXT.md not found for ${slug} — nothing to run`);
    }
    const session = normalizeSession(o.session);
    const fixRounds = parseFixRounds(o.fixRounds);
    const profile = normalizeProfile(o.profile);

    return withLock(dir, () => {
      const existing = o.resume ? readRecord(dir) : null;
      if (existing) {
        if (session !== null) existing.session = session;
        if (fixRounds !== undefined) existing.fixRounds = fixRounds;
        if (profile !== null) existing.profile = profile;
        writeRecord(dir, existing);
        return { ok: true, resumed: true, record: existing };
      }
      const record = freshRecord(slug, session, fixRounds, profile);
      writeRecord(dir, record);
      return { ok: true, resumed: false, record };
    });
  } catch (e) {
    return fail(`auto-run start failed (${firstLine(e)})`);
  }
}

/** @param {string} slug @param {{ cwd?: string }} [opts] */
function get(slug, opts) {
  if (!isValidSlug(slug)) return invalidSlug(slug);
  try {
    return { ok: true, record: readRecord(featureDir(resolveCwd(opts), slug)) };
  } catch (e) {
    return fail(`auto-run get failed (${firstLine(e)})`);
  }
}

/** Read-modify-write under the lock; `ok: false` when there is no record. */
function update(slug, opts, label, fn) {
  if (!isValidSlug(slug)) return invalidSlug(slug);
  try {
    const dir = featureDir(resolveCwd(opts), slug);
    if (!fs.existsSync(dir)) return fail(`no auto-run record for ${slug}`);
    return withLock(dir, () => {
      const record = readRecord(dir);
      if (!record) return fail(`no auto-run record for ${slug}`);
      return fn(record, dir);
    });
  } catch (e) {
    return fail(`auto-run ${label} failed (${firstLine(e)})`);
  }
}

/**
 * Record the workflow in flight.
 *
 * @param {string} slug
 * @param {string} kind - `plan` | `build`
 * @param {string} taskId
 * @param {{ cwd?: string }} [opts]
 */
function setWorkflow(slug, kind, taskId, opts) {
  if (!isValidSlug(slug)) return invalidSlug(slug);
  if (!WORKFLOW_KINDS.includes(kind)) {
    return fail(`unknown workflow kind '${String(kind)}' — expected plan, build or clear`);
  }
  const id = typeof taskId === 'string' ? taskId.trim() : '';
  if (id === '') return fail('workflow needs a task id');
  return update(slug, opts, 'workflow', (record, dir) => {
    record.workflow = { kind, taskId: id };
    writeRecord(dir, record);
    return { ok: true, record };
  });
}

/** @param {string} slug @param {{ cwd?: string }} [opts] */
function clearWorkflow(slug, opts) {
  return update(slug, opts, 'workflow', (record, dir) => {
    record.workflow = null;
    writeRecord(dir, record);
    return { ok: true, record };
  });
}

/** Pending tasks in the feature's PLAN.md; 0 when there is no plan. */
function pendingTaskCount(cwd, slug) {
  const listed = listPendingTasks({ cwd, feature: slug });
  const phases = Array.isArray(listed.phases) ? listed.phases : [];
  const count = phases.reduce((n, ph) => n + (Array.isArray(ph.tasks) ? ph.tasks.length : 0), 0);
  if (listed.warning && count === 0) {
    // The lister warned and listed no task: either no phases at all, or a
    // malformed layout (an unclosed task) that left its one `all` phase empty.
    // Count line-anchored openers instead, so a pending fix task is not missed
    // and prose that merely mentions a task tag is not counted.
    let text;
    try {
      text = fs.readFileSync(path.join(featureDir(cwd, slug), 'PLAN.md'), 'utf8');
    } catch (e) {
      return 0;
    }
    return text.split('\n').filter((line) => /^\s*<task\b[^>]*\bstatus="pending"/.test(line)).length;
  }
  return count;
}

/** A hash of the feature's VERIFY.md, or null when there is none to read. */
function verifyStamp(dir) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, 'VERIFY.md'))).digest('hex');
  } catch (e) {
    return null;
  }
}

/**
 * Record a verify's failing-set size and decide whether a fix round runs.
 * Rules, in order: budget spent → stop; no pending fix task → stop; the
 * failing set did not shrink since the previous verify → stop (the first
 * verify is exempt). Otherwise one round is consumed.
 *
 * @param {string} slug
 * @param {string|number} failingCount
 * @param {{ cwd?: string }} [opts]
 */
function verdict(slug, failingCount, opts) {
  if (!isValidSlug(slug)) return invalidSlug(slug);
  const count = parseCount(failingCount);
  if (count === null) {
    return fail(`failing count '${String(failingCount)}' is not a whole non-negative number`);
  }
  const cwd = resolveCwd(opts);
  return update(slug, opts, 'verdict', (record, dir) => {
    // One decision per verify: VERIFY.md is rewritten by every verification, so
    // its hash names the verify. A repeated call for the same one (a resume that
    // re-enters Route) gets the stored decision back and consumes nothing.
    const stamp = verifyStamp(dir);
    const last = record.lastVerdict;
    if (stamp !== null && last && last.stamp === stamp && last.count === count && last.result) {
      return Object.assign({}, last.result, { repeated: true });
    }
    const sets = Array.isArray(record.failingSets) ? record.failingSets.slice() : [];
    const previous = sets.length > 0 ? sets[sets.length - 1] : null;
    const budget = parseFixRounds(record.fixRounds);
    const fixRounds = budget === undefined ? DEFAULT_FIX_ROUNDS : budget;
    let used = Number.isInteger(record.fixRoundsUsed) && record.fixRoundsUsed >= 0 ? record.fixRoundsUsed : 0;
    sets.push(count);

    let next = 'stop';
    let reason;
    if (used >= fixRounds) {
      reason = 'budget spent';
    } else if (pendingTaskCount(cwd, slug) === 0) {
      reason = 'no fix task';
    } else if (previous !== null && !(count < previous)) {
      reason = 'not shrinking';
    } else {
      next = 'fix-round';
      reason = previous === null ? 'first verify' : 'failing set shrinking';
      used += 1;
    }

    record.failingSets = sets;
    record.fixRounds = fixRounds;
    record.fixRoundsUsed = used;
    const result = { ok: true, next, reason, used, budget: fixRounds, trend: sets.join('→') };
    record.lastVerdict = stamp === null ? null : { stamp, count, result };
    writeRecord(dir, record);
    return result;
  });
}

/**
 * Increment a counter while it is below the cap.
 *
 * @param {string} slug
 * @param {string} field - `planRounds`
 * @param {string|number} cap
 * @param {{ cwd?: string }} [opts]
 */
function bump(slug, field, cap, opts) {
  if (!isValidSlug(slug)) return invalidSlug(slug);
  if (!BUMP_FIELDS.includes(field)) return fail(`unknown counter '${String(field)}' — expected planRounds or continueRounds`);
  const limit = parseCount(cap);
  if (limit === null) return fail(`--cap '${String(cap)}' is not a whole non-negative number`);
  return update(slug, opts, 'bump', (record, dir) => {
    const current = Number.isInteger(record[field]) && record[field] >= 0 ? record[field] : 0;
    if (current >= limit) return { ok: true, allowed: false, value: current };
    record[field] = current + 1;
    writeRecord(dir, record);
    return { ok: true, allowed: true, value: record[field] };
  });
}

/** Delete the record. An absent record is still `ok: true`. */
function end(slug, opts) {
  if (!isValidSlug(slug)) return invalidSlug(slug);
  try {
    const dir = featureDir(resolveCwd(opts), slug);
    if (!fs.existsSync(dir)) return { ok: true, removed: false };
    return withLock(dir, () => {
      try {
        fs.unlinkSync(path.join(dir, RECORD_FILE));
        return { ok: true, removed: true };
      } catch (e) {
        if (e && e.code === 'ENOENT') return { ok: true, removed: false };
        throw e;
      }
    });
  } catch (e) {
    return fail(`auto-run end failed (${firstLine(e)})`);
  }
}

const VALUE_FLAGS = ['session', 'fix-rounds', 'profile', 'cap'];

/** Split argv into positionals and flags; `--flag value` and `--flag=value` both work. */
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!VALUE_FLAGS.includes(name)) {
      flags[name] = true;
      continue;
    }
    if (eq !== -1) {
      flags[name] = arg.slice(eq + 1);
    } else if (argv[i + 1] !== undefined && !String(argv[i + 1]).startsWith('--')) {
      flags[name] = String(argv[i + 1]);
      i++;
    }
  }
  return { positionals, flags };
}

/**
 * Run one CLI command and return its result object.
 *
 * @param {string[]} argv - arguments after the script name
 * @param {{ cwd?: string }} [opts]
 */
function run(argv, opts) {
  try {
    const { positionals, flags } = parseArgs(Array.isArray(argv) ? argv : []);
    const command = positionals[0];
    const slug = positionals[1];
    const o = { cwd: resolveCwd(opts) };

    switch (command) {
      case 'start':
        return start(slug, {
          cwd: o.cwd,
          session: flags.session,
          fixRounds: flags['fix-rounds'],
          profile: flags.profile,
          resume: flags.resume === true,
        });
      case 'get':
        return get(slug, o);
      case 'workflow':
        if (positionals[2] === 'clear') return clearWorkflow(slug, o);
        return setWorkflow(slug, positionals[2], positionals[3], o);
      case 'verdict':
        return verdict(slug, positionals[2], o);
      case 'bump':
        return bump(slug, positionals[2], flags.cap, o);
      case 'end':
        return end(slug, o);
      default:
        return fail(
          `unknown command '${command === undefined ? '' : command}' — expected start, get, workflow, verdict, bump or end`
        );
    }
  } catch (e) {
    return fail(`auto-run failed (${firstLine(e)})`);
  }
}

module.exports = { start, get, setWorkflow, clearWorkflow, verdict, bump, end, run, RECORD_FILE };

if (require.main === module) {
  let result;
  try {
    result = run(process.argv.slice(2), { cwd: process.cwd() });
  } catch (e) {
    result = fail(`auto-run failed (${firstLine(e)})`);
  }
  // No process.exit(): stdout to a pipe is asynchronous on Windows and an
  // explicit exit can truncate the one line the skill parses.
  process.stdout.write(JSON.stringify(result) + '\n');
}
