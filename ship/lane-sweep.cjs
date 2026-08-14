#!/usr/bin/env node
// Ship PM fleet sweep — enumerates git worktrees (lanes), scans each lane's
// .planning/features/ for active features, extracts every in-flight PLAN.md's
// <files> claims, and reports cross-lane file overlaps. The ship-pm agent
// consumes the CLI's single JSON document: `node lane-sweep.cjs` prints
// { lanes, overlaps } to stdout.
//
// Zero dependencies. The pure functions (parseWorktrees, planFiles,
// findOverlaps) are exported for fixture tests; sweep(cwd) never throws —
// git failure degrades to { lanes: [], overlaps: [], error }.

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
 * @param {string} cwd
 * @returns {{ lanes: { path: string, branch: string|null, isMain: boolean,
 *             features: { name: string, status: string, currentPhase: string|null,
 *                         tasks: object|null, files: string[] }[] }[],
 *             overlaps: ReturnType<typeof findOverlaps>, error?: string }}
 */
function sweep(cwd) {
  try {
    const result = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' });
    if (!result || result.status !== 0 || !result.stdout || result.stdout.trim() === '') {
      return { lanes: [], overlaps: [], error: 'not a git repository or git unavailable' };
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
      return { path: wt.path, branch: wt.branch, isMain: wt.isMain, features };
    });

    return { lanes, overlaps: findOverlaps(lanes) };
  } catch (e) {
    return { lanes: [], overlaps: [], error: 'not a git repository or git unavailable' };
  }
}

module.exports = { parseWorktrees, planFiles, findOverlaps, sweep };

if (require.main === module) {
  process.stdout.write(JSON.stringify(sweep(process.cwd())) + '\n');
}
