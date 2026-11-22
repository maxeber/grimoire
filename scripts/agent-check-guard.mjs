#!/usr/bin/env node
// The hook behind .claude/settings.json (issue 377). Claude Code runs it before
// every Bash and PowerShell call, with the call as JSON on standard input.
// CONTRIBUTING.md makes `athanor run check` the default way to run the check
// and `node scripts/check.mjs` on the host the fallback, for when athanor is
// missing or a run ends with no result (exit 124, 125 or 137). An agent could
// still skip that order and nothing showed it, so this refuses the host check
// while athanor is on the machine, and says how to name the fallback:
// `--host-fallback=<reason>` on the same command. A direct `node --test` of the
// tests, bare or behind `mise x --` or `npx`, is the same run in pieces and
// gets the same refusal (GRIM-48).
//
// It does two things and no more. It reads the command as data, never runs it,
// and never changes it. It runs one program, `athanor --version`, and only
// when the command is a host run. It writes nothing and sends nothing.
//
// Everything that is not a refusal is silence: exit 0, nothing on standard
// output, nothing on standard error. That is deliberate. A hook that answers
// with an explicit allow skips the owner's permission prompt for the call, and
// silence leaves their rules in force. A bug in this file fails the same way,
// because a guard that fails closed would block all work in the repository.
// The threat model's R10, which is the owner's decision,
// says the rest: this is a nudge that shows a skip, not a control against
// running a branch's code on the host.

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { delimiter, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

// The refusal. Fixed text: nothing from the command is echoed into it, so a
// token in the command cannot come back out through it.
const REFUSAL = [
  'Run the check with `athanor run check` first.',
  'The host check, `node scripts/check.mjs`, is the fallback only when athanor is missing or its run produces no result (exit 124, 125 or 137).',
  'If that is why you are here, rerun the same command with `--host-fallback=<reason>`, name the reason and the exit code in it in your own words (no path, token or pasted error text), and say in your report that you used the fallback.',
  'athanor sends the tracked files, with uncommitted edits, to the Docker engine it is set to use, so run it only against a local engine, as CONTRIBUTING.md ("Run the check in a container") explains.',
].join(' ');

const FLAG = '--host-fallback=';

// The command as segments of tokens. Quotes are read first, so text inside
// them is one token of data; the body of a heredoc or a PowerShell here-string
// is skipped as data; and only then do `;`, `|`, `&&`, `||`, a lone `&`, a
// parenthesis, a brace and a line break end a segment. A backslash is a path
// character, not an escape, except before a double quote inside double quotes
// in Bash; PowerShell escapes with a backtick, so a path ending in a backslash
// inside double quotes closes there. A line continuation (a backslash in Bash,
// a backtick in PowerShell, then a line break) joins the two lines. An unclosed
// quote runs to the end of the command.
function segmentsOf(command, bash) {
  command = command.replace(bash ? /\\\r?\n/g : /`\r?\n/g, ' ');
  const segments = [];
  let tokens = [];
  let current = '';
  let started = false;
  let heredocs = [];
  const endToken = () => {
    if (started) tokens.push(current);
    current = '';
    started = false;
  };
  const endSegment = () => {
    endToken();
    if (tokens.length) segments.push(tokens);
    tokens = [];
  };
  const n = command.length;
  let i = 0;
  while (i < n) {
    const c = command[i];
    if (c === "'") {
      started = true;
      i++;
      while (i < n && command[i] !== "'") current += command[i++];
      i++;
    } else if (c === '"') {
      started = true;
      i++;
      while (i < n && command[i] !== '"') {
        if ((command[i] === (bash ? '\\' : '`') || (bash && command[i] === '`')) && command[i + 1] === '"') {
          current += '"';
          i += 2;
        } else current += command[i++];
      }
      i++;
    } else if ((c === '@' && (command[i + 1] === "'" || command[i + 1] === '"')) && /^[ \t]*\r?\n/.test(command.slice(i + 2))) {
      // A PowerShell here-string: its body runs to a line that opens with the
      // same quote and `@`.
      const close = command.indexOf(`\n${command[i + 1]}@`, i + 2);
      started = true;
      current += '@';
      i = close === -1 ? n : close + 3;
    } else if (c === '<' && command.startsWith('<<', i) && !command.startsWith('<<<', i)) {
      let j = i + 2;
      const strip = command[j] === '-';
      if (strip) j++;
      while (command[j] === ' ' || command[j] === '\t') j++;
      const quote = command[j] === "'" || command[j] === '"' ? command[j++] : '';
      let delimiter_ = '';
      while (j < n && !/[\s;|&()<>]/.test(command[j]) && command[j] !== quote) delimiter_ += command[j++];
      if (quote && command[j] === quote) j++;
      if (delimiter_) heredocs.push({ word: delimiter_, strip });
      endToken();
      tokens.push('<<');
      i = j;
    } else if (c === '\n') {
      endSegment();
      i++;
      // The bodies of the heredocs this line opened, in order.
      for (const { word, strip } of heredocs) {
        while (i < n) {
          const eol = command.indexOf('\n', i);
          const line = command.slice(i, eol === -1 ? n : eol).replace(/\r$/, '');
          i = eol === -1 ? n : eol + 1;
          if ((strip ? line.replace(/^\t+/, '') : line) === word) break;
        }
      }
      heredocs = [];
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endToken();
      i++;
    } else if (c === ';' || c === '|' || c === '(' || c === ')' || c === '{' || c === '}') {
      endSegment();
      i += command.startsWith('||', i) ? 2 : 1;
    } else if (c === '&') {
      if (current.endsWith('>') || command[i + 1] === '>') {
        // A redirect, `2>&1` or `&>`, is part of the word it sits in.
        started = true;
        current += c;
        i++;
      } else if (command.startsWith('&&', i)) {
        endSegment();
        i += 2;
      } else if (tokens.length === 0 && !started) {
        // PowerShell's call operator opens a command; it wraps, it does not end.
        tokens.push('&');
        i++;
      } else {
        endSegment();
        i++;
      }
    } else {
      started = true;
      current += c;
      i++;
    }
  }
  endSegment();
  return segments;
}

// Words that only wrap the command that follows them.
const WRAPPERS = new Set(['&', 'env', 'time', 'call']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const NODE = /^node(?:\.exe)?$/i;
const SCRIPT = /(?:^|\/)scripts\/check\.mjs$/i;

// What one segment is: not a host run, a host run, or a host run with a named
// fallback. A host run is the host check or a direct `node --test` (GRIM-48),
// bare, behind `mise x --` or behind `npx`. For the check, a token ending in
// scripts/check.mjs as whole path parts counts, in either slash, in any case;
// scripts/check.mjs.bak does not.
function classify(tokens) {
  let i = 0;
  for (;;) {
    const t = tokens[i];
    if (t === undefined) return 'other';
    if (WRAPPERS.has(t) || ASSIGNMENT.test(t)) i++;
    else if (t.startsWith('$') && tokens[i + 1] === '=') i += 2;
    else if (t === 'timeout') {
      i++;
      if (/^[\d.]+[smhd]?$/.test(tokens[i] ?? '')) i++;
    } else if (t === 'mise' && (tokens[i + 1] === 'x' || tokens[i + 1] === 'exec')) {
      // `mise x [tool@version ...] -- command`: the command follows the `--`.
      const dashes = tokens.indexOf('--', i + 2);
      if (dashes === -1) return 'other';
      i = dashes + 1;
    } else if (t === 'npx') {
      i++;
      while (tokens[i]?.startsWith('-')) i++;
    } else break;
  }
  const program = tokens[i].replace(/\\/g, '/').split('/').pop();
  if (!NODE.test(program)) return 'other';
  const rest = tokens.slice(i + 1);
  const isCheck = rest.some(t => !t.startsWith('-') && SCRIPT.test(t.replace(/\\/g, '/')));
  if (!isCheck && !runsTests(rest)) return 'other';
  return rest.some(t => t.startsWith(FLAG) && t.slice(FLAG.length).trim() !== '') ? 'named' : 'check';
}

// True when `--test` is one of node's own options: before the first word that
// does not start with a dash, which is the script or the first test file. A
// `--test` after the script's name belongs to the script.
function runsTests(args) {
  for (const t of args) {
    if (t === '--test') return true;
    if (!t.startsWith('-')) return false;
  }
  return false;
}

// The seam. Returns { reason } to refuse the call, and null for everything
// else. `athanorPresent` is called, and awaited, only after a segment of the
// command is a host run without a named fallback.
export async function decide(input, { athanorPresent }) {
  try {
    if (!input || typeof input !== 'object') return null;
    if (input.tool_name !== 'Bash' && input.tool_name !== 'PowerShell') return null;
    const command = input.tool_input?.command;
    if (typeof command !== 'string') return null;
    if (!segmentsOf(command, input.tool_name === 'Bash').some(s => classify(s) === 'check')) return null;
    return (await athanorPresent()) ? { reason: REFUSAL } : null;
  } catch {
    return null;
  }
}

const LIMIT_MS = 5000;

// True when `athanor --version` exits 0 and prints a version, within the time
// limit. A shim that dangles (mise says "athanor is not a valid shim" and
// exits 1), a missing program and a hang all mean athanor is missing, and the
// host check is the only way to run the check.
//
// The child inherits the session's environment, so it must be athanor. On
// Windows an npm install leaves a .cmd shim, which only a shell runs, so it
// goes through cmd.exe by absolute path, from the system folder, with the
// lookup in the current folder switched off: cmd would otherwise run a file of
// that name found in the working folder before it searched PATH. Elsewhere a
// PATH with an empty or relative entry means the same lookup, so it counts as
// missing and nothing runs. On the limit the child and the tree under it die.
export function probeAthanor({ env = process.env, platform = process.platform, limitMs = LIMIT_MS } = {}) {
  return new Promise(resolve => {
    const win = platform === 'win32';
    let file;
    let args;
    let cwd;
    let childEnv;
    let taskkill;
    if (win) {
      const named = Object.keys(env).find(k => k.toLowerCase() === 'systemroot');
      const system = join(named ? env[named] : 'C:\\Windows', 'System32');
      file = join(system, 'cmd.exe');
      taskkill = join(system, 'taskkill.exe');
      args = ['/d', '/s', '/c', 'athanor --version'];
      cwd = system;
      childEnv = { ...env, NoDefaultCurrentDirectoryInExePath: '1' };
    } else {
      if ((env.PATH ?? '').split(delimiter).some(d => d === '' || !posix.isAbsolute(d))) return resolve(false);
      file = 'athanor';
      args = ['--version'];
      cwd = '/';
      childEnv = env;
    }
    let child;
    try {
      child = spawn(file, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, detached: !win });
    } catch {
      return resolve(false);
    }
    let out = '';
    let settled = false;
    const settle = verdict => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.destroy();
      child.unref();
      resolve(verdict);
    };
    const timer = setTimeout(() => {
      try {
        if (win) spawnSync(taskkill, ['/t', '/f', '/pid', String(child.pid)], { stdio: 'ignore', windowsHide: true });
        else process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Nothing left to kill.
      }
      settle(false);
    }, limitMs);
    child.stdout.on('data', d => { if (out.length < 4096) out += d; });
    child.on('error', () => settle(false));
    child.on('close', code => settle(code === 0 && /^\d/.test(out.trim())));
  });
}

async function main() {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const refusal = await decide(input, { athanorPresent: () => probeAthanor() });
    if (refusal) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: refusal.reason },
      }));
    }
  } catch {
    // Silence, whatever went wrong.
  }
  process.exitCode = 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
