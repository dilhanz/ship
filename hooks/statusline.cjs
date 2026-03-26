#!/usr/bin/env node
// Claude Code Statusline - Ship Edition
// Shows: [update] model | task | dir@branch | tokens ctx% | thinking | 5h usage | 7d usage | extra

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const https = require('https');

// ── ANSI Colors (oh-my-posh theme) ──
const C = {
  blue: '\x1b[38;2;0;153;255m',
  orange: '\x1b[38;2;255;176;85m',
  green: '\x1b[38;2;0;160;0m',
  cyan: '\x1b[38;2;46;149;153m',
  red: '\x1b[38;2;255;85;85m',
  yellow: '\x1b[38;2;230;200;0m',
  white: '\x1b[38;2;220;220;220m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  blink: '\x1b[5m',
  reset: '\x1b[0m',
};
const SEP = ` ${C.dim}│${C.reset} `;

// ── Cache config ──
const CACHE_DIR = path.join(os.tmpdir(), 'claude');
const CACHE_FILE = path.join(CACHE_DIR, 'statusline-usage-cache.json');
const CACHE_MAX_AGE = 60; // seconds

// ── Formatting Helpers ──

function formatTokens(num) {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'm';
  if (num >= 1_000) return Math.round(num / 1_000) + 'k';
  return String(num);
}

function contextBar(pct) {
  const filled = Math.floor(pct / 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  if (pct < 63) return `${C.green}${bar} ${pct}%${C.reset}`;
  if (pct < 81) return `${C.yellow}${bar} ${pct}%${C.reset}`;
  if (pct < 95) return `${C.orange}${bar} ${pct}%${C.reset}`;
  return `${C.blink}${C.red}💀 ${bar} ${pct}%${C.reset}`;
}

function rateBar(pct, width = 6) {
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round(pct * width / 100);
  const empty = width - filled;
  let color;
  if (pct >= 90) color = C.red;
  else if (pct >= 70) color = C.yellow;
  else if (pct >= 50) color = C.orange;
  else color = C.green;
  return `${color}${'●'.repeat(filled)}${C.dim}${'○'.repeat(empty)}${C.reset}`;
}

function formatResetTime(isoStr) {
  if (!isoStr || isoStr === 'null') return '';
  try {
    const reset = new Date(isoStr);
    if (isNaN(reset.getTime())) return '';
    const now = Date.now();
    const diffMs = reset - now;
    if (diffMs <= 0) return '';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hrs}h${remMins}m` : `${hrs}h`;
  } catch (e) {
    return '';
  }
}

function writeFileAtomic(filePath, data) {
  const tmpPath = filePath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    // On Windows, rename can fail with EBUSY/EPERM if the target is locked
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      fs.writeFileSync(filePath, data);
    } else {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      throw e;
    }
  }
}

// ── Git Branch ──

function getGitBranch(cwd) {
  try {
    // Use cwd option instead of -C flag to avoid shell injection
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    return '';
  }
}

// ── Thinking Status ──

function getThinkingEnabled() {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return settings.alwaysThinkingEnabled === true;
  } catch (e) {
    return false;
  }
}

// ── OAuth Token Resolution ──
// Tries: env var → macOS Keychain → credentials file → Linux GNOME Keyring

function getOAuthToken() {
  // 1. Environment variable
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }

  // 2. macOS Keychain (uses execFileSync to avoid shell injection)
  if (process.platform === 'darwin') {
    try {
      const blob = execFileSync('security', [
        'find-generic-password', '-s', 'Claude Code-credentials', '-w',
      ], { encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (blob) {
        const token = JSON.parse(blob)?.claudeAiOauth?.accessToken;
        if (token && token !== 'null') return token;
      }
    } catch (e) {}
  }

  // 3. Credentials file
  try {
    const credsPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const token = JSON.parse(fs.readFileSync(credsPath, 'utf8'))?.claudeAiOauth?.accessToken;
    if (token && token !== 'null') return token;
  } catch (e) {}

  // 4. Linux GNOME Keyring
  if (process.platform === 'linux') {
    try {
      const blob = execFileSync('secret-tool', [
        'lookup', 'service', 'Claude Code-credentials',
      ], { encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (blob) {
        const token = JSON.parse(blob)?.claudeAiOauth?.accessToken;
        if (token && token !== 'null') return token;
      }
    } catch (e) {}
  }

  return null;
}

// ── Rate Limit Usage (cached) ──

function getCachedUsage() {
  try {
    const stat = fs.statSync(CACHE_FILE);
    const age = (Date.now() - stat.mtimeMs) / 1000;
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return { data, fresh: age < CACHE_MAX_AGE };
  } catch (e) {
    return { data: null, fresh: false };
  }
}

function fetchUsage(token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
      timeout: 3000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function getUsageData() {
  const { data: cached, fresh } = getCachedUsage();
  if (fresh && cached) return cached;

  const token = getOAuthToken();
  if (token) {
    try {
      const data = await fetchUsage(token);
      if (data && typeof data === 'object') {
        try {
          fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
          writeFileAtomic(CACHE_FILE, JSON.stringify(data));
        } catch (e) {}
        return data;
      }
    } catch (e) {}
  }

  return cached; // fall back to stale cache
}

function formatUsageSegments(usage) {
  if (!usage) return '';
  const segments = [];

  // 5-hour window
  if (usage.five_hour) {
    const pct = Math.round(usage.five_hour.utilization || 0);
    const bar = rateBar(pct);
    const reset = formatResetTime(usage.five_hour.resets_at);
    let seg = `${C.white}5h${C.reset} ${bar} ${C.cyan}${pct}%${C.reset}`;
    if (reset) seg += ` ${C.dim}@${reset}${C.reset}`;
    segments.push(seg);
  }

  // 7-day window
  if (usage.seven_day) {
    const pct = Math.round(usage.seven_day.utilization || 0);
    const bar = rateBar(pct);
    const reset = formatResetTime(usage.seven_day.resets_at);
    let seg = `${C.white}7d${C.reset} ${bar} ${C.cyan}${pct}%${C.reset}`;
    if (reset) seg += ` ${C.dim}@${reset}${C.reset}`;
    segments.push(seg);
  }

  // Extra usage credits
  if (usage.extra_usage && usage.extra_usage.is_enabled) {
    const pct = Math.round(usage.extra_usage.utilization || 0);
    const spent = ((usage.extra_usage.used_credits || 0) / 100).toFixed(2);
    const limit = ((usage.extra_usage.monthly_limit || 0) / 100).toFixed(2);
    const bar = rateBar(pct);
    segments.push(`${C.white}extra${C.reset} ${bar} ${C.cyan}$${spent}/$${limit}${C.reset}`);
  }

  return segments.join(SEP);
}

// ── Current Task (Ship-specific) ──

function getCurrentTask(session) {
  const todosDir = path.join(os.homedir(), '.claude', 'todos');
  if (!session || !fs.existsSync(todosDir)) return '';
  try {
    const files = fs.readdirSync(todosDir)
      .filter(f => f.startsWith(session) && f.includes('-agent-') && f.endsWith('.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(todosDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > 0) {
      const todos = JSON.parse(fs.readFileSync(path.join(todosDir, files[0].name), 'utf8'));
      const inProgress = todos.find(t => t.status === 'in_progress');
      if (inProgress) return inProgress.activeForm || '';
    }
  } catch (e) {}
  return '';
}

// ── Ship Update Check ──

function getShipUpdate() {
  try {
    const cacheFile = path.join(os.homedir(), '.claude', 'cache', 'ship-update-check.json');
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (cache.update_available) return `${C.yellow}⬆ /ship-update${C.reset}`;
  } catch (e) {}
  return '';
}

// ── Context Bridge (for context-monitor hook) ──

function writeContextBridge(session, remaining, usedPct) {
  if (!session) return;
  try {
    const bridgePath = path.join(os.tmpdir(), `claude-ctx-${session}.json`);
    writeFileAtomic(bridgePath, JSON.stringify({
      session_id: session,
      remaining_percentage: remaining,
      used_pct: usedPct,
      timestamp: Math.floor(Date.now() / 1000),
    }));
  } catch (e) {}
}

// ── Main ──

async function main() {
  if (!input.trim()) {
    process.stdout.write('Claude');
    return;
  }

  const data = JSON.parse(input);
  const model = data.model?.display_name || 'Claude';
  const dir = data.cwd || data.workspace?.current_dir || process.cwd();
  const session = String(data.session_id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const dirname = path.basename(dir);

  // Token counts
  const windowSize = data.context_window?.context_window_size || 200000;
  const inputTokens = data.context_window?.current_usage?.input_tokens || 0;
  const cacheCreate = data.context_window?.current_usage?.cache_creation_input_tokens || 0;
  const cacheRead = data.context_window?.current_usage?.cache_read_input_tokens || 0;
  const totalUsed = inputTokens + cacheCreate + cacheRead;

  // Context percentage (scaled to 80% limit like original Ship statusline)
  const remaining = data.context_window?.remaining_percentage;
  let usedPct = 0;
  if (remaining != null) {
    const rawUsed = Math.max(0, Math.min(100, 100 - Math.round(remaining)));
    usedPct = Math.min(100, Math.round((rawUsed / 80) * 100));
    writeContextBridge(session, remaining, usedPct);
  } else if (windowSize > 0) {
    usedPct = Math.min(100, Math.round((totalUsed / (windowSize * 0.8)) * 100));
  }

  // Gather sync data
  const branch = getGitBranch(dir);
  const thinking = getThinkingEnabled();
  const task = getCurrentTask(session);
  const shipUpdate = getShipUpdate();

  // Fetch rate limits (async, cached)
  let usageSegment = '';
  try {
    const usage = await getUsageData();
    usageSegment = formatUsageSegments(usage);
  } catch (e) {}

  // ── Build output ──
  const parts = [];

  if (shipUpdate) parts.push(shipUpdate);

  // Model
  parts.push(`${C.blue}${model}${C.reset}`);

  // Current task (Ship-specific)
  if (task) parts.push(`${C.bold}${task}${C.reset}`);

  // Directory@Branch
  let dirSeg = `${C.cyan}${dirname}${C.reset}`;
  if (branch) dirSeg += `${C.dim}@${C.reset}${C.green}${branch}${C.reset}`;
  parts.push(dirSeg);

  // Tokens + context bar
  const tokensStr = `${C.orange}${formatTokens(totalUsed)}/${formatTokens(windowSize)}${C.reset}`;
  parts.push(`${tokensStr} ${contextBar(usedPct)}`);

  // Thinking (only shown when on)
  if (thinking) {
    parts.push(`${C.dim}think${C.reset} ${C.orange}on${C.reset}`);
  }

  // Rate limits
  if (usageSegment) parts.push(usageSegment);

  process.stdout.write(parts.join(SEP));
}

// ── Entry ──
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  main().catch(() => {});
});
