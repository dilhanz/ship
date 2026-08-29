#!/usr/bin/env node
// Ship PM fleet sweep — enumerates git worktrees (lanes), scans each lane's
// .planning/features/ for active features, extracts every in-flight PLAN.md's
// <files> claims, reports cross-lane file overlaps, and collects pending PM
// handoffs (shared .project-manager/ edits a lane could not make). The ship-pm
// agent consumes the CLI's single JSON document: `node lane-sweep.cjs` prints
// { lanes, overlaps, unowned, pendingHandoffs } to stdout.
//
// Every feature slug is bound to at most one owning lane (see
// resolveOwnership): lanes[].features lists only what that lane owns, each
// owned feature carrying `ownedBy` — `sole-lane` | `branch` | `stamp` — and a
// slug no lane owns is hoisted once into the fleet-level `unowned` array
// instead of appearing under every lane that happens to hold a copy. Overlap
// detection is fed owned claims only, so it reports collisions rather than
// copies.
//
// Zero dependencies. The pure functions (parseWorktrees, planFiles,
// parseHandoff, laneHandoffs, findOverlaps, parseLaneStamp, resolveOwnership)
// are exported for fixture tests; sweep(cwd) never throws — git failure
// degrades to { lanes: [], overlaps: [], unowned: [], pendingHandoffs: [], error }.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { scanFeatures } = require(path.join(__dirname, '..', 'hooks', 'scan-features.cjs'));

/** Normalize a path to forward slashes for stable cross-platform comparison. */
function toForwardSlashes(p) {
  return String(p).replace(/\\/g, '/');
}

/**
 * Parse `git worktree list --porcelain` output into worktree records.
 * Blocks are separated by blank lines; the first block is the main worktree.
 * `bare` and unknown attribute lines are tolerated and ignored; `detached`
 * worktrees carry `branch: null`.
 *
 * @param {string} porcelain
 * @returns {{ path: string, branch: string|null, head: string|null, isMain: boolean }[]}
 */
function parseWorktrees(porcelain) {
  const worktrees = [];

  for (const block of String(porcelain || '').split(/\r?\n\r?\n/)) {
    let wt = null;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        wt = {
          path: toForwardSlashes(line.slice('worktree '.length).trim()),
          branch: null,
          head: null,
          isMain: false
        };
      } else if (!wt) {
        continue; // attribute lines before any worktree line contribute nothing
      } else if (line.startsWith('HEAD ')) {
        wt.head = line.slice('HEAD '.length).trim();
      } else if (line.startsWith('branch ')) {
        wt.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
      }
      // `detached`, `bare`, and unknown attribute lines are ignored — a
      // detached worktree simply keeps branch: null.
    }
    if (wt) worktrees.push(wt);
  }

  if (worktrees.length > 0) worktrees[0].isMain = true;
  return worktrees;
}

/**
 * Extract every `<files>...</files>` body from a PLAN.md string: split on
 * commas and newlines, trim, drop empties, normalize to forward slashes.
 * Deduplicated case-insensitively (Windows paths), first-seen form kept.
 *
 * @param {string} planContent
 * @returns {string[]}
 */
function planFiles(planContent) {
  const files = [];
  const seen = new Set();
  const re = /<files>([\s\S]*?)<\/files>/g;
  let match;

  while ((match = re.exec(String(planContent || ''))) !== null) {
    for (const raw of match[1].split(/[,\n]/)) {
      const file = toForwardSlashes(raw.trim());
      if (file === '') continue;
      const key = file.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(file);
    }
  }

  return files;
}

/**
 * Parse a PM-HANDOFF.md into a record, or null when it is not one.
 *
 * A handoff is identified by its frontmatter, not its path — `feature` and
 * `applied` are the required keys. `applied` is truthy only for the exact
 * value `yes`; anything else (including a missing key) counts as pending, so
 * a malformed stamp is never mistaken for applied work.
 *
 * @param {string} content
 * @returns {{ feature: string, applied: boolean, raised: string|null,
 *             lane: string|null, head: string|null, summaries: string[] }|null}
 */
function parseHandoff(content) {
  const match = String(content || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const field = (name) => {
    // `[ \t]*`, never `\s*`: `\s` matches `\n`, so a key with an empty value
    // would swallow the following line — `feature:\napplied: no` parsing as
    // feature `"applied: no"`, an invented feature name reported as a clean
    // handoff. A field value can never leave its own line.
    const m = match[1].match(new RegExp(`^${name}:[ \\t]*(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  };

  const feature = field('feature');
  if (!feature) return null;

  // Each requested edit is a `### {n}. {summary}` heading in the body.
  const summaries = [];
  for (const line of String(content).split(/\r?\n/)) {
    const heading = line.match(/^###\s+\d+\.\s+(.*)$/);
    if (heading) summaries.push(heading[1].trim());
  }

  return {
    feature,
    applied: field('applied') === 'yes',
    raised: field('raised'),
    lane: field('lane'),
    head: field('head'),
    summaries
  };
}

/**
 * Why `parseHandoff` rejected this content, or null when it parses.
 *
 * The two rejection branches of `parseHandoff` are indistinguishable from its
 * null return, and a malformed handoff on disk cannot be fixed by any
 * writer-side change — so the reason has to travel with the report. Pure;
 * never throws.
 *
 * @param {string} content
 * @returns {string|null} 'no frontmatter block' | 'frontmatter missing feature:' | null
 */
function handoffFailureReason(content) {
  const match = String(content || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return 'no frontmatter block';
  const feature = match[1].match(/^feature:[ \t]*(.*)$/m); // same line-bound rule as parseHandoff
  const value = feature ? feature[1].trim().replace(/^["']|["']$/g, '') : '';
  if (!value) return 'frontmatter missing feature:';
  return null;
}

/**
 * Every PM handoff recorded in one lane, from both `.planning/features/` and
 * `.planning/archive/`.
 *
 * This deliberately does not go through `scanFeatures`: that helper drops
 * features with status `done`, and a deferred feature is `done` by design —
 * its code work finished and only the PM-layer edits remain. Keying off it
 * would hide exactly the handoffs this exists to surface.
 *
 * Detection is by **filename**: a file named `PM-HANDOFF.md` is a handoff,
 * full stop, and parsing happens afterwards. A file that does not parse is
 * reported with `unparseable: true` and a `reason` rather than being dropped
 * — reporting a malformed handoff through the same code path as "no handoff
 * at all" is the blind spot this closes, and no writer-side fix can reach the
 * files already on disk. An unparseable entry is never `applied`, so it
 * always reaches `pendingHandoffs`; `feature` falls back to the directory
 * name, since the file itself does not name one.
 *
 * @param {string} lanePath
 * @returns {{ feature: string, path: string, archived: boolean, applied: boolean,
 *             raised: string|null, summaries: string[], unparseable: boolean,
 *             reason?: string }[]}
 */
function laneHandoffs(lanePath) {
  const handoffs = [];

  for (const [dir, archived] of [['features', false], ['archive', true]]) {
    const base = path.join(lanePath, '.planning', dir);
    let entries = [];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch (e) {
      continue; // absent tree — nothing to report, never an error
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(base, entry.name, 'PM-HANDOFF.md');
      if (!fs.existsSync(file)) continue; // the only path that reports nothing

      // An unparseable handoff is never applied: hard-coded false, so it
      // always reaches pendingHandoffs and someone is told to fix the file.
      const broken = (reason) => ({
        feature: entry.name,
        path: toForwardSlashes(file),
        archived,
        applied: false,
        unparseable: true,
        reason,
        raised: null,
        summaries: []
      });

      let content;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch (e) {
        handoffs.push(broken(`unreadable: ${e && e.code ? e.code : 'unknown'}`));
        continue;
      }

      const parsed = parseHandoff(content);
      if (!parsed) {
        handoffs.push(broken(handoffFailureReason(content)));
        continue;
      }

      handoffs.push({
        feature: parsed.feature,
        path: toForwardSlashes(file),
        archived,
        applied: parsed.applied,
        unparseable: false,
        raised: parsed.raised,
        summaries: parsed.summaries
      });
    }
  }

  return handoffs;
}

/**
 * Find files claimed by in-flight features in two or more distinct lanes.
 * Path comparison is case-insensitive with normalized slashes (Windows);
 * features with status `done` claim nothing, and two features sharing a file
 * inside the *same* lane are not a collision.
 *
 * @param {{ path: string, branch: string|null, features: { name: string, status: string, files: string[] }[] }[]} lanes
 * @returns {{ file: string, claims: { lane: string, branch: string|null, feature: string }[] }[]}
 */
function findOverlaps(lanes) {
  const byFile = new Map(); // lowercased path → { file, claims }

  for (const lane of lanes || []) {
    for (const feature of lane.features || []) {
      if ((feature.status || '') === 'done') continue; // not in flight
      for (const raw of feature.files || []) {
        const file = toForwardSlashes(raw);
        const key = file.toLowerCase();
        let entry = byFile.get(key);
        if (!entry) {
          entry = { file, claims: [] };
          byFile.set(key, entry);
        }
        entry.claims.push({ lane: lane.path, branch: lane.branch, feature: feature.name });
      }
    }
  }

  const overlaps = [];
  for (const entry of byFile.values()) {
    const distinctLanes = new Set(entry.claims.map(c => String(c.lane).toLowerCase()));
    if (distinctLanes.size >= 2) overlaps.push(entry);
  }
  return overlaps;
}

/**
 * Parse a CONTEXT.md `lane:` stamp — `{branch} @ {worktree-path}` — into its
 * two components. Split on the LAST ` @ ` occurrence: a branch name may
 * contain one, a worktree path will not, so splitting last is the safe
 * direction. One layer of surrounding quotes is stripped and the path is
 * normalized to forward slashes.
 *
 * @param {*} value
 * @returns {{ branch: string, path: string }|null} null when the value is not
 *          a string, has no separator, or has an empty branch or path
 */
function parseLaneStamp(value) {
  if (typeof value !== 'string') return null;

  const raw = value.trim().replace(/^["']|["']$/g, '').trim();
  const sep = raw.lastIndexOf(' @ ');
  if (sep === -1) return null;

  const branch = raw.slice(0, sep).trim();
  const stamped = raw.slice(sep + ' @ '.length).trim();
  if (branch === '' || stamped === '') return null;

  return { branch, path: toForwardSlashes(stamped) };
}

/**
 * Bind every feature slug in the fleet to at most one owning lane.
 *
 * Resolution is fleet-wide per slug (not per-copy — a copy only vouches for
 * itself and so can never break a tie), first match wins:
 *
 *   1. sole holder  — exactly one lane in the fleet holds a copy of the slug.
 *                     No ambiguity exists and a single-holder slug cannot
 *                     produce a cross-lane overlap by definition, so this
 *                     fires before any tie-breaking. The fleet-of-one case is
 *                     a strict subset.  → ownedBy: 'sole-lane'
 *   2. branch match — exactly one holding lane whose branch is `feature/{slug}`
 *                     or bare `{slug}` (case-insensitive, trimmed; a detached
 *                     lane never matches).  → ownedBy: 'branch'
 *   3. stamp        — exactly one holding lane whose copy's `lane:` stamp names
 *                     that same lane's own path. The stamp's branch component
 *                     is NOT required to match: the worktree path is the
 *                     identity and a lane can be re-branched in place.
 *                     → ownedBy: 'stamp'
 *   4. unowned      — reported once at fleet level, in no lane's features.
 *
 * A branch outranks a stamp because a branch is a fleet-unique fact while a
 * stamp is self-testimony: `/worktree` copies the feature directory and
 * pm-update.cjs re-stamps in whichever lane it runs, so both copies can carry
 * self-consistent stamps and both would claim the slug.
 *
 * Pure and non-mutating: new lane objects are returned with a filtered
 * `features` array (each owned feature is the original record plus `ownedBy`)
 * and every other lane key preserved. Never throws.
 *
 * @param {{ path: string, branch: string|null, features?: { name: string, status: string, lane?: string|null }[] }[]} lanes
 * @returns {{ lanes: object[], unowned: { name: string, lanes: { path: string, branch: string|null, status: string }[] }[] }}
 */
function resolveOwnership(lanes) {
  const input = Array.isArray(lanes) ? lanes : [];

  // slug → holders, in fleet order
  const holders = new Map();
  input.forEach((lane, index) => {
    for (const feature of (lane && lane.features) || []) {
      const name = feature && feature.name;
      if (typeof name !== 'string' || name === '') continue;
      if (!holders.has(name)) holders.set(name, []);
      holders.get(name).push({ index, lane, feature });
    }
  });

  const ownership = new Map(); // laneIndex → Map(slug → reason)
  const unowned = [];

  const own = (holder, slug, reason) => {
    if (!ownership.has(holder.index)) ownership.set(holder.index, new Map());
    ownership.get(holder.index).set(slug, reason);
  };

  for (const [slug, held] of holders) {
    if (held.length === 1) {
      own(held[0], slug, 'sole-lane');
      continue;
    }

    const wanted = [`feature/${slug}`.toLowerCase(), slug.toLowerCase()];
    const byBranch = held.filter(h => {
      const branch = h.lane && h.lane.branch;
      if (typeof branch !== 'string') return false;
      return wanted.includes(branch.trim().toLowerCase());
    });
    if (byBranch.length === 1) {
      own(byBranch[0], slug, 'branch');
      continue;
    }

    const byStamp = held.filter(h => {
      const stamp = parseLaneStamp(h.feature.lane);
      if (!stamp) return false;
      const lanePath = toForwardSlashes(h.lane.path || '').toLowerCase();
      return lanePath !== '' && stamp.path.toLowerCase() === lanePath;
    });
    if (byStamp.length === 1) {
      own(byStamp[0], slug, 'stamp');
      continue;
    }

    unowned.push({
      name: slug,
      lanes: held.map(h => ({
        path: h.lane.path,
        branch: typeof h.lane.branch === 'string' ? h.lane.branch : null,
        status: h.feature.status
      }))
    });
  }

  unowned.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const ownedLanes = input.map((lane, index) => {
    const owned = ownership.get(index) || new Map();
    const features = ((lane && lane.features) || [])
      .filter(f => f && owned.has(f.name))
      .map(f => ({ ...f, ownedBy: owned.get(f.name) }));
    return { ...lane, features };
  });

  return { lanes: ownedLanes, unowned };
}

/**
 * Run the full fleet sweep from a working directory: enumerate worktrees,
 * scan each lane's active features (scanFeatures already excludes done and
 * provides task counts), and read each feature's PLAN.md file claims.
 * Never throws — git failure or a non-repo degrades to an empty sweep with
 * an `error` field the PM agent reports.
 *
 * Ownership is then resolved fleet-wide (see resolveOwnership), so each lane
 * reports only the features it owns and unattributed slugs are hoisted once
 * into `unowned` rather than repeated under every lane holding a copy.
 *
 * Pending PM handoffs are collected across every lane into `pendingHandoffs`
 * — deferred PM-layer edits no lane may perform (see parseHandoff). They are
 * never ownership-gated: a lane that owns no feature still reports its handoff.
 * An entry carrying `unparseable: true` and a `reason` is a file named
 * `PM-HANDOFF.md` that could not be read or parsed; it is reported, never
 * applied, and never silently counted as absent.
 *
 * @param {string} cwd
 * @returns {{ lanes: { path: string, branch: string|null, isMain: boolean,
 *             features: { name: string, status: string, currentPhase: string|null,
 *                         tasks: object|null, lane: string|null, files: string[],
 *                         ownedBy: 'sole-lane'|'branch'|'stamp' }[],
 *             handoffs: ReturnType<typeof laneHandoffs> }[],
 *             overlaps: ReturnType<typeof findOverlaps>,
 *             unowned: ReturnType<typeof resolveOwnership>['unowned'],
 *             pendingHandoffs: object[], error?: string }}
 */
function sweep(cwd) {
  try {
    const result = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' });
    if (!result || result.status !== 0 || !result.stdout || result.stdout.trim() === '') {
      return { lanes: [], overlaps: [], unowned: [], pendingHandoffs: [], error: 'not a git repository or git unavailable' };
    }

    const lanes = parseWorktrees(result.stdout).map(wt => {
      const features = scanFeatures(wt.path).map(f => {
        let files = [];
        try {
          const planPath = path.join(wt.path, '.planning', 'features', f.name, 'PLAN.md');
          if (fs.existsSync(planPath)) files = planFiles(fs.readFileSync(planPath, 'utf8'));
        } catch (e) {
          // unreadable plan → no file claims; the lane still reports
        }
        return {
          name: f.name,
          status: f.status,
          currentPhase: f.currentPhase || null,
          tasks: f.tasks || null,
          lane: f.lane || null,
          files
        };
      });
      return {
        path: wt.path,
        branch: wt.branch,
        isMain: wt.isMain,
        features,
        handoffs: laneHandoffs(wt.path)
      };
    });

    // Bind each slug to at most one lane before anything downstream reads the
    // feature lists. findOverlaps is unchanged — feeding it owned claims only
    // is the entire fix for phantom cross-lane collisions.
    const { lanes: ownedLanes, unowned } = resolveOwnership(lanes);

    // Pending PM handoffs are fleet-level, not lane-level: whichever lane
    // raised one, only the PM layer at the main root can apply it. Hoisting
    // them here means the PM never has to walk every lane to find them.
    // Deliberately not gated on features.length — ownership filtering never
    // touches lane.handoffs, and a lane that owns nothing may still be holding
    // the handoff that matters most.
    const pendingHandoffs = [];
    for (const lane of ownedLanes) {
      for (const handoff of lane.handoffs) {
        if (handoff.applied) continue;
        pendingHandoffs.push({ ...handoff, lane: lane.path, branch: lane.branch, isMain: lane.isMain });
      }
    }

    return { lanes: ownedLanes, overlaps: findOverlaps(ownedLanes), unowned, pendingHandoffs };
  } catch (e) {
    return { lanes: [], overlaps: [], unowned: [], pendingHandoffs: [], error: 'not a git repository or git unavailable' };
  }
}

module.exports = { parseWorktrees, planFiles, parseHandoff, handoffFailureReason, laneHandoffs, findOverlaps, parseLaneStamp, resolveOwnership, sweep };

if (require.main === module) {
  process.stdout.write(JSON.stringify(sweep(process.cwd())) + '\n');
}
