#!/usr/bin/env node
// Ship shared utility — PM state-root resolver
// Resolves where .project-manager/ lives: the main worktree root when the
// directory is gitignored (one canonical copy shared across worktrees), the
// current directory otherwise. Used by ship/pm-update.cjs and
// hooks/pm-sync-nudge.cjs.

const path = require('path');
const { spawnSync } = require('child_process');

/**
 * Resolve the PM state root for a working directory.
 *
 * When `.project-manager/` is gitignored, one canonical copy lives at the
 * main worktree root and every linked worktree resolves to it. When it is
 * tracked (or ignore status cannot be determined), state stays per-worktree
 * and `root` is `cwd`. Outside a git repo (or with git unavailable) the
 * function falls back to `cwd` silently — it feeds hooks that must never
 * throw.
 *
 * @param {string} cwd - working directory
 * @returns {{ root: string, mainRoot: string|null, gitignored: boolean, fallback: boolean }}
 */
function resolveStateRoot(cwd) {
  try {
    const common = spawnSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd, encoding: 'utf8' }
    );
    const commonDir = common.status === 0 && common.stdout ? common.stdout.trim() : '';
    if (common.error || common.status !== 0 || commonDir === '') {
      return { root: cwd, mainRoot: null, gitignored: false, fallback: true };
    }

    // The output is the main repo's .git directory in absolute form (forward
    // slashes on Windows); path.resolve normalizes to native separators.
    const mainRoot = path.dirname(path.resolve(commonDir));

    // Exit 0 = ignored, 1 = not ignored; anything else (or a spawn error) is
    // uncertainty — never fake a shared view on uncertainty. The trailing
    // slash forces directory semantics so a dir-only ignore pattern
    // (`.project-manager/`) matches even when the directory does not exist
    // in this worktree — the normal state of a linked worktree.
    const check = spawnSync(
      'git',
      ['check-ignore', '-q', '.project-manager/'],
      { cwd, encoding: 'utf8' }
    );
    const gitignored = !check.error && check.status === 0;

    return { root: gitignored ? mainRoot : cwd, mainRoot, gitignored, fallback: false };
  } catch (e) {
    return { root: cwd, mainRoot: null, gitignored: false, fallback: true };
  }
}

module.exports = { resolveStateRoot };
