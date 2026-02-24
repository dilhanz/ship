#!/usr/bin/env node

/**
 * Ship installer — copies framework files to ~/.claude/
 * Zero dependencies. Node.js built-ins only.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SHIP_ROOT = path.resolve(__dirname);
const CLAUDE_DIR = path.join(os.homedir(), '.claude');

const COPIES = [
  // Commands → ~/.claude/commands/ship/
  {
    src: path.join(SHIP_ROOT, 'commands', 'ship'),
    dest: path.join(CLAUDE_DIR, 'commands', 'ship'),
  },
  // Agents → ~/.claude/agents/
  {
    src: path.join(SHIP_ROOT, 'agents'),
    dest: path.join(CLAUDE_DIR, 'agents'),
  },
  // Ship data → ~/.claude/ship/
  {
    src: path.join(SHIP_ROOT, 'ship'),
    dest: path.join(CLAUDE_DIR, 'ship'),
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
      copied.push(destPath.replace(os.homedir(), '~'));
    }
  }

  return copied;
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

  console.log(`\nShip installed — ${allCopied.length} files copied to ~/.claude/`);
  console.log('\nGet started:');
  console.log('  cd your-project');
  console.log('  /ship:new-project');
}

install();
