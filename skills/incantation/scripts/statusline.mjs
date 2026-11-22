// The listening indicator (docs/spec/incantation.md, trial amendment T9). A
// status line command for Claude Code: it prints one short segment that says
// whether the mic is open and what it is doing, or nothing when no listener is
// running. Node built-ins only; it reads one file and never writes.
//
//   node statusline.mjs   prints `mic: listening`, `mic: hearing`, `mic: thinking`,
//                         `mic: working`, `mic: speaking` or `mic: muted`, then
//                         ` voice: muted` while the listener's voice is muted, or nothing
//
// The listener touches its status file every 2 s, so a file older than 10 s is
// a listener that has gone, and prints nothing. Claude Code feeds a status line
// command a JSON document on stdin; this one ignores it.

import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { readText, statusPath, voicePath } from './lib.mjs';

export const WORDS = ['listening', 'hearing', 'thinking', 'working', 'speaking', 'muted'];
const FRESH_MS = 10_000;

// The segment for the home folder at time `now`, or ''.
export function segment(home, now = Date.now()) {
  try {
    const path = statusPath(home);
    if (now - statSync(path).mtimeMs > FRESH_MS) return '';
    const word = (readText(path, 64) ?? '').trim();
    if (!WORDS.includes(word)) return '';
    let voice = '';
    try {
      if ((readText(voicePath(home), 16) ?? '').trim() === 'muted') voice = ' voice: muted';
    } catch {
      // The voice file is a convenience: the mic's word stands without it.
    }
    return `mic: ${word}${voice}`;
  } catch {
    return '';
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(segment(homedir()), () => process.exit(0));
}
