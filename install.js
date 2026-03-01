#!/usr/bin/env node

/**
 * Ship installer — copies framework files to .claude/ in the current project
 * Zero dependencies. Node.js built-ins only.
 *
 * Usage:
 *   npx github:dilhanz/ship             Install or update
 *   npx github:dilhanz/ship --uninstall  Remove Ship
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

// Returns the best node executable to embed in hook commands.
// Priority: bare 'node' if it's in the Unix PATH (cleanest), otherwise
// process.execPath with WSL path conversion.
//
// IMPORTANT: check for Windows execPath FIRST. If we're running Windows node
// inside WSL, spawnSync('node') would resolve against Windows PATH (where node
// IS found), producing a bare 'node' that Claude Code (in WSL) can't execute.
function findNodeBin() {
  // If process.execPath looks like a Windows path, we're running Windows node
  // inside WSL. Return the /mnt/... path so WSL's bash can execute it.
  if (isWindowsNodeInWSL()) {
    return toUnixPath(process.execPath);
  }

  // On Mac/Linux (or WSL with native node): prefer bare 'node' if it's in PATH.
  const result = spawnSync('node', ['--version'], { encoding: 'utf8', timeout: 3000 });
  if (result.status === 0 && !result.error) {
    return 'node';
  }

  // Fallback: use current executable as-is.
  return process.execPath;
}

// Converts a Windows path to a Unix/WSL path.
function toUnixPath(p) {
  if (!/^[A-Za-z]:\\/.test(p)) return p;
  try {
    return execFileSync('wslpath', ['-u', p], { encoding: 'utf8' }).trim();
  } catch (e) {
    return p.replace(/^([A-Za-z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
  }
}

// Converts a Unix/WSL path to a Windows path (for passing to Windows node.exe).
function toWindowsPath(p) {
  if (/^[A-Za-z]:\\/.test(p)) return p;
  try {
    return execFileSync('wslpath', ['-w', p], { encoding: 'utf8' }).trim();
  } catch (e) {
    // Manual conversion: /mnt/c/foo → C:\foo
    return p.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\');
  }
}

// Returns true if we're running as a Windows node.exe inside WSL.
function isWindowsNodeInWSL() {
  return /^[A-Za-z]:\\/.test(process.execPath);
}

const SHIP_ROOT = path.resolve(__dirname);
const CLAUDE_DIR = path.join(process.cwd(), '.claude');

const COPIES = [
  // Commands → .claude/commands/ship/
  {
    src: path.join(SHIP_ROOT, 'commands', 'ship'),
    dest: path.join(CLAUDE_DIR, 'commands', 'ship'),
  },
  // Agents → .claude/agents/
  {
    src: path.join(SHIP_ROOT, 'agents'),
    dest: path.join(CLAUDE_DIR, 'agents'),
  },
  // Ship data → .claude/ship/
  {
    src: path.join(SHIP_ROOT, 'ship'),
    dest: path.join(CLAUDE_DIR, 'ship'),
  },
  // Hooks → .claude/hooks/
  {
    src: path.join(SHIP_ROOT, 'hooks'),
    dest: path.join(CLAUDE_DIR, 'hooks'),
  },
];

// Ship-owned agent files (for clean uninstall)
const AGENT_FILES = [
  'ship-brainstormer.md',
  'ship-builder.md',
  'ship-planner.md',
  'ship-verifier.md',
];

// Ship-owned hook files (for clean uninstall)
const HOOK_FILES = [
  'ship-check-update.js',
  'ship-context-monitor.js',
  'ship-statusline.js',
];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  const copied = [];

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      const subCopied = copyDir(srcPath, destPath);
      copied.push(...subCopied);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      copied.push(destPath.replace(process.cwd(), '.'));
    }
  }

  return copied;
}

function registerSettings() {
  const settingsPath = path.join(CLAUDE_DIR, 'settings.json');
  let settings = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      // Corrupt or empty settings — start fresh
    }
  }

  const nodeBin = findNodeBin();
  const hooksDirRaw = path.join(CLAUDE_DIR, 'hooks');

  // When running Windows node in WSL: node binary needs a /mnt/ Unix path so
  // WSL bash can invoke it, but script arguments must be Windows paths (C:\...)
  // because Windows node interprets /mnt/... as C:\mnt\... and fails.
  // On all other platforms, use Unix paths throughout.
  let hooksDir, scriptQuote;
  if (isWindowsNodeInWSL()) {
    hooksDir = toWindowsPath(hooksDirRaw);
    scriptQuote = '"';
  } else {
    hooksDir = toUnixPath(hooksDirRaw);
    scriptQuote = nodeBin === 'node' ? '' : '"';
  }

  const nodePart = nodeBin === 'node' ? 'node' : `"${nodeBin}"`;
  const sep = isWindowsNodeInWSL() ? '\\' : '/';
  const checkUpdateCmd = `${nodePart} ${scriptQuote}${hooksDir}${sep}ship-check-update.js${scriptQuote}`;
  const contextMonitorCmd = `${nodePart} ${scriptQuote}${hooksDir}${sep}ship-context-monitor.js${scriptQuote}`;
  const statuslineCmd = `${nodePart} ${scriptQuote}${hooksDir}${sep}ship-statusline.js${scriptQuote}`;

  if (!settings.hooks) settings.hooks = {};

  // SessionStart: ship-check-update — always update to keep node path current
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
  settings.hooks.SessionStart = settings.hooks.SessionStart.filter(group =>
    !group.hooks?.some(h => h.command?.includes('ship-check-update'))
  );
  settings.hooks.SessionStart.push({
    hooks: [{ type: 'command', command: checkUpdateCmd }]
  });

  // PostToolUse: ship-context-monitor — always update to keep node path current
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];
  settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(group =>
    !group.hooks?.some(h => h.command?.includes('ship-context-monitor'))
  );
  settings.hooks.PostToolUse.push({
    hooks: [{ type: 'command', command: contextMonitorCmd }]
  });

  // statusLine: always update to keep node path current
  settings.statusLine = { type: 'command', command: statuslineCmd };

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return settingsPath.replace(process.cwd(), '.');
}

function deregisterSettings() {
  const settingsPath = path.join(CLAUDE_DIR, 'settings.json');
  if (!fs.existsSync(settingsPath)) return null;

  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (e) {
    return null;
  }

  // Remove ship hooks from SessionStart
  if (settings.hooks?.SessionStart) {
    settings.hooks.SessionStart = settings.hooks.SessionStart.filter(group =>
      !group.hooks?.some(h => h.command?.includes('ship-check-update'))
    );
    if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart;
  }

  // Remove ship hooks from PostToolUse
  if (settings.hooks?.PostToolUse) {
    settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(group =>
      !group.hooks?.some(h => h.command?.includes('ship-context-monitor'))
    );
    if (settings.hooks.PostToolUse.length === 0) delete settings.hooks.PostToolUse;
  }

  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  // Remove statusLine if it points to a ship hook
  if (settings.statusLine?.command?.includes('ship-statusline')) {
    delete settings.statusLine;
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return settingsPath.replace(process.cwd(), '.');
}

function removeFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { recursive: true, force: true });
    return filePath.replace(process.cwd(), '.');
  }
  return null;
}

function install() {
  console.log('Installing Ship...\n');

  const allCopied = [];

  for (const { src, dest } of COPIES) {
    if (!fs.existsSync(src)) {
      console.error(`ERROR: Source directory not found: ${src}`);
      process.exit(1);
    }
    const copied = copyDir(src, dest);
    allCopied.push(...copied);
  }

  console.log('Files installed:');
  for (const f of allCopied) {
    console.log(`  ${f}`);
  }

  const settingsPath = registerSettings();
  console.log(`  ${settingsPath} (hooks + statusLine registered)`);

  console.log(`\nShip installed — ${allCopied.length} files copied to .claude/`);
  console.log('\nGet started:');
  console.log('  /ship:start "your feature idea"');
}

function uninstall() {
  console.log('Uninstalling Ship...\n');

  const removed = [];

  // Remove commands directory
  const r1 = removeFile(path.join(CLAUDE_DIR, 'commands', 'ship'));
  if (r1) removed.push(r1);

  // Remove ship agent files
  for (const file of AGENT_FILES) {
    const r = removeFile(path.join(CLAUDE_DIR, 'agents', file));
    if (r) removed.push(r);
  }

  // Remove ship data directory
  const r2 = removeFile(path.join(CLAUDE_DIR, 'ship'));
  if (r2) removed.push(r2);

  // Remove ship hook files
  for (const file of HOOK_FILES) {
    const r = removeFile(path.join(CLAUDE_DIR, 'hooks', file));
    if (r) removed.push(r);
  }

  // Remove update check cache
  const r3 = removeFile(path.join(CLAUDE_DIR, 'cache', 'ship-update-check.json'));
  if (r3) removed.push(r3);

  if (removed.length > 0) {
    console.log('Files removed:');
    for (const f of removed) {
      console.log(`  ${f}`);
    }
  }

  const settingsPath = deregisterSettings();
  if (settingsPath) {
    console.log(`  ${settingsPath} (hooks + statusLine removed)`);
  }

  console.log('\nShip uninstalled.');
}

const args = process.argv.slice(2);
if (args.includes('--uninstall')) {
  uninstall();
} else {
  install();
}
