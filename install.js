#!/usr/bin/env node

/**
 * Ship installer — copies framework files to .claude/ in the current project
 * Zero dependencies. Node.js built-ins only.
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
      copied.push(path.relative(process.cwd(), destPath));
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

  const hooksDir = path.join(CLAUDE_DIR, 'hooks');
  const checkUpdateCmd = `node ${hooksDir}/ship-check-update.js`;
  const contextMonitorCmd = `node ${hooksDir}/ship-context-monitor.js`;
  const statuslineCmd = `node ${hooksDir}/ship-statusline.js`;

  if (!settings.hooks) settings.hooks = {};

  // SessionStart: ship-check-update
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
  const hasCheckUpdate = settings.hooks.SessionStart.some(group =>
    group.hooks?.some(h => h.command?.includes('ship-check-update'))
  );
  if (!hasCheckUpdate) {
    settings.hooks.SessionStart.push({
      hooks: [{ type: 'command', command: checkUpdateCmd }]
    });
  }

  // PostToolUse: ship-context-monitor
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];
  const hasContextMonitor = settings.hooks.PostToolUse.some(group =>
    group.hooks?.some(h => h.command?.includes('ship-context-monitor'))
  );
  if (!hasContextMonitor) {
    settings.hooks.PostToolUse.push({
      hooks: [{ type: 'command', command: contextMonitorCmd }]
    });
  }

  // statusLine: only set if not already configured
  if (!settings.statusLine) {
    settings.statusLine = { type: 'command', command: statuslineCmd };
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return path.relative(process.cwd(), settingsPath);
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
  console.log('  /ship:new-project');
}

install();
