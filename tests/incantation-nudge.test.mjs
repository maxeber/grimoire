// Tests of nudge.mjs (the spoken permission nudge and the progress fallback): one fixed line, only
// while a listener's status file is fresh, a nudge at most once every 20 s, and nothing it is not
// told. The listener itself is never started: the test hands the script its `speak`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVERY_MS, FRESH_MS, LINES, MARKER, nudge } from '../skills/incantation/scripts/nudge.mjs';
import { observeDir, runDir, secureState, statusPath } from '../skills/incantation/scripts/lib.mjs';

const SCRIPT = fileURLToPath(new URL('../skills/incantation/scripts/nudge.mjs', import.meta.url));

function home(t) {
  const h = mkdtempSync(join(tmpdir(), 'incantation-nudge-'));
  t.after(() => rmSync(h, { recursive: true, force: true }));
  secureState(h);
  return h;
}
const fresh = (h, ago = 0) => {
  writeFileSync(statusPath(h), 'listening\n');
  const at = new Date(Date.now() - ago);
  utimesSync(statusPath(h), at, at);
};
const sayFile = (h, hex) => join(observeDir(h), `say-${hex}.txt`);

test('with a fresh status file a nudge writes its fixed line to a say file and speaks it once', t => {
  const h = home(t);
  fresh(h);
  const heard = [];
  assert.equal(nudge(h, 'nudge', hex => heard.push(hex)), 'spoke');
  assert.equal(heard.length, 1);
  assert.match(heard[0], /^[0-9a-f]{8}$/);
  assert.equal(readFileSync(sayFile(h, heard[0]), 'utf8'), 'I need your OK on screen.');
  assert.equal(LINES.nudge, 'I need your OK on screen.');
});

test('no listener, no nudge: a missing status file and one older than 10 s speak nothing and write nothing', t => {
  const h = home(t);
  const heard = [];
  assert.equal(nudge(h, 'nudge', hex => heard.push(hex)), 'no-listener');
  fresh(h, FRESH_MS + 1_000);
  assert.equal(nudge(h, 'nudge', hex => heard.push(hex)), 'no-listener');
  assert.equal(nudge(h, 'progress', hex => heard.push(hex)), 'no-listener');
  assert.deepEqual(heard, []);
  assert.equal(existsSync(join(runDir(h), MARKER)), false);
});

test('a nudge speaks at most once every 20 s; the second within the window is silent, one after it speaks', t => {
  const h = home(t);
  fresh(h);
  const heard = [];
  const now = Date.now();
  assert.equal(nudge(h, 'nudge', hex => heard.push(hex), now), 'spoke');
  assert.equal(nudge(h, 'nudge', hex => heard.push(hex), now + 5_000), 'too-soon');
  assert.equal(heard.length, 1);
  // The marker is older than the window: the status file is touched again, as the listener would.
  const old = new Date(now - EVERY_MS - 1_000);
  utimesSync(join(runDir(h), MARKER), old, old);
  fresh(h);
  assert.equal(nudge(h, 'nudge', hex => heard.push(hex), now), 'spoke');
  assert.equal(heard.length, 2);
});

test('the progress line is its own fixed words, and does not use the nudge\'s marker', t => {
  const h = home(t);
  fresh(h);
  const heard = [];
  assert.equal(nudge(h, 'progress', hex => heard.push(hex)), 'spoke');
  assert.equal(readFileSync(sayFile(h, heard[0]), 'utf8'), 'Still working on it.');
  assert.equal(existsSync(join(runDir(h), MARKER)), false);
  assert.equal(nudge(h, 'nudge', hex => heard.push(hex)), 'spoke');
});

test('any other word speaks nothing', t => {
  const h = home(t);
  fresh(h);
  const heard = [];
  for (const mode of ['', 'say hello', 'toString', '__proto__', undefined]) assert.equal(nudge(h, mode, hex => heard.push(hex)), 'no-listener');
  assert.deepEqual(heard, []);
});

test('run from the command line with no listener it exits 0 and touches nothing, whatever it is given', t => {
  const h = home(t);
  const env = { ...process.env, HOME: h, USERPROFILE: h };
  for (const args of [[], ['progress'], ['hello'], ['progress', 'extra']]) {
    execFileSync(process.execPath, [SCRIPT, ...args], { env, stdio: 'ignore' });
  }
  assert.equal(existsSync(join(runDir(h), MARKER)), false);
});
