// The capture adapter (docs/spec/incantation.md, S5.4): ffmpeg, one row per
// platform. Every platform-dependent line of capture lives in ROWS, and every
// function takes the platform as an argument, so each row runs on every
// runner. Nothing here reads the environment: the PATH value and the folder
// Claude Code started in come in from the caller.

import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { cleanText } from '../lib.mjs';

const DRIVE = /^[A-Za-z]:[\\/]/;

// The audio input lines a listing prints, as { name, id }.
function parseBracketed(text, { section }) {
  // dshow and avfoundation: lines tagged [dshow @ …], [AVFoundation indev @ …]
  // or, on newer builds, [in#0 @ …].
  const devices = [];
  let inAudio = section === null;
  let last = null;
  for (const line of String(text).split(/\r?\n/)) {
    const header = /(DirectShow|AVFoundation) (audio|video) devices/.exec(line);
    if (header) {
      inAudio = header[2] === 'audio';
      last = null;
      continue;
    }
    const alt = /Alternative name "(.*)"\s*$/.exec(line);
    if (alt) {
      if (last) last.id = alt[1];
      last = null;
      continue;
    }
    last = null;
    const quoted = /^\[(?:dshow|in#\d+)[^\]]*\]\s+"(.+)"(?:\s+\((audio|video|none)\))?\s*$/.exec(line);
    if (quoted) {
      const kind = quoted[2] ?? (inAudio ? 'audio' : 'video');
      if (kind !== 'audio') continue;
      last = { name: quoted[1], id: quoted[1] };
      devices.push(last);
      continue;
    }
    const indexed = /^\[(?:AVFoundation[^\]]*|in#\d+[^\]]*)\]\s+\[(\d{1,3})\]\s+(.+?)\s*$/.exec(line);
    if (indexed && inAudio) devices.push({ name: indexed[2], id: `:${indexed[1]}` });
  }
  return devices;
}

// pulse and alsa: `-sources` prints `  <id> [<description>]`, a `*` marking the default.
function parseSources(text) {
  const devices = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*\*?\s*(\S+)\s+\[(.*)\]\s*$/.exec(line);
    if (!m || /\.monitor$/.test(m[1])) continue; // a monitor records what plays
    devices.push({ name: m[2], id: m[1] });
  }
  return devices;
}

// One row per platform. `list` is the argument list that prints the devices;
// both stdout and stderr are read for it (dshow and avfoundation print to
// stderr, -sources to stdout). `input` turns a device id into the -f and -i
// arguments. Capture itself discards stderr.
export const ROWS = {
  win32: [{ input: id => ['-audio_buffer_size', '50', '-f', 'dshow', '-i', `audio=${id}`], list: ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], parse: t => parseBracketed(t, { section: 'audio' }) }],
  darwin: [{ input: id => ['-f', 'avfoundation', '-i', id], list: ['-hide_banner', '-list_devices', 'true', '-f', 'avfoundation', '-i', ''], parse: t => parseBracketed(t, { section: 'audio' }) }],
  linux: [
    { input: id => ['-f', 'pulse', '-i', id], list: ['-hide_banner', '-sources', 'pulse'], parse: parseSources },
    { input: id => ['-f', 'alsa', '-i', id], list: ['-hide_banner', '-sources', 'alsa'], parse: parseSources },
  ],
};

export const rowsFor = platform => ROWS[platform] ?? ROWS.linux;
export const recorderName = platform => (platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

// The list's stamp: a hash of every device's name and id, in order (590's rule).
export const stampOf = devices => createHash('sha256').update(JSON.stringify(devices.map(d => [d.name, d.id]))).digest('hex').slice(0, 16);

// A device that records what plays, not a mic: never a fallback (S5.5). Only a
// device whose name or id matches is skipped; another input may still carry other
// sound or hear the room (the README says so).
const LOOPBACK = /stereo mix|what u hear|wave out mix|loopback|monitor of|cable output|voicemeeter out|blackhole|soundflower|\.monitor/i;

// The mic to open: the saved one, found by the digest of its id, then of its
// name, wherever it now sits in the list; settings from before that (no id or
// name) by their stamp and index. When it is gone, the first mic that is not a
// loopback, as how 'fallback', so the first delivery can say which. `digest`
// turns a device's id or name into what settings.json keeps (S13.5).
export function pickDevice(devices, saved, digest = text => text) {
  const exact = (saved.id && devices.find(d => digest(d.id) === saved.id)) || (saved.name && devices.find(d => digest(d.name) === saved.name));
  if (exact) return { device: exact, how: 'saved' };
  if (!saved.id && !saved.name && stampOf(devices) === saved.stamp && devices[saved.index]) return { device: devices[saved.index], how: 'saved' };
  const other = devices.find(d => !LOOPBACK.test(d.name) && !LOOPBACK.test(d.id));
  return other ? { device: other, how: 'fallback' } : { device: null, how: null };
}

// A fallback mic's name as it reaches the chat (S13.5): letters, digits, spaces
// and ()-_. only, one space at a time, cut at 64.
export const fallbackName = name => {
  const clean = String(name).replace(/[^\p{L}\p{N} ()\-_.]/gu, '').replace(/ {2,}/g, ' ').trim();
  return [...clean].slice(0, 64).join('').trim() || 'another mic';
};

// What setup prints: the stamp, then one line per device, cleaned and cut at
// 64 characters, never an id or a path.
export const listingLines = devices => [`stamp ${stampOf(devices)}`, ...devices.map((d, i) => `${i} ${cleanText(d.name, 64)}`)];

// The arguments that capture the chosen device: 16 kHz mono signed 16-bit on stdout.
export const captureArgs = (platform, rowIndex, id) => ['-hide_banner', '-loglevel', 'error', '-nostdin', ...rowsFor(platform)[rowIndex].input(id), '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'];

// The devices the recorder lists, with the row that listed them: the first row
// whose listing parses to at least one device. `run(file, args)` resolves the
// listing's stdout and stderr joined, or null; it is the caller's, so the
// working folder and the spawn rule stay with it.
export async function listDevices({ recorder, platform, run }) {
  const rows = rowsFor(platform);
  for (let i = 0; i < rows.length; i++) {
    const out = await run(recorder, rows[i].list);
    if (out === null) continue;
    const devices = rows[i].parse(out);
    if (devices.length) return { row: i, devices };
  }
  return { row: -1, devices: [] };
}

const realFs = {
  isFile: p => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  },
  realpath: p => {
    try {
      return realpathSync.native(p);
    } catch {
      return null;
    }
  },
  lstat: p => lstatSync(p),
  uid: () => (typeof process.getuid === 'function' ? process.getuid() : -1),
};

const inside = (paths, parent, child) => {
  const rel = paths.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !paths.isAbsolute(rel));
};

// On macOS and Linux, the recorder and every folder above it must be owned by
// root or this account and writable by neither group nor others.
function trustedPosix(real, fs) {
  const me = fs.uid();
  for (let p = real; ; p = posix.dirname(p)) {
    let st;
    try {
      st = fs.lstat(p);
    } catch {
      return false;
    }
    if ((st.uid !== 0 && st.uid !== me) || (st.mode & 0o022) !== 0) return false;
    if (p === posix.dirname(p)) return true;
  }
}

// The recorder, by the platform's rule, as its real path, or null. Skipped on
// every platform: an empty or relative PATH entry, the current folder, and
// any entry inside the folder Claude Code started in. On Windows only fully
// qualified drive folders count, and the real path must still be a drive
// path (590's rule). On macOS and Linux only absolute entries count, and the
// recorder must pass the ownership rule.
export function resolveRecorder({ platform, pathValue, startDir, fs = realFs, name = recorderName(platform) }) {
  const paths = platform === 'win32' ? win32 : posix;
  const sep = platform === 'win32' ? ';' : ':';
  for (let entry of String(pathValue ?? '').split(sep)) {
    entry = entry.trim().replace(/^"(.*)"$/, '$1').trim();
    if (!entry || entry === '.') continue;
    if (platform === 'win32' ? !DRIVE.test(entry) : !posix.isAbsolute(entry)) continue;
    if (startDir && inside(paths, startDir, entry)) continue;
    const candidate = paths.join(entry, name);
    if (!fs.isFile(candidate)) continue;
    const real = fs.realpath(candidate);
    if (!real) continue;
    if (startDir && inside(paths, startDir, real)) continue;
    if (platform === 'win32') {
      if (DRIVE.test(real)) return real;
      continue;
    }
    if (trustedPosix(real, fs)) return real;
  }
  return null;
}
