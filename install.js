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

// Legacy phased-system files to remove on install (cleanup from pre-rewrite era)
const LEGACY_FILES = [
  // Agents
  path.join('agents', 'ship-executor.md'),
  path.join('agents', 'ship-roadmapper.md'),
  path.join('agents', 'ship-plan-checker.md'),
  // Commands
  path.join('commands', 'ship', 'auto.md'),
  path.join('commands', 'ship', 'add-phase.md'),
  path.join('commands', 'ship', 'complete.md'),
  path.join('commands', 'ship', 'execute-phase.md'),
  path.join('commands', 'ship', 'feature-brainstorm.md'),
  path.join('commands', 'ship', 'new-project.md'),
  path.join('commands', 'ship', 'pause-work.md'),
  path.join('commands', 'ship', 'plan-phase.md'),
  path.join('commands', 'ship', 'verify-phase.md'),
  // Workflows
  path.join('ship', 'workflows', 'auto.md'),
  path.join('ship', 'workflows', 'deep-brainstorm.md'),
  path.join('ship', 'workflows', 'execute-phase.md'),
  path.join('ship', 'workflows', 'new-project.md'),
  path.join('ship', 'workflows', 'plan-phase.md'),
  path.join('ship', 'workflows', 'verify-phase.md'),
  // Templates
  path.join('ship', 'templates', 'PROJECT.md'),
  path.join('ship', 'templates', 'REQUIREMENTS.md'),
  path.join('ship', 'templates', 'ROADMAP.md'),
  path.join('ship', 'templates', 'STATE.md'),
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

  // Use bare 'node' (resolved from PATH) and relative paths for portability
  // across macOS, Windows (Git Bash), and WSL.
  const hooksDir = '.claude/hooks';
  const checkUpdateCmd = `node ${hooksDir}/ship-check-update.js`;
  const contextMonitorCmd = `node ${hooksDir}/ship-context-monitor.js`;
  const statuslineCmd = `node ${hooksDir}/ship-statusline.js`;

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

  // Clean up legacy phased-system files
  const removed = [];
  for (const relPath of LEGACY_FILES) {
    const fullPath = path.join(CLAUDE_DIR, relPath);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath);
      removed.push(relPath);
    }
  }
  if (removed.length > 0) {
    console.log('\nLegacy files removed:');
    for (const f of removed) {
      console.log(`  .claude/${f}`);
    }
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
