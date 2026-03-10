#!/usr/bin/env node

/**
 * Ship uninstaller — removes Ship framework files from .claude/ in the current project.
 * Preserves user data (.planning/) and non-Ship files in shared directories.
 * Zero dependencies. Node.js built-ins only.
 */

const fs = require('fs');
const path = require('path');

const CLAUDE_DIR = path.join(process.cwd(), '.claude');

// Whole directories owned entirely by Ship
const SHIP_OWNED_DIRS = [
  path.join(CLAUDE_DIR, 'commands', 'ship'),
  path.join(CLAUDE_DIR, 'ship'),
];

// Shared directories — only remove files with the ship- prefix
const SHIP_PREFIX_DIRS = [
  path.join(CLAUDE_DIR, 'agents'),
  path.join(CLAUDE_DIR, 'hooks'),
];

function removeDirRecursive(dirPath, collected) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (e) {
    collected.push(path.relative(process.cwd(), dirPath) + '/ (access denied, skipped)');
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      removeDirRecursive(fullPath, collected);
    } else {
      try {
        fs.unlinkSync(fullPath);
        collected.push(path.relative(process.cwd(), fullPath));
      } catch (e) {
        if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') {
          collected.push(path.relative(process.cwd(), fullPath) + ' (locked, skipped)');
        } else {
          throw e;
        }
      }
    }
  }
  try {
    fs.rmdirSync(dirPath);
    collected.push(path.relative(process.cwd(), dirPath) + '/');
  } catch (e) {
    // Directory may not be empty if some files were locked
  }
}

function removePrefixedFiles(dir, prefix, collected) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith(prefix)) {
      const fullPath = path.join(dir, entry.name);
      try {
        fs.unlinkSync(fullPath);
        collected.push(path.relative(process.cwd(), fullPath));
      } catch (e) {
        if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') {
          collected.push(path.relative(process.cwd(), fullPath) + ' (locked, skipped)');
        } else {
          throw e;
        }
      }
    }
  }
  // Remove dir if now empty
  try {
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      collected.push(path.relative(process.cwd(), dir) + '/');
    }
  } catch (e) {}
}

function cleanSettings(collected) {
  const settingsPath = path.join(CLAUDE_DIR, 'settings.json');
  if (!fs.existsSync(settingsPath)) return;

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return;
  }

  let changed = false;

  // Remove ship-check-update from SessionStart
  if (settings.hooks?.SessionStart) {
    const before = settings.hooks.SessionStart.length;
    settings.hooks.SessionStart = settings.hooks.SessionStart.filter(
      group => !group.hooks?.some(h => h.command?.includes('ship-check-update'))
    );
    if (settings.hooks.SessionStart.length !== before) changed = true;
    if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart;
  }

  // Remove ship-context-monitor from PostToolUse
  if (settings.hooks?.PostToolUse) {
    const before = settings.hooks.PostToolUse.length;
    settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
      group => !group.hooks?.some(h => h.command?.includes('ship-context-monitor'))
    );
    if (settings.hooks.PostToolUse.length !== before) changed = true;
    if (settings.hooks.PostToolUse.length === 0) delete settings.hooks.PostToolUse;
  }

  // Remove ship-safety-gate from PreToolUse
  if (settings.hooks?.PreToolUse) {
    const before = settings.hooks.PreToolUse.length;
    settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
      group => !group.hooks?.some(h => h.command?.includes('ship-safety-gate'))
    );
    if (settings.hooks.PreToolUse.length !== before) changed = true;
    if (settings.hooks.PreToolUse.length === 0) delete settings.hooks.PreToolUse;
  }

  // Remove empty hooks object
  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
    changed = true;
  }

  // Remove ship statusLine
  if (settings.statusLine?.command?.includes('ship-statusline')) {
    delete settings.statusLine;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    collected.push('.claude/settings.json (Ship hooks removed)');
  }
}

function uninstall() {
  if (!fs.existsSync(CLAUDE_DIR)) {
    console.error('ERROR: .claude/ directory not found. Is Ship installed in this directory?');
    process.exit(1);
  }

  console.log('Uninstalling Ship...\n');

  const removed = [];

  // Remove Ship-owned directories entirely
  for (const dir of SHIP_OWNED_DIRS) {
    if (fs.existsSync(dir)) {
      removeDirRecursive(dir, removed);
    }
  }

  // Remove ship-* files from shared directories
  for (const dir of SHIP_PREFIX_DIRS) {
    removePrefixedFiles(dir, 'ship-', removed);
  }

  // Clean settings.json
  cleanSettings(removed);

  if (removed.length === 0) {
    console.log('Nothing removed — Ship does not appear to be installed here.');
    return;
  }

  console.log('Removed:');
  for (const f of removed) {
    console.log(`  ${f}`);
  }

  console.log(`\nShip uninstalled — ${removed.length} items removed from .claude/`);
  console.log('Note: .planning/ data has been preserved.');
}

uninstall();
