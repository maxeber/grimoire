// Tests of setup.mjs (docs/spec/incantation.md, S5.5; claim 16), with a fake
// engine, a made-up listing and a fake recorder file system.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { stampOf } from '../skills/incantation/scripts/capture/ffmpeg.mjs';
import { deviceDigest, keyPath, parseSettings, readKey, settingsPath } from '../skills/incantation/scripts/lib.mjs';
import { LINES, runSetup } from '../skills/incantation/scripts/setup.mjs';

const win = process.platform === 'win32';
const BIN = win ? 'C:\\fake\\bin' : '/fake/bin';
const RECORDER = win ? win32.join(BIN, 'ffmpeg.exe') : posix.join(BIN, 'ffmpeg');
const fs = { isFile: p => p === RECORDER, realpath: p => p, lstat: () => ({ uid: 0, mode: 0o40755 }), uid: () => 1000 };
const LISTING = {
  win32: '[in#0 @ 0] "Desk Mic One" (audio)\n[in#0 @ 0] "Headset Mic Two" (audio)\n',
  darwin: '[AVFoundation indev @ 0x1] AVFoundation audio devices:\n[AVFoundation indev @ 0x1] [0] Desk Mic One\n[AVFoundation indev @ 0x1] [1] Headset Mic Two\n',
  linux: '* made_up.one [Desk Mic One]\n  made_up.two [Headset Mic Two]\n',
}[process.platform] ?? '* made_up.one [Desk Mic One]\n  made_up.two [Headset Mic Two]\n';
const DEVICES = {
  win32: [{ name: 'Desk Mic One', id: 'Desk Mic One' }, { name: 'Headset Mic Two', id: 'Headset Mic Two' }],
  darwin: [{ name: 'Desk Mic One', id: ':0' }, { name: 'Headset Mic Two', id: ':1' }],
}[process.platform] ?? [{ name: 'Desk Mic One', id: 'made_up.one' }, { name: 'Headset Mic Two', id: 'made_up.two' }];
const STAMP = stampOf(DEVICES);
const engine = { profiles: async () => [{ id: 'made-up-profile-1', name: 'Calm Voice', engine: 'kokoro' }, { id: 'bad id!', name: 'x', engine: '' }] };

function setup(argv, over = {}) {
  const home = mkdtempSync(join(tmpdir(), 'incantation-setup-'));
  const done = runSetup(argv, { home, pathValue: BIN, startDir: home, fs, list: async () => LISTING, engine, ...over });
  return done.then(r => ({ ...r, home, remove: () => rmSync(home, { recursive: true, force: true }) }));
}

test('devices prints only the stamp and index-and-name lines, never an id or a path', async t => {
  const r = await setup(['devices']);
  t.after(r.remove);
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines, [`stamp ${STAMP}`, '0 Desk Mic One', '1 Headset Mic Two']);
  assert.ok(!r.lines.join('\n').includes(BIN));
});

test('profiles prints id, name and engine, and leaves out an id outside the settings range', async t => {
  const r = await setup(['profiles']);
  t.after(r.remove);
  assert.deepEqual(r.lines, ['made-up-profile-1 Calm Voice (kokoro)']);
});

test('choose writes settings whose every key is in range, with the pinned recorder and the mic as keyed digests (S13.5)', async t => {
  const r = await setup(['choose', '1', STAMP, 'made-up-profile-1']);
  t.after(r.remove);
  assert.deepEqual(r.lines, [LINES.saved]);
  const text = readFileSync(settingsPath(r.home), 'utf8');
  const s = parseSettings(text);
  const key = readKey(r.home);
  assert.ok(key, 'the key is made at the first choose');
  assert.deepEqual(s.device, { index: 1, stamp: STAMP, id: deviceDigest(key, DEVICES[1].id), name: deviceDigest(key, DEVICES[1].name) });
  assert.deepEqual({ ...s, device: null }, { engine: 'sherpa', port: 17493, endOfSpeechMs: 1500, profile: 'made-up-profile-1', device: null, recorder: RECORDER });
  assert.ok(!text.includes(DEVICES[1].name) && !text.includes(DEVICES[1].id), 'no device name or id is kept in the file');
  if (process.platform !== 'win32') assert.equal(statSync(keyPath(r.home)).mode & 0o777, 0o600);
});

test('a second choose keeps the key, so the digests stay comparable', async t => {
  const r = await setup(['choose', '1', STAMP, 'made-up-profile-1']);
  t.after(r.remove);
  const first = readKey(r.home);
  const again = await runSetup(['choose', '0', STAMP, 'made-up-profile-1'], { home: r.home, pathValue: BIN, startDir: r.home, fs, list: async () => LISTING, engine });
  assert.deepEqual(again.lines, [LINES.saved]);
  assert.deepEqual(readKey(r.home), first);
});

test('settings with a mic id or name that is not a digest, or an extra key, are refused', () => {
  const base = { profile: 'p', recorder: RECORDER };
  const device = d => JSON.stringify({ ...base, device: d });
  assert.doesNotThrow(() => parseSettings(device({ index: 0, stamp: STAMP })), 'settings from before');
  assert.doesNotThrow(() => parseSettings(device({ index: 0, stamp: STAMP, id: 'a'.repeat(64), name: 'b'.repeat(64) })));
  for (const bad of [{ id: 'Desk Mic One' }, { name: 'a'.repeat(63) }, { id: 'A'.repeat(64) }, { id: 5 }, { other: 'x' }]) assert.throws(() => parseSettings(device({ index: 0, stamp: STAMP, ...bad })), { message: 'settings' }, JSON.stringify(bad));
});

test('choose refuses a stale stamp, an out-of-range index, an unknown profile and a malformed call, writing nothing', async t => {
  const cases = [
    [['choose', '0', '0123456789abcdef', 'made-up-profile-1'], LINES.stale],
    [['choose', '7', STAMP, 'made-up-profile-1'], LINES.index],
    [['choose', '0', STAMP, 'not-a-profile'], LINES.profile],
    [['choose', '0', STAMP, '../x'], LINES.profile],
    [['choose', '0', STAMP], LINES.usage],
    [['choose', '-1', STAMP, 'made-up-profile-1'], LINES.usage],
  ];
  for (const [argv, line] of cases) {
    const r = await setup(argv);
    assert.deepEqual(r.lines, [line], argv.join(' '));
    assert.throws(() => readFileSync(settingsPath(r.home)));
    r.remove();
  }
});

test('no trusted recorder, no microphone, or no Voicebox each give a fixed line', async t => {
  for (const [argv, over, line] of [
    [['devices'], { pathValue: '' }, LINES.recorder],
    [['devices'], { list: async () => 'nothing here\n' }, LINES.devices],
    [['profiles'], { engine: { profiles: async () => null } }, LINES.voicebox],
  ]) {
    const r = await setup(argv, over);
    assert.deepEqual(r.lines, [line]);
    r.remove();
  }
});
