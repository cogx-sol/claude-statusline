#!/usr/bin/env node
/**
 * Statusline Generator
 * Renders a single-line status header:
 *   banner + user + git branch (+ change/ahead-behind indicators) + model
 *   + session duration + context % + cost
 *
 * - Banner label: $STATUSLINE_LABEL env var, default "COGX".
 * - Model name : live from Claude Code's stdin payload (model.display_name),
 *                falling back to .claude.json's lastModelUsage lookup,
 *                then settings.json's `model` field, then "Claude Code".
 * - Session/cost/context: from the same stdin payload when present.
 *
 * Usage: node statusline.cjs [--json] [--compact]
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const CWD = process.cwd();
const BANNER_LABEL = process.env.STATUSLINE_LABEL || 'COGX';

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[0;31m',
  yellow: '\x1b[0;33m',
  blue: '\x1b[0;34m',
  purple: '\x1b[0;35m',
  cyan: '\x1b[0;36m',
  brightRed: '\x1b[1;31m',
  brightGreen: '\x1b[1;32m',
  brightYellow: '\x1b[1;33m',
  brightBlue: '\x1b[1;34m',
  brightPurple: '\x1b[1;35m',
  brightCyan: '\x1b[1;36m',
};

// ─── helpers ────────────────────────────────────────────────────

// execFileSync (no shell) eliminates injection class regardless of whether
// user input ever reaches these args, and avoids the "sh -c" mismatch on
// Windows where cmd.exe is the default shell.
function safeGit(args, timeoutMs = 2000) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf-8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { /* ignore */ }
  return null;
}

let _settingsCache;
function getSettings() {
  if (_settingsCache !== undefined) return _settingsCache;
  _settingsCache = readJSON(path.join(CWD, '.claude', 'settings.json'))
                || readJSON(path.join(CWD, '.claude', 'settings.local.json'))
                || null;
  return _settingsCache;
}

// ─── data collection ────────────────────────────────────────────

function getGitInfo() {
  const result = {
    name: 'user', gitBranch: '', modified: 0, untracked: 0,
    staged: 0, ahead: 0, behind: 0,
  };

  result.name      = safeGit(['config', 'user.name']) || 'user';
  result.gitBranch = safeGit(['branch', '--show-current']);

  const porcelain = safeGit(['status', '--porcelain']);
  if (porcelain) {
    for (const line of porcelain.split('\n')) {
      if (!line || line.length < 2) continue;
      const x = line[0], y = line[1];
      if (x === '?' && y === '?') { result.untracked++; continue; }
      if (x !== ' ' && x !== '?') result.staged++;
      if (y !== ' ' && y !== '?') result.modified++;
    }
  }

  const ab = safeGit(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  if (ab) {
    const [a, b] = ab.split(/\s+/);
    result.ahead = parseInt(a) || 0;
    result.behind = parseInt(b) || 0;
  }

  return result;
}

// File-based model detection (fallback when stdin payload is absent).
function getModelName() {
  try {
    const claudeConfig = readJSON(path.join(os.homedir(), '.claude.json'));
    if (claudeConfig && claudeConfig.projects) {
      for (const [projectPath, projectConfig] of Object.entries(claudeConfig.projects)) {
        if (CWD === projectPath || CWD.startsWith(projectPath + '/')) {
          const usage = projectConfig.lastModelUsage;
          if (usage) {
            const ids = Object.keys(usage);
            if (ids.length > 0) {
              let modelId = ids[ids.length - 1];
              let latest = 0;
              for (const id of ids) {
                const ts = usage[id] && usage[id].lastUsedAt ? new Date(usage[id].lastUsedAt).getTime() : 0;
                if (ts > latest) { latest = ts; modelId = id; }
              }
              if (modelId.includes('opus')) return 'Opus 4.7';
              if (modelId.includes('sonnet')) return 'Sonnet 4.6';
              if (modelId.includes('haiku')) return 'Haiku 4.5';
              return modelId.split('-').slice(1, 3).join(' ');
            }
          }
          break;
        }
      }
    }
  } catch { /* ignore */ }

  const settings = getSettings();
  if (settings && settings.model) {
    const m = settings.model;
    if (m.includes('opus')) return 'Opus 4.7';
    if (m.includes('sonnet')) return 'Sonnet 4.6';
    if (m.includes('haiku')) return 'Haiku 4.5';
  }
  return 'Claude Code';
}

// Session duration fallback when Claude Code doesn't pipe a cost block.
function getSessionStats() {
  for (const rel of ['.claude-flow/session.json', '.claude/session.json']) {
    const data = readJSON(path.join(CWD, rel));
    if (data && data.startTime) {
      const mins = Math.floor((Date.now() - new Date(data.startTime).getTime()) / 60000);
      const duration = mins < 60 ? mins + 'm' : Math.floor(mins / 60) + 'h' + (mins % 60) + 'm';
      return { duration };
    }
  }
  return { duration: '' };
}

// ─── stdin reader (Claude Code session payload) ─────────────────

let _stdinData;
function getStdinData() {
  if (_stdinData !== undefined) return _stdinData;
  _stdinData = null;
  if (process.stdin.isTTY) return _stdinData;
  try {
    const chunks = [];
    const buf = Buffer.alloc(4096);
    let bytesRead;
    try {
      while ((bytesRead = fs.readSync(0, buf, 0, buf.length, null)) > 0) {
        chunks.push(buf.slice(0, bytesRead));
      }
    } catch { /* EOF */ }
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    if (raw && raw.startsWith('{')) _stdinData = JSON.parse(raw);
  } catch { /* ignore */ }
  return _stdinData;
}

function getModelFromStdin() {
  const data = getStdinData();
  if (!data || !data.model) return null;
  if (typeof data.model === 'object') return data.model.display_name || data.model.id || null;
  if (typeof data.model === 'string') return data.model;
  return null;
}

function getContextFromStdin() {
  const data = getStdinData();
  if (data && data.context_window) {
    return {
      usedPct: Math.floor(data.context_window.used_percentage || 0),
      remainingPct: Math.floor(data.context_window.remaining_percentage || 100),
    };
  }
  return null;
}

function getCostFromStdin() {
  const data = getStdinData();
  if (data && data.cost) {
    const durationMs = data.cost.total_duration_ms || 0;
    const mins = Math.floor(durationMs / 60000);
    const secs = Math.floor((durationMs % 60000) / 1000);
    return {
      costUsd: data.cost.total_cost_usd || 0,
      duration: mins > 0 ? mins + 'm' + secs + 's' : secs + 's',
    };
  }
  return null;
}

// ─── rendering ──────────────────────────────────────────────────

// Renders the git branch block (branch name + change/ahead-behind indicators)
// as a single string, or '' when not in a repo.
function renderGit(git) {
  if (!git.gitBranch) return '';
  let out = c.brightBlue + '⏇ ' + git.gitBranch + c.reset;
  if (git.modified + git.staged + git.untracked > 0) {
    let ind = '';
    if (git.staged > 0)    ind += c.brightGreen  + '+' + git.staged    + c.reset;
    if (git.modified > 0)  ind += c.brightYellow + '~' + git.modified  + c.reset;
    if (git.untracked > 0) ind += c.dim          + '?' + git.untracked + c.reset;
    out += ' ' + ind;
  }
  if (git.ahead > 0)  out += ' ' + c.brightGreen + '↑' + git.ahead + c.reset;
  if (git.behind > 0) out += ' ' + c.brightRed   + '↓' + git.behind + c.reset;
  return out;
}

// Each segment is a function returning its rendered string, or '' to be
// omitted. Segments are joined left-to-right by `sep`, so a hidden segment
// never leaves a dangling divider. To add a new status, append a function
// here — order in the array is display order.
//
// Example — current directory:
//   () => c.dim + path.basename(CWD) + c.reset,
function buildSegments({ git, modelName, ctxInfo, costInfo, duration }) {
  return [
    // Banner + user — the leading segment carries no divider before it.
    () => c.bold + c.brightPurple + '▊ ' + BANNER_LABEL + ' ' + c.reset
        + c.brightCyan + git.name + c.reset,
    () => renderGit(git),
    () => c.purple + modelName + c.reset,
    () => duration ? c.cyan + '⏱ ' + duration + c.reset : '',
    () => {
      if (!ctxInfo || ctxInfo.usedPct <= 0) return '';
      const col = ctxInfo.usedPct >= 90 ? c.brightRed
                : ctxInfo.usedPct >= 70 ? c.brightYellow : c.brightGreen;
      return col + '● ' + ctxInfo.usedPct + '% ctx' + c.reset;
    },
    () => costInfo && costInfo.costUsd > 0
        ? c.brightYellow + '$' + costInfo.costUsd.toFixed(2) + c.reset : '',
    // ── add new statuses here ──
  ];
}

function generateStatusline() {
  const git = getGitInfo();
  const modelName = getModelFromStdin() || getModelName();
  const ctxInfo = getContextFromStdin();
  const costInfo = getCostFromStdin();
  const session = getSessionStats();
  const duration = costInfo ? costInfo.duration : session.duration;

  const sep = '  ' + c.dim + '│' + c.reset + '  ';
  return buildSegments({ git, modelName, ctxInfo, costInfo, duration })
    .map((fn) => fn())
    .filter(Boolean)
    .join(sep);
}

function generateJSON() {
  const git = getGitInfo();
  return {
    bannerLabel: BANNER_LABEL,
    user: { name: git.name, gitBranch: git.gitBranch, modelName: getModelFromStdin() || getModelName() },
    git: { modified: git.modified, untracked: git.untracked, staged: git.staged, ahead: git.ahead, behind: git.behind },
    context: getContextFromStdin(),
    cost: getCostFromStdin(),
    lastUpdated: new Date().toISOString(),
  };
}

// ─── main ───────────────────────────────────────────────────────

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(generateJSON(), null, 2));
} else if (process.argv.includes('--compact')) {
  console.log(JSON.stringify(generateJSON()));
} else {
  console.log(generateStatusline());
}
