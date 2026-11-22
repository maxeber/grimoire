// A spoken line for the person, said without the session: grimoire's mod runs this, never the model.
//
//   node nudge.mjs           "I need your OK on screen.", when Claude Code is about to wait on a
//                            permission prompt; at most once every 20 seconds
//   node nudge.mjs progress  "Still working on it.", when a progress beat found no tool call to carry
//                            it (one long call); the mod runs it once per beat
//
// It speaks through the listener the way the session's own `say` does: a say file in the observe
// folder, then `listen.mjs say <8 hex>`. It never answers the prompt, takes no argument but the one
// word above, and with no live listener does nothing. With the voice muted the listener plays
// nothing, as for any line.

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { observeDir, runDir, secureState, statusPath } from './lib.mjs';

export const LINES = { nudge: 'I need your OK on screen.', progress: 'Still working on it.' };
export const FRESH_MS = 10_000; // the status file is touched every 2 s while a listener runs
export const EVERY_MS = 20_000;
export const MARKER = 'nudge.stamp';

/**
 * Says one fixed line, or nothing. `speak(hex)` runs `listen.mjs say <hex>`; the caller injects it so a
 * test never opens a listener. Returns what happened: `spoke`, `no-listener` or `too-soon`.
 */
export function nudge(home, mode, speak, now = Date.now()) {
  if (typeof mode !== 'string' || !Object.hasOwn(LINES, mode)) return 'no-listener';
  const line = LINES[mode];
  try {
    if (now - statSync(statusPath(home)).mtimeMs > FRESH_MS) return 'no-listener';
  } catch {
    return 'no-listener';
  }
  secureState(home);
  if (mode === 'nudge') {
    // A nudge within the last few seconds is enough: the marker's mtime says when.
    const marker = join(runDir(home), MARKER);
    try {
      if (now - statSync(marker).mtimeMs < EVERY_MS) return 'too-soon';
    } catch {
      // no marker yet
    }
    writeFileSync(marker, '');
  }
  const hex = randomBytes(4).toString('hex');
  writeFileSync(join(observeDir(home), `say-${hex}.txt`), line);
  speak(hex);
  return 'spoke';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , mode = 'nudge', ...rest] = process.argv;
  if (rest.length > 0 || !Object.hasOwn(LINES, mode)) process.exit(0);
  try {
    const script = join(dirname(fileURLToPath(import.meta.url)), 'listen.mjs');
    const out = nudge(homedir(), mode, hex => {
      execFile(process.execPath, [script, 'say', hex], { windowsHide: true, timeout: 100_000 }, () => process.exit(0));
    });
    if (out !== 'spoke') process.exit(0);
  } catch {
    process.exit(0);
  }
}
