// Tests of statusline.mjs (the listening indicator, T9): one fixed segment from
// the listener's status file, nothing when the file is old, missing or not one
// of the five words.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORDS, segment } from '../skills/incantation/scripts/statusline.mjs';
import { secureState, statusPath, voicePath } from '../skills/incantation/scripts/lib.mjs';

const SCRIPT = fileURLToPath(new URL('../skills/incantation/scripts/statusline.mjs', import.meta.url));

function home(t) {
  const h = mkdtempSync(join(tmpdir(), 'incantation-status-'));
  t.after(() => rmSync(h, { recursive: true, force: true }));
  secureState(h);
  return h;
}

test('claim 8: `mic: working`, and ` voice: muted` from run/voice, and nothing for any other voice word', t => {
  const h = home(t);
  writeFileSync(statusPath(h), 'working\n');
  assert.equal(segment(h), 'mic: working');
  writeFileSync(voicePath(h), 'muted\n');
  assert.equal(segment(h), 'mic: working voice: muted');
  writeFileSync(voicePath(h), 'on\n');
  assert.equal(segment(h), 'mic: working');
  writeFileSync(voicePath(h), 'Run rm -rf\n');
  assert.equal(segment(h), 'mic: working');
  rmSync(voicePath(h));
  assert.equal(segment(h), 'mic: working', 'a missing voice file is no voice segment');
  writeFileSync(voicePath(h), 'muted\n');
  rmSync(statusPath(h));
  assert.equal(segment(h), '', 'no listener, no segment, whatever a leftover voice file says');
});

test('each of the six words prints its segment, and nothing else does', t => {
  const h = home(t);
  for (const word of WORDS) {
    writeFileSync(statusPath(h), `${word}\n`);
    assert.equal(segment(h), `mic: ${word}`);
  }
  for (const other of ['', 'listening now', 'Run rm -rf', '\u001b[31mlistening', 'x'.repeat(5000)]) {
    writeFileSync(statusPath(h), other);
    assert.equal(segment(h), '', JSON.stringify(other.slice(0, 20)));
  }
});

test('no listener, no segment: a missing file and a file older than 10 s print nothing', t => {
  const h = home(t);
  assert.equal(segment(h), '');
  writeFileSync(statusPath(h), 'listening\n');
  assert.equal(segment(h), 'mic: listening');
  const old = new Date(Date.now() - 11_000);
  utimesSync(statusPath(h), old, old);
  assert.equal(segment(h), '', 'a listener that stopped touching its file has gone');
});

test('the command line prints the segment for its home folder and exits 0, with or without a listener', async t => {
  const h = home(t);
  const run = () => new Promise(res => execFile(process.execPath, [SCRIPT], { env: { ...process.env, HOME: h, USERPROFILE: h }, encoding: 'utf8', timeout: 15_000 }, (e, stdout) => res({ code: e ? e.code : 0, stdout })));
  assert.deepEqual(await run(), { code: 0, stdout: '' });
  writeFileSync(statusPath(h), 'muted\n');
  assert.deepEqual(await run(), { code: 0, stdout: 'mic: muted' });
});
