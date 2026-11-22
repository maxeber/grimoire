// Shared by the Incantation scripts. No dependencies: node built-ins only.
// Nothing here reads the environment or the working folder: each caller hands
// in the home folder, and the platform when it matters.

import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, relative, isAbsolute, sep } from 'node:path';

// The state folder and the two inside it (docs/spec/incantation.md, S5.5, and
// its trial amendments). It sits beside eagle-eye's, in the grimoire folder.
export const grimoireDir = home => join(home, '.grimoire');
export const stateDir = home => join(grimoireDir(home), 'incantation');
export const runDir = home => join(stateDir(home), 'run');
export const observeDir = home => join(stateDir(home), 'observe');
export const settingsPath = home => join(stateDir(home), 'settings.json');
export const statusPath = home => join(runDir(home), 'status');
export const voicePath = home => join(runDir(home), 'voice'); // `muted` or `on`, while a listener runs (S5.6)
export const keyPath = home => join(stateDir(home), 'key'); // the key the mic digests are made with (S13.5)
export const levelsPath = home => join(runDir(home), 'levels');
export const commandPath = home => join(runDir(home), 'command');

const posix = platform => platform !== 'win32';

// A file larger than this is not one of ours. A read past it fails. A caller
// reading a file it does not own (Claude Code's config) passes its own cap.
const MAX_FILE = 1_000_000;
export const MAX_CONFIG = 64_000_000;

// The bytes of a file, or null when it is not there. Any other error, and a
// file over the cap, throws: a file the caller cannot read is not an absent one.
export function readBuffer(path, max = MAX_FILE) {
  let st;
  try {
    st = statSync(path);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
  if (!st.isFile() || st.size > max) throw new Error('unreadable');
  return readFileSync(path);
}

export function readText(path, max) {
  const bytes = readBuffer(path, max);
  return bytes === null ? null : bytes.toString('utf8');
}

// Control, invisible and line-separator characters, removed from any text a
// script prints or keeps.
const HIDDEN = /[\x00-\x1F\x7F-\x9F\u{2028}\u{2029}\u{FFFE}\u{FFFF}\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/gu;
export const cleanText = (text, max = 500) => [...String(text).replace(HIDDEN, '').trim()].slice(0, max).join('');

const inside = (parent, child) => {
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
};

// One folder of the state tree, made or checked (S5.5): never a link or a
// junction, its real path inside the real home, and on macOS and Linux mode
// 0700, made so before anything is written and refused when found looser.
// Throws Error('state') on any failure.
export function secureFolder(home, path, { platform = process.platform, create = true } = {}) {
  const fail = () => {
    throw new Error('state');
  };
  let st;
  try {
    st = lstatSync(path);
  } catch (e) {
    if (e.code !== 'ENOENT' || !create) return fail();
    try {
      mkdirSync(path, { mode: 0o700 });
      if (posix(platform)) chmodSync(path, 0o700);
      st = lstatSync(path);
    } catch {
      return fail();
    }
  }
  if (st.isSymbolicLink() || !st.isDirectory()) fail();
  let realHome;
  let real;
  try {
    realHome = realpathSync(home);
    real = realpathSync(path);
  } catch {
    return fail();
  }
  if (!inside(realHome, real) || real === realHome) fail();
  if (posix(platform) && (st.mode & 0o077) !== 0) fail();
}

// The grimoire folder, shared with the other skills that keep files there, so
// it is held to less than ours: a plain folder, not a link or a junction, its
// real path inside the real home. Its mode is left as its owner made it. Made
// 0700 when it is missing. Throws Error('state') on any failure.
export function plainGrimoire(home, { platform = process.platform, create = true } = {}) {
  const fail = () => {
    throw new Error('state');
  };
  const path = grimoireDir(home);
  let st;
  try {
    st = lstatSync(path);
  } catch (e) {
    if (e.code !== 'ENOENT' || !create) return fail();
    try {
      mkdirSync(path, { mode: 0o700 });
      if (posix(platform)) chmodSync(path, 0o700);
      st = lstatSync(path);
    } catch {
      return fail();
    }
  }
  if (st.isSymbolicLink() || !st.isDirectory()) fail();
  try {
    const real = realpathSync(path);
    if (!inside(realpathSync(home), real) || real === realpathSync(home)) fail();
  } catch {
    fail();
  }
}

// The drafts before this one kept their files in ~/.incantation. The first run
// that finds that folder and no new one moves it to ~/.grimoire/incantation, so
// the owner takes no extra step (T2). Only a plain folder, never a link, inside
// the real home, and never over a folder already there. A move that fails (a
// listener of the old build still holds a file on Windows) leaves both as they
// are, and the run goes on to find no settings. Returns true when it moved.
export function migrateOldState(home, options = {}) {
  const old = join(home, '.incantation');
  try {
    const st = lstatSync(old);
    if (st.isSymbolicLink() || !st.isDirectory()) return false;
    if (!inside(realpathSync(home), realpathSync(old))) return false;
    try {
      lstatSync(stateDir(home));
      return false; // a new folder is there: the old one is left alone
    } catch (e) {
      if (e.code !== 'ENOENT') return false;
    }
    plainGrimoire(home, options);
    renameSync(old, stateDir(home));
    return true;
  } catch {
    return false;
  }
}

// The whole state tree, in order, so no file is written before its folder holds.
export function secureState(home, options = {}) {
  migrateOldState(home, options);
  plainGrimoire(home, options);
  for (const p of [stateDir(home), runDir(home), observeDir(home)]) secureFolder(home, p, options);
}

// A file of the state tree, checked: a plain file, not a link, and on macOS and
// Linux mode 0600.
export function checkFile(path, { platform = process.platform } = {}) {
  let st;
  try {
    st = lstatSync(path);
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw new Error('state');
  }
  if (st.isSymbolicLink() || !st.isFile()) throw new Error('state');
  if (posix(platform) && (st.mode & 0o077) !== 0) throw new Error('state');
  return true;
}

// Written whole, through a temporary name, mode 0600.
export function writePrivate(path, text, { platform = process.platform } = {}) {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
    if (posix(platform)) chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

// The settings file's keys (S5.5). Each check returns true for a value in range.
const PROFILE = /^[A-Za-z0-9-]{1,64}$/;
export const SETTINGS_KEYS = {
  engine: v => typeof v === 'string' && /^[a-z]{1,32}$/.test(v),
  port: v => Number.isInteger(v) && v >= 1024 && v <= 65535,
  profile: v => typeof v === 'string' && PROFILE.test(v),
  // The mic's id and name are kept as keyed digests, never as text (S13.5): #208's rule that no device name or id is in a file holds.
  device: v =>
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).every(k => ['index', 'stamp', 'id', 'name'].includes(k)) &&
    Number.isInteger(v.index) &&
    v.index >= 0 &&
    v.index <= 999 &&
    typeof v.stamp === 'string' &&
    /^[0-9a-f]{16}$/.test(v.stamp) &&
    ['id', 'name'].every(k => !(k in v) || (typeof v[k] === 'string' && /^[0-9a-f]{64}$/.test(v[k]))),
  recorder: v => typeof v === 'string' && v.length <= 1024 && isAbsolute(v) && !v.includes('\0'),
  endOfSpeechMs: v => Number.isInteger(v) && v >= 300 && v <= 3000,
};
export const SETTINGS_DEFAULTS = { engine: 'voicebox', port: 17493, endOfSpeechMs: 1500 };

// The settings, checked whole, or Error('settings'). Every key must be known
// and in range; profile, device and recorder must be there (setup writes them).
export function parseSettings(text) {
  const fail = () => {
    throw new Error('settings');
  };
  let given;
  try {
    given = JSON.parse(text);
  } catch {
    return fail();
  }
  if (given === null || typeof given !== 'object' || Array.isArray(given)) fail();
  const out = { ...SETTINGS_DEFAULTS };
  for (const [k, v] of Object.entries(given)) {
    if (!Object.hasOwn(SETTINGS_KEYS, k) || !SETTINGS_KEYS[k](v)) fail();
    out[k] = v;
  }
  for (const k of ['profile', 'device', 'recorder']) if (!(k in given)) fail();
  return out;
}

// Error('state') when the folder or the file is a link, looser than private,
// or outside home; Error('settings') when the file is missing or out of range.
export function readSettings(home, options = {}) {
  let text;
  migrateOldState(home, options);
  // Nothing there at all is a machine where setup has not run.
  try {
    lstatSync(stateDir(home));
  } catch (e) {
    if (e?.code === 'ENOENT') throw new Error('settings');
  }
  secureFolder(home, stateDir(home), { ...options, create: false });
  if (!checkFile(settingsPath(home), options)) throw new Error('settings');
  try {
    text = readText(settingsPath(home));
  } catch {
    throw new Error('settings');
  }
  return parseSettings(text);
}

// The key the mic's id and name digests are made with (S13.5, D14): 32 random
// bytes, made once by `setup.mjs choose`, kept private in the state folder, so a
// digest cannot be reversed by guessing device names. Null when there is none.
export function readKey(home, options = {}) {
  try {
    if (!checkFile(keyPath(home), options)) return null;
    const text = (readText(keyPath(home), 256) ?? '').trim();
    return /^[0-9a-f]{64}$/.test(text) ? Buffer.from(text, 'hex') : null;
  } catch {
    return null;
  }
}

// The key, made first when it is not there.
export function ensureKey(home, options = {}) {
  const have = readKey(home, options);
  if (have) return have;
  const key = randomBytes(32);
  writePrivate(keyPath(home), `${key.toString('hex')}\n`, options);
  return key;
}

// HMAC-SHA-256 of a device's id or name, in hex.
export const deviceDigest = (key, text) => createHmac('sha256', key).update(String(text)).digest('hex');

export const isWithin = inside;
export const pathSep = sep;
