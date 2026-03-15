#!/usr/bin/env node
// Check for Ship updates in background, write result to cache.
// Called by SessionStart hook - runs once per session.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function sanitizeId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    const sessionId = sanitizeId(data.session_id);

    // --- Session lock: detect concurrent sessions ---
    const tmpDir = os.tmpdir();
    const lockPath = path.join(tmpDir, 'claude-ship-session.lock');
    const STALE_HOURS = 4;

    if (sessionId) {
      let warnMsg = '';
      if (fs.existsSync(lockPath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
          const ageSeconds = Math.floor(Date.now() / 1000) - (existing.timestamp || 0);
          if (existing.session_id !== sessionId && ageSeconds < STALE_HOURS * 3600) {
            warnMsg = `WARNING: Another Claude session (${sanitizeId(existing.session_id)}) may still be active (started ${Math.round(ageSeconds / 60)} min ago). Concurrent sessions can cause state conflicts in .planning/ files. Proceed with caution.`;
          }
        } catch (e) {
          // Corrupted lock file, overwrite it
        }
      }

      // Write/overwrite lock with our session
      try {
        const lockData = JSON.stringify({
          session_id: sessionId,
          timestamp: Math.floor(Date.now() / 1000),
          pid: process.pid
        });
        fs.writeFileSync(lockPath, lockData);
      } catch (e) {
        // Best effort
      }

      // If there was a conflict, output a warning via hookSpecificOutput
      if (warnMsg) {
        const output = {
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: warnMsg
          }
        };
        process.stdout.write(JSON.stringify(output));
      }
    }

    // --- Update check (existing logic) ---
    const homeDir = os.homedir();
    const cacheDir = path.join(homeDir, '.claude', 'cache');
    const cacheFile = path.join(cacheDir, 'ship-update-check.json');
    const installedVersionFile = path.join(homeDir, '.claude', 'ship', 'VERSION');

    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const child = spawn(process.execPath, ['-e', `
      const fs = require('fs');
      const https = require('https');

      const cacheFile = process.env.SHIP_CACHE_FILE;
      const installedVersionFile = process.env.SHIP_VERSION_FILE;
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
          // Validate semver format to prevent false update banners
          if (!/^\\d+\\.\\d+\\.\\d+/.test(latest)) {
            try { fs.writeFileSync(cacheFile, JSON.stringify({
              update_available: false,
              installed,
              latest: 'unknown',
              checked: Math.floor(Date.now() / 1000)
            })); } catch (e) {}
            return;
          }
          const result = {
            update_available: !!latest && installed !== latest,
            installed,
            latest: latest || 'unknown',
            checked: Math.floor(Date.now() / 1000)
          };
          try { fs.writeFileSync(cacheFile, JSON.stringify(result)); } catch (e) {}
        });
      }).on('error', () => {
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
      env: { ...process.env, SHIP_CACHE_FILE: cacheFile, SHIP_VERSION_FILE: installedVersionFile },
      stdio: 'ignore',
      windowsHide: true,
      detached: true
    });

    child.unref();
  } catch (e) {
    // Silent fail -- never break session start
  }
});
