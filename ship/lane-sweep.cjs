#!/usr/bin/env node
// Ship PM fleet sweep — enumerates git worktrees (lanes), scans each lane's
// .planning/features/ for active features, extracts every in-flight PLAN.md's
// <files> claims, reports cross-lane file overlaps, and collects pending PM
// handoffs (shared .project-manager/ edits a lane could not make). The ship-pm
// agent consumes the CLI's single JSON document: `node lane-sweep.cjs` prints
// { lanes, overlaps, pendingHandoffs } to stdout.
//
// Zero dependencies. The pure functions (parseWorktrees, planFiles,
// parseHandoff, laneHandoffs, findOverlaps) are exported for fixture tests;
// sweep(cwd) never throws — git failure degrades to
// { lanes: [], overlaps: [], pendingHandoffs: [], error }.

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
    const m = match[1].match(new RegExp(`^${name}:\\s*(.*)$`, 'm'));
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
 * Every PM handoff recorded in one lane, from both `.planning/features/` and
 * `.planning/archive/`.
 *
 * This deliberately does not go through `scanFeatures`: that helper drops
 * features with status `done`, and a deferred feature is `done` by design —
 * its code work finished and only the PM-layer edits remain. Keying off it
 * would hide exactly the handoffs this exists to surface.
 *
 * @param {string} lanePath
 * @returns {{ feature: string, path: string, archived: boolean, applied: boolean,
 *             raised: string|null, summaries: string[] }[]}
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
      let parsed = null;
      try {
        if (fs.existsSync(file)) parsed = parseHandoff(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        parsed = null; // unreadable handoff degrades to absent
      }
      if (!parsed) continue;
      handoffs.push({
        feature: parsed.feature,
        path: toForwardSlashes(file),
        archived,
        applied: parsed.applied,
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
 * Run the full fleet sweep from a working directory: enumerate worktrees,
 * scan each lane's active features (scanFeatures already excludes done and
 * provides task counts), and read each feature's PLAN.md file claims.
 * Never throws — git failure or a non-repo degrades to an empty sweep with
 * an `error` field the PM agent reports.
 *
 * Pending PM handoffs are collected across every lane into `pendingHandoffs`
 * — deferred PM-layer edits no lane may perform (see parseHandoff).
 *
 * @param {string} cwd
 * @returns {{ lanes: { path: string, branch: string|null, isMain: boolean,
 *             features: { name: string, status: string, currentPhase: string|null,
 *                         tasks: object|null, files: string[] }[],
 *             handoffs: ReturnType<typeof laneHandoffs> }[],
 *             overlaps: ReturnType<typeof findOverlaps>,
 *             pendingHandoffs: object[], error?: string }}
 */
function sweep(cwd) {
  try {
    const result = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' });
    if (!result || result.status !== 0 || !result.stdout || result.stdout.trim() === '') {
      return { lanes: [], overlaps: [], pendingHandoffs: [], error: 'not a git repository or git unavailable' };
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

    // Pending PM handoffs are fleet-level, not lane-level: whichever lane
    // raised one, only the PM layer at the main root can apply it. Hoisting
    // them here means the PM never has to walk every lane to find them.
    const pendingHandoffs = [];
    for (const lane of lanes) {
      for (const handoff of lane.handoffs) {
        if (handoff.applied) continue;
        pendingHandoffs.push({ ...handoff, lane: lane.path, branch: lane.branch, isMain: lane.isMain });
      }
    }

    return { lanes, overlaps: findOverlaps(lanes), pendingHandoffs };
  } catch (e) {
    return { lanes: [], overlaps: [], pendingHandoffs: [], error: 'not a git repository or git unavailable' };
  }
}

module.exports = { parseWorktrees, planFiles, parseHandoff, laneHandoffs, findOverlaps, sweep };

if (require.main === module) {
  process.stdout.write(JSON.stringify(sweep(process.cwd())) + '\n');
}
