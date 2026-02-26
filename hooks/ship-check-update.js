#!/usr/bin/env node
// Check for Ship updates in background, write result to cache.
// Called by SessionStart hook - runs once per session.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const homeDir = os.homedir();
const cacheDir = path.join(homeDir, '.claude', 'cache');
const cacheFile = path.join(cacheDir, 'ship-update-check.json');
const installedVersionFile = path.join(homeDir, '.claude', 'ship', 'VERSION');

// Ensure cache directory exists
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

// Run check in background (spawn background process, windowsHide prevents console flash)
const child = spawn(process.execPath, ['-e', `
  const fs = require('fs');
  const https = require('https');

  const cacheFile = ${JSON.stringify(cacheFile)};
  const installedVersionFile = ${JSON.stringify(installedVersionFile)};
  const remoteUrl = 'https://raw.githubusercontent.com/dilhanz/ship/main/ship/VERSION';

  let installed = '0.0.0';
  try {
    if (fs.existsSync(installedVersionFile)) {
      installed = fs.readFileSync(installedVersionFile, 'utf8').trim();
    }
  } catch (e) {}

  https.get(remoteUrl, res => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      const latest = body.trim();
      const result = {
        update_available: !!latest && installed !== latest,
        installed,
        latest: latest || 'unknown',
        checked: Math.floor(Date.now() / 1000)
      };
      try { fs.writeFileSync(cacheFile, JSON.stringify(result)); } catch (e) {}
    });
  }).on('error', () => {
    // Network unavailable — write a no-update result so statusline stays clean
    try {
      fs.writeFileSync(cacheFile, JSON.stringify({
        update_available: false,
        installed,
        latest: 'unknown',
        checked: Math.floor(Date.now() / 1000)
      }));
    } catch (e) {}
  });
`], {
  stdio: 'ignore',
  windowsHide: true,
  detached: true  // Required on Windows for proper process detachment
});

child.unref();
