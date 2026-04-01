#!/usr/bin/env node
// Claude Code Statusline - Ship Edition
// Shows: model | task | dir@branch | tokens ctx% | thinking | 5h usage | 7d usage | extra

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

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
const CACHE_DIR = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'claude-ship');

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

function formatResetTime(epochSecs) {
  if (!epochSecs) return '';
  try {
    const now = Date.now() / 1000;
    const diffSecs = epochSecs - now;
    if (diffSecs <= 0) return '';
    const mins = Math.floor(diffSecs / 60);
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

// ── Context Bridge (for context-monitor hook) ──

function writeContextBridge(session, remaining, usedPct) {
  if (!session) return;
  try {
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) {}
    const bridgePath = path.join(CACHE_DIR, `claude-ctx-${session}.json`);
    writeFileAtomic(bridgePath, JSON.stringify({
      session_id: session,
      remaining_percentage: remaining,
      used_pct: usedPct,
      timestamp: Math.floor(Date.now() / 1000),
    }));
  } catch (e) {}
}

// ── Rate Limit Formatting ──

function formatRateLimits(rateLimits) {
  if (!rateLimits) return '';
  const segments = [];

  // 5-hour window
  if (rateLimits.five_hour) {
    const pct = Math.round(rateLimits.five_hour.used_percentage || 0);
    const bar = rateBar(pct);
    const reset = formatResetTime(rateLimits.five_hour.resets_at);
    let seg = `${C.white}5h${C.reset} ${bar} ${C.cyan}${pct}%${C.reset}`;
    if (reset) seg += ` ${C.dim}@${reset}${C.reset}`;
    segments.push(seg);
  }

  // 7-day window
  if (rateLimits.seven_day) {
    const pct = Math.round(rateLimits.seven_day.used_percentage || 0);
    const bar = rateBar(pct);
    const reset = formatResetTime(rateLimits.seven_day.resets_at);
    let seg = `${C.white}7d${C.reset} ${bar} ${C.cyan}${pct}%${C.reset}`;
    if (reset) seg += ` ${C.dim}@${reset}${C.reset}`;
    segments.push(seg);
  }

  return segments.join(SEP);
}

// ── Main ──

function main() {
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

  // Context percentage — prefer pre-calculated used_percentage from new schema
  let usedPct = 0;
  const remaining = data.context_window?.remaining_percentage;
  if (data.context_window?.used_percentage != null) {
    usedPct = Math.round(data.context_window.used_percentage);
    writeContextBridge(session, remaining, usedPct);
  } else if (remaining != null) {
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

  // Rate limits — read directly from input (new schema provides these)
  const rateLimitSegment = formatRateLimits(data.rate_limits);

  // ── Build output ──
  const parts = [];

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
  if (rateLimitSegment) parts.push(rateLimitSegment);

  // Cost (if available)
  if (data.cost?.total_cost_usd != null && data.cost.total_cost_usd > 0) {
    parts.push(`${C.dim}$${C.reset}${C.yellow}${data.cost.total_cost_usd.toFixed(2)}${C.reset}`);
  }

  process.stdout.write(parts.join(SEP));
}

// ── Entry ──
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try { main(); } catch (e) {}
});
