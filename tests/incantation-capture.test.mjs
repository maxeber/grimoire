// Tests of capture/ffmpeg.mjs (docs/spec/incantation.md, S5.4; claim 13). Each
// platform's row is picked by a passed-in platform value, so every row runs on
// every runner. Every listing here is made up: invented names and ids, no real
// device, no path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureArgs, fallbackName, listDevices, listingLines, pickDevice, resolveRecorder, rowsFor, stampOf } from '../skills/incantation/scripts/capture/ffmpeg.mjs';
import { deviceDigest } from '../skills/incantation/scripts/lib.mjs';

// What each row's listing command prints, on the stream it prints it to.
const LISTINGS = {
  win32: {
    stderr: [
      '[dshow @ 0000] DirectShow video devices (some may be both video and audio devices)',
      '[dshow @ 0000]  "Made Up Camera"',
      '[dshow @ 0000] DirectShow audio devices',
      '[dshow @ 0000]  "Desk Mic One"',
      '[dshow @ 0000]     Alternative name "@device_cm_{MADEUP-1}"',
      '[in#0 @ 0000] "Headset Mic Two" (audio)',
      '[in#0 @ 0000]   Alternative name "@device_cm_{MADEUP-2}"',
      '[in#0 @ 0000] "Made Up Camera Two" (video)',
      'dummy: Immediate exit requested',
    ].join('\r\n'),
    want: [
      { name: 'Desk Mic One', id: '@device_cm_{MADEUP-1}' },
      { name: 'Headset Mic Two', id: '@device_cm_{MADEUP-2}' },
    ],
  },
  darwin: {
    stderr: ['[AVFoundation indev @ 0x1] AVFoundation video devices:', '[AVFoundation indev @ 0x1] [0] Made Up Camera', '[AVFoundation indev @ 0x1] AVFoundation audio devices:', '[AVFoundation indev @ 0x1] [0] Desk Mic One', '[AVFoundation indev @ 0x1] [1] Headset Mic Two'].join('\n'),
    want: [
      { name: 'Desk Mic One', id: ':0' },
      { name: 'Headset Mic Two', id: ':1' },
    ],
  },
  linux: {
    stdout: ['Auto-detected sources for pulse:', '* made_up.analog-stereo [Desk Mic One]', '  made_up.analog-stereo.monitor [Monitor of Speakers]', '  made_up.usb-mic [Headset Mic Two]'].join('\n'),
    want: [
      { name: 'Desk Mic One', id: 'made_up.analog-stereo' },
      { name: 'Headset Mic Two', id: 'made_up.usb-mic' },
    ],
  },
};

for (const platform of ['win32', 'darwin', 'linux']) {
  test(`${platform}: the row's listing parses from the stream ffmpeg prints it to, and capture uses the row's input`, async () => {
    const l = LISTINGS[platform];
    const run = async (file, args) => {
      assert.deepEqual(args, rowsFor(platform)[0].list);
      return `${l.stdout ?? ''}\n${l.stderr ?? ''}`;
    };
    const { row, devices } = await listDevices({ recorder: 'ffmpeg', platform, run });
    assert.equal(row, 0);
    assert.deepEqual(devices, l.want);
    const args = captureArgs(platform, row, devices[0].id);
    assert.deepEqual(args.slice(-7), ['-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1']);
    const fmt = { win32: 'dshow', darwin: 'avfoundation', linux: 'pulse' }[platform];
    assert.equal(args[args.indexOf('-f') + 1], fmt);
  });
}

test('linux falls back to alsa when pulse lists nothing', async () => {
  const run = async (file, args) => (args.includes('pulse') ? 'Cannot list sources: not implemented\n' : 'Auto-detected sources for alsa:\n  hw:CARD=Made,DEV=0 [Made Up Card]\n');
  const { row, devices } = await listDevices({ recorder: 'ffmpeg', platform: 'linux', run });
  assert.equal(row, 1);
  assert.deepEqual(devices, [{ name: 'Made Up Card', id: 'hw:CARD=Made,DEV=0' }]);
  assert.equal(captureArgs('linux', 1, devices[0].id).includes('alsa'), true);
});

test('the listing lines show the stamp and cleaned names cut at 64, never an id', () => {
  const devices = [{ name: `Mic\u0007 ${'x'.repeat(80)}`, id: '@device_secret_id' }];
  const lines = listingLines(devices);
  assert.equal(lines[0], `stamp ${stampOf(devices)}`);
  assert.match(lines[0], /^stamp [0-9a-f]{16}$/);
  assert.equal(lines[1], `0 ${`Mic ${'x'.repeat(80)}`.slice(0, 64)}`);
  assert.ok(!lines.join('\n').includes('@device_secret_id'));
  assert.notEqual(stampOf(devices), stampOf([{ name: 'Mic', id: 'other' }]));
});

// A file system for the resolver: `files` maps a path to its real path, and
// `meta` gives a path's owner and mode (POSIX only).
const fsOf = (files, meta = {}) => ({
  isFile: p => Object.hasOwn(files, p),
  realpath: p => files[p] ?? null,
  lstat: p => meta[p] ?? { uid: 0, mode: 0o40755 },
  uid: () => 1000,
});

test('windows: only fully qualified drive folders count, and the real path must still be a drive path', () => {
  const fs = fsOf({ 'D:\\tools\\ffmpeg.exe': 'D:\\tools\\ffmpeg.exe', 'E:\\link\\ffmpeg.exe': '\\\\server\\share\\ffmpeg.exe', 'C:\\proj\\bin\\ffmpeg.exe': 'C:\\proj\\bin\\ffmpeg.exe', 'C:\\ok\\ffmpeg.exe': 'C:\\ok\\ffmpeg.exe' });
  const pathValue = ['.', '', 'bin', 'C:relative', '\\rooted', '\\\\server\\share', 'E:\\link', 'C:\\proj\\bin', '"D:\\tools"'].join(';');
  assert.equal(resolveRecorder({ platform: 'win32', pathValue, startDir: 'C:\\proj', fs }), 'D:\\tools\\ffmpeg.exe');
  assert.equal(resolveRecorder({ platform: 'win32', pathValue: 'C:\\proj\\bin;E:\\link', startDir: 'C:\\proj', fs }), null, 'the start folder and a share are refused');
  assert.equal(resolveRecorder({ platform: 'win32', pathValue: 'C:\\ok', startDir: 'C:\\proj', fs }), 'C:\\ok\\ffmpeg.exe');
});

test('posix: a relative, empty or current-folder entry, or one inside the start folder, is never used', () => {
  const fs = fsOf({ '/proj/bin/ffmpeg': '/proj/bin/ffmpeg', '/usr/bin/ffmpeg': '/usr/bin/ffmpeg' });
  assert.equal(resolveRecorder({ platform: 'linux', pathValue: '.::bin:/proj/bin:/usr/bin', startDir: '/proj', fs }), '/usr/bin/ffmpeg');
  assert.equal(resolveRecorder({ platform: 'darwin', pathValue: '/proj/bin', startDir: '/proj', fs }), null);
});

test('posix: a recorder in a group- or other-writable folder, or owned by another account, is refused', () => {
  const files = { '/opt/x/bin/ffmpeg': '/opt/x/bin/ffmpeg' };
  const ok = { uid: 0, mode: 0o40755 };
  const base = { '/': ok, '/opt': ok, '/opt/x': ok, '/opt/x/bin': ok, '/opt/x/bin/ffmpeg': { uid: 0, mode: 0o100755 } };
  const resolve = meta => resolveRecorder({ platform: 'linux', pathValue: '/opt/x/bin', startDir: '/proj', fs: fsOf(files, { ...base, ...meta }) });
  assert.equal(resolve({}), '/opt/x/bin/ffmpeg');
  assert.equal(resolve({ '/opt/x/bin/ffmpeg': { uid: 1000, mode: 0o100755 } }), '/opt/x/bin/ffmpeg', 'owned by this account');
  assert.equal(resolve({ '/opt/x': { uid: 0, mode: 0o40775 } }), null, 'a group-writable folder above it');
  assert.equal(resolve({ '/opt/x/bin': { uid: 0, mode: 0o40757 } }), null, 'an other-writable folder');
  assert.equal(resolve({ '/opt/x/bin/ffmpeg': { uid: 501, mode: 0o100755 } }), null, 'owned by another account');
  assert.equal(resolve({ '/opt/x/bin/ffmpeg': { uid: 0, mode: 0o100775 } }), null, 'a group-writable file');
});

test('a relative or current-folder entry is refused by the rule itself, though a file sits there with an acceptable real path', () => {
  const ok = 'D:\\ok\\ffmpeg.exe';
  const win = fsOf({ 'ffmpeg.exe': ok, 'bin\\ffmpeg.exe': ok, 'C:relative\\ffmpeg.exe': ok, '.\\ffmpeg.exe': ok });
  for (const entry of ['.', '', 'bin', 'C:relative']) assert.equal(resolveRecorder({ platform: 'win32', pathValue: entry, startDir: 'C:\\proj', fs: win }), null, JSON.stringify(entry));
  const posix = fsOf({ ffmpeg: '/opt/ok/ffmpeg', 'bin/ffmpeg': '/opt/ok/ffmpeg', './ffmpeg': '/opt/ok/ffmpeg' });
  for (const entry of ['.', '', 'bin']) assert.equal(resolveRecorder({ platform: 'linux', pathValue: entry, startDir: '/proj', fs: posix }), null, JSON.stringify(entry));
});

// The mic to open (S5.5, claim 7): the saved one by id, then by name, wherever it
// now sits; settings from before by stamp and index; else the first mic that is
// not a loopback, said so. The id and name are compared as keyed digests (S13.5).
const KEY = Buffer.alloc(32, 7);
const dig = text => deviceDigest(KEY, text);
const LISTS = {
  win32: [
    { name: 'Stereo Mix (Made Up Audio)', id: '@device_cm_{LOOP}' },
    { name: 'Desk Mic One', id: '@device_cm_{ONE}' },
    { name: 'Headset Mic Two', id: '@device_cm_{TWO}' },
  ],
  darwin: [
    { name: 'BlackHole 2ch', id: ':0' },
    { name: 'Desk Mic One', id: ':1' },
    { name: 'Headset Mic Two', id: ':2' },
  ],
  linux: [
    { name: 'Made Up Speakers', id: 'made_up.analog-stereo.monitor' },
    { name: 'Desk Mic One', id: 'made_up.analog-mono' },
    { name: 'Headset Mic Two', id: 'made_up.usb-mic' },
  ],
};
const OLD = 'f'.repeat(16);

for (const [platform, list] of Object.entries(LISTS)) {
  test(`${platform}: pickDevice finds the saved mic by id, by name, by stamp and index, and falls back to a mic that is not a loopback`, () => {
    const two = list[2];
    // By id, wherever it sits now.
    const moved = [list[2], list[0], list[1]];
    assert.deepEqual(pickDevice(moved, { index: 2, stamp: OLD, id: dig(two.id), name: dig('another name') }, dig), { device: two, how: 'saved' });
    // By name, when the id changed.
    assert.deepEqual(pickDevice(list, { index: 0, stamp: OLD, id: dig('gone'), name: dig(two.name) }, dig), { device: two, how: 'saved' });
    // Settings from before (no id, no name): the stamp and the index.
    assert.deepEqual(pickDevice(list, { index: 2, stamp: stampOf(list) }, dig), { device: two, how: 'saved' });
    assert.equal(pickDevice(list, { index: 2, stamp: OLD }, dig).how, 'fallback', 'a changed list and nothing else to look for');
    // Gone: the first device that is not a loopback, never the loopback.
    assert.deepEqual(pickDevice(list, { index: 1, stamp: OLD, id: dig('gone'), name: dig('also gone') }, dig), { device: list[1], how: 'fallback' });
    // Only loopbacks: no device at all.
    assert.deepEqual(pickDevice([list[0]], { index: 0, stamp: OLD, id: dig('gone') }, dig), { device: null, how: null });
  });
}

test('a saved mic that is itself named like a loopback is still the one the person chose', () => {
  const list = LISTS.win32;
  assert.deepEqual(pickDevice(list, { index: 0, stamp: OLD, id: dig(list[0].id) }, dig), { device: list[0], how: 'saved' });
});

test('a fallback name that reaches the chat is kept to letters, digits, spaces and ()-_. and cut at 64', () => {
  assert.equal(fallbackName('Mic "One" \\ (USB)_x-y.z\u0007 <b>'), 'Mic One (USB)_x-y.z b');
  assert.equal(fallbackName('x'.repeat(80)).length, 64);
  assert.equal(fallbackName('"\\'), 'another mic', 'a name with nothing left says so');
});
