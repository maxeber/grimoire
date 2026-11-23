// The runtime and its installer (docs/spec/0001, S5.9, S13.9 to S13.12). The
// runtime is one folder, ~/.grimoire/incantation/runtime/, held to the state
// folder's rules. Everything in it comes from the table in pins.mjs: fetched
// whole into runtime.partial/, checked against its size and sha256, and only
// then renamed into place. Nothing fetched is loaded or run before every pin of
// its part has passed. Node built-ins only; the one other program it runs is
// the person's own `uv`.
//
// Nothing here reads the environment: the home folder, the platform, the PATH
// value and the start folder come in from the caller, as does the transport, so
// a test runs it against a fake server.

import { createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync, writeSync } from 'node:fs';
import { request as httpsRequest, Agent } from 'node:https';
import { release as osRelease } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { resolveRecorder } from '../capture/ffmpeg.mjs';
import { secureFolder, stateDir, writePrivate } from '../lib.mjs';
import { ARCHIVES, FILES, GAPS, HOSTS, LOCKS, PYTHON, PYTHON_FLOOR, SOURCES } from './pins.mjs';

// The table a call reads; a test hands in a small one of its own.
const PINS = Object.freeze({ ARCHIVES, FILES, LOCKS, PYTHON_FLOOR, GAPS });

export const PARTS = Object.freeze(['addon', 'hearing', 'speaking', 'detector', 'python', 'turn', 'phonon']);
export const CORE = Object.freeze(['addon', 'hearing', 'speaking', 'detector']);
export const LAYER = Object.freeze(['python', 'turn', 'phonon']);

// What a person loses without the Python layer, said in the plan (S5.9).
export const LOST_WITHOUT_UV = 'without uv: no echo cancelling (use a headset), no end-of-turn hold, no Phonon voice';

// The estimated download of the Python layer: its wheels and uv's CPython. The
// wheels are pinned by hash in the lock files, not by size, so this is a figure
// for the plan only.
export const PYTHON_BYTES = 190_000_000;
const RATE_BYTES_PER_S = 10_000_000; // the plan's expected time is at 10 MB/s
const MANIFEST = 'py.manifest.json';
const MAX_REDIRECTS = 4;

// What a worker or uv is given of the environment, by name. Nothing else
// passes: no UV_*, PIP_* or proxy variable, no token (S13.11).
const ENV_NAMES = ['PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA'];

export const runtimeDir = home => join(stateDir(home), 'runtime');
export const partialDir = home => join(stateDir(home), 'runtime.partial');
export const platformKey = (platform, arch) => `${platform}-${arch}`;
export const pythonExe = (home, platform = process.platform) => join(runtimeDir(home), 'py', ...(platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));

/** The environment a worker or uv runs with: the named list from `env`, matched
 *  without regard to case on Windows, plus `extra`. */
export function namedEnv(env, extra = {}, platform = process.platform) {
  const out = {};
  for (const name of ENV_NAMES) {
    const key = Object.keys(env).find(k => (platform === 'win32' ? k.toLowerCase() === name.toLowerCase() : k === name));
    if (key !== undefined && typeof env[key] === 'string') out[name] = env[key];
  }
  return { ...out, ...extra };
}

/** A worker's environment: the named list, offline Hugging Face, the runtime's own cache. */
export const workerEnv = (home, env = process.env, platform = process.platform) =>
  namedEnv(env, { HF_HUB_OFFLINE: '1', HF_HOME: join(runtimeDir(home), 'hf') }, platform);

// ---- the table, by part --------------------------------------------------

const encodePath = p => p.split('/').map(encodeURIComponent).join('/');

/** What a part holds on this platform: `units` (a folder renamed into place as
 *  one piece, with its files), each file as { rel, size, sha256 } under the
 *  runtime folder, and where it comes from. `supported` is false when no pinned
 *  build exists for the platform. */
export function specOf(part, key, pins = PINS) {
  if (part === 'addon') {
    const archives = pins.ARCHIVES.filter(a => a.platform === null || a.platform === key);
    const supported = archives.some(a => a.platform === key);
    const units = archives.map(a => ({
      dest: a.dest,
      archive: a,
      files: a.files.map(([f, size, sha256]) => ({ rel: `${a.dest}/${f}`, file: f, size, sha256 })),
    }));
    return { supported, units, bytes: archives.reduce((n, a) => n + a.size, 0) };
  }
  if (part === 'python') {
    return { supported: Object.hasOwn(pins.LOCKS, key), units: [], bytes: PYTHON_BYTES };
  }
  const groups = pins.FILES.filter(g => g.part === part);
  const units = groups.map(g => ({
    dest: g.dest.replace(/\/$/, ''),
    group: g,
    files: g.files.map(([f, size, sha256]) => ({ rel: `${g.dest}${f}`, file: f, size, sha256 })),
  }));
  return { supported: true, units, bytes: units.reduce((n, u) => n + u.files.reduce((m, f) => m + f.size, 0), 0) };
}

/** Why the platform has no pinned addon, with the upstream reason. */
export function addonGap(key, pins = PINS) {
  if (pins.GAPS?.[key]?.addon) return pins.GAPS[key].addon;
  const node = pins.ARCHIVES.find(a => a.platform === null);
  const version = node?.url.match(/-(\d[^/]*)\.tgz$/)?.[1];
  return `${node ? [node.name, version].filter(Boolean).join(' ') : 'the addon'} publishes no addon for ${key}`;
}

/** Why the Python layer cannot install here, or null when it can: no lock for
 *  the platform, or an OS older than its wheels' floor. `release` is
 *  `os.release()`'s answer. */
export function pythonGap(key, release, pins = PINS) {
  if (!Object.hasOwn(pins.LOCKS, key)) return pins.GAPS?.[key]?.python ?? `no pinned wheels for ${key}`;
  const floor = pins.PYTHON_FLOOR?.[key];
  if (floor && !(Number.parseInt(String(release), 10) >= floor.release)) return `needs ${floor.name}: ${floor.why}`;
  return null;
}

const mb = bytes => Math.max(1, Math.ceil(bytes / 1_000_000));

// ---- state of a part on disk --------------------------------------------

const sizeOf = p => {
  try {
    const st = lstatSync(p);
    return st.isFile() && !st.isSymbolicLink() ? st.size : -1;
  } catch {
    return -1;
  }
};

function readManifest(home) {
  try {
    const m = JSON.parse(readFileSync(join(runtimeDir(home), MANIFEST), 'utf8'));
    return Array.isArray(m?.files) ? m : null;
  } catch {
    return null;
  }
}

/** `absent`, `ok` or `damaged` for a part, by presence and pinned size alone
 *  (the guard's check; `verify` re-hashes). A file that is a link is damage. */
export function partState(home, part, key, pins = PINS) {
  const root = runtimeDir(home);
  if (part === 'python') {
    const m = readManifest(home);
    const exe = existsSync(join(root, 'py'));
    if (!m && !exe) return 'absent';
    if (!m) return 'damaged';
    return m.files.every(([rel, size]) => sizeOf(join(root, 'py', ...rel.split('/'))) === size) ? 'ok' : 'damaged';
  }
  const { units } = specOf(part, key, pins);
  let any = false;
  let bad = false;
  for (const u of units) {
    for (const f of u.files) {
      const got = sizeOf(join(root, ...f.rel.split('/')));
      if (got !== -1) any = true;
      if (got !== f.size) bad = true;
    }
  }
  return !any ? 'absent' : bad ? 'damaged' : 'ok';
}

/** The guard's check: the first part that is installed but short or changed in
 *  size, else whether every core part is there. */
export function checkRuntime(home, key, pins = PINS) {
  const states = Object.fromEntries(PARTS.map(p => [p, partState(home, p, key, pins)]));
  const damaged = PARTS.filter(p => states[p] === 'damaged');
  return { states, damaged, core: CORE.every(p => states[p] === 'ok') };
}

// ---- finding uv ----------------------------------------------------------

/** The person's own `uv`, found as the recorder is: absolute PATH entries only,
 *  never the working folder nor the folder Claude Code started in. */
export function findUv({ platform, pathValue, startDir, fs }) {
  return resolveRecorder({ platform, pathValue, startDir, fs, name: platform === 'win32' ? 'uv.exe' : 'uv' });
}

// ---- the plan ------------------------------------------------------------

/** The plan, as lines: each part's state and download size, whether uv was
 *  found, what is lost without it, the total, the peak disk use and the time
 *  at 10 MB/s, and every host that will be contacted. */
export function planRuntime({ home, platform, arch, uv, release = osRelease(), pins = PINS }) {
  const key = platformKey(platform, arch);
  const noPython = pythonGap(key, release, pins);
  const lines = [];
  let download = 0;
  let unpacked = 0;
  for (const part of PARTS) {
    const spec = specOf(part, key, pins);
    const state = partState(home, part, key, pins);
    if (part === 'addon' && !spec.supported) {
      lines.push(`addon unavailable ${addonGap(key, pins)}; choose Voicebox`);
      continue;
    }
    if (part === 'python' && noPython) {
      lines.push(`python unavailable ${noPython}`);
      continue;
    }
    if ((part === 'turn' || part === 'phonon') && noPython) {
      lines.push(`${part} skipped no python layer`);
      continue;
    }
    const layerNeedsUv = LAYER.includes(part) && !uv;
    if (layerNeedsUv) {
      lines.push(`${part} skipped no uv`);
      continue;
    }
    if (state === 'ok') {
      lines.push(`${part} present ${mb(spec.bytes)} MB`);
      continue;
    }
    lines.push(`${part} missing ${mb(spec.bytes)} MB`);
    download += spec.bytes;
    if (part === 'python') unpacked += PYTHON_BYTES;
    if (part === 'addon') unpacked += spec.units.reduce((n, u) => n + u.files.reduce((m, f) => m + f.size, 0), 0);
  }
  lines.push(uv ? 'uv found' : 'uv not found');
  if (!uv) lines.push(LOST_WITHOUT_UV);
  lines.push(`total download ${mb(download)} MB, peak disk ${mb(download + unpacked)} MB, about ${Math.max(1, Math.ceil(download / RATE_BYTES_PER_S / 60))} min at 10 MB/s`);
  lines.push(`hosts ${HOSTS.join(' ')}`);
  return { lines, peak: download + unpacked, download };
}

// ---- download ------------------------------------------------------------

/** The transport: one request, no proxy, no cookie, no token. Each call makes
 *  its own agent, which reads no proxy variable even where Node can. */
export function makeTransport(https = { request: httpsRequest, Agent }) {
  return (url, headers) =>
    new Promise((resolve, reject) => {
      const req = https.request(url, { method: 'GET', headers, agent: new https.Agent({ keepAlive: false }), timeout: 60_000 }, res => resolve({ status: res.statusCode, headers: res.headers, body: res }));
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end();
    });
}

const HEADERS = Object.freeze({ 'accept-encoding': 'identity', 'user-agent': 'incantation-installer' });

/** Fetches one URL to `out` (an absolute path), checking size and sha256 as it
 *  streams. Redirects are followed only over https and only to the hosts the
 *  source names. Resolves { ok: true } or { ok: false, why }. Never a URL in
 *  the answer. */
export async function download({ src, urlPath, size, sha256, sha512, out, transport, origins = SOURCES }) {
  const source = origins[src];
  let url = new URL(`${source.origin}${urlPath}`);
  const allowed = new Set([new URL(source.origin).host, ...source.redirects]);
  let res;
  for (let hop = 0; ; hop++) {
    if (hop > MAX_REDIRECTS) return { ok: false, why: 'redirects' };
    try {
      res = await transport(url, HEADERS);
    } catch {
      return { ok: false, why: 'network' };
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      res.body?.resume?.();
      const loc = res.headers.location;
      if (!loc) return { ok: false, why: 'redirect' };
      let next;
      try {
        next = new URL(loc, url);
      } catch {
        return { ok: false, why: 'redirect' };
      }
      if (next.protocol !== 'https:' && !(origins.allowHttp && next.protocol === 'http:')) return { ok: false, why: 'redirect' };
      if (!allowed.has(next.host)) return { ok: false, why: 'redirect host' };
      url = next;
      continue;
    }
    break;
  }
  if (res.status !== 200) {
    res.body?.resume?.();
    return { ok: false, why: `status ${res.status}` };
  }
  mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
  const h256 = createHash('sha256');
  const h512 = sha512 ? createHash('sha512') : null;
  let n = 0;
  const fd = openSync(out, 'wx', 0o600);
  try {
    for await (const chunk of res.body) {
      n += chunk.length;
      if (n > size) {
        res.body.destroy?.();
        return { ok: false, why: 'size' };
      }
      h256.update(chunk);
      h512?.update(chunk);
      writeSync(fd, chunk);
    }
  } catch {
    return { ok: false, why: 'network' };
  } finally {
    closeSync(fd);
  }
  if (n !== size) return { ok: false, why: 'size' };
  if (h256.digest('hex') !== sha256) return { ok: false, why: 'sha256' };
  if (h512 && h512.digest('base64') !== sha512) return { ok: false, why: 'sha512' };
  return { ok: true };
}

// ---- archives ------------------------------------------------------------

const octal = (buf, from, to) => parseInt(buf.toString('latin1', from, to).replace(/\0.*$/, '').trim() || '0', 8);

/** The regular files of a gzipped tar, as { path, data }. Refuses at once any
 *  link, device, pax header, absolute path, drive, backslash or `..`: the
 *  archive is refused whole. Folders are skipped. */
export function readTgz(tgz, { maxBytes }) {
  const buf = gunzipSync(tgz, { maxOutputLength: maxBytes });
  const files = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const head = buf.subarray(off, off + 512);
    if (head.every(b => b === 0)) break;
    const name = head.toString('latin1', 0, 100).replace(/\0.*$/, '');
    const prefix = head.toString('latin1', 345, 500).replace(/\0.*$/, '');
    const path = prefix ? `${prefix}/${name}` : name;
    const size = octal(head, 124, 136);
    const type = String.fromCharCode(head[156] || 48);
    off += 512;
    if (type !== '0' && type !== '5') throw new Error('entry');
    const parts = path.split('/');
    if (!path || path.startsWith('/') || /[\\:\0]/.test(path) || parts.some(p => p === '..' || p === '')) {
      if (!(type === '5' && path.endsWith('/') && parts.slice(0, -1).every(p => p !== '..' && p !== ''))) throw new Error('entry');
    }
    if (type === '0') {
      if (off + size > buf.length) throw new Error('entry');
      files.push({ path, data: buf.subarray(off, off + size) });
    }
    off += Math.ceil(size / 512) * 512;
  }
  return files;
}

// ---- running uv ----------------------------------------------------------

/** The arguments of each uv call. Every call holds `--no-config`, the one index
 *  and `--python-preference only-managed` (S13.11, S13.12). */
export const uvArgs = {
  // --managed-python is the strict form of only-managed and uv refuses both together.
  venv: venv => ['venv', '--no-config', '--index-url', PYTHON.index, '--managed-python', '--python', PYTHON.version, venv],
  install: (python, lock) => ['pip', 'install', '--no-config', '--index-url', PYTHON.index, '--python-preference', 'only-managed', '--require-hashes', '--only-binary', ':all:', '--no-deps', '--python', python, '-r', lock],
  cacheDir: () => ['cache', 'dir', '--no-config'],
};

// ---- helpers for the install ---------------------------------------------

const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function renameWithRetry(from, to) {
  for (let i = 0; ; i++) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      sleepSync(200);
    }
  }
}

function walkFiles(dir, base = dir, skip = n => false) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (skip(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p, base, skip));
    else if (e.isFile()) out.push(p.slice(base.length + 1).replaceAll('\\', '/'));
  }
  return out;
}

const hashFile = path => {
  const h = createHash('sha256');
  h.update(readFileSync(path));
  return h.digest('hex');
};

/** Free bytes on the volume that holds `path`, or Infinity when unknown. */
export function freeBytes(path) {
  try {
    const s = statfsSync(path);
    return s.bavail * s.bsize;
  } catch {
    return Infinity;
  }
}

const safeRel = rel => rel.split('/').every(p => p && p !== '..' && !/[\\:\0]/.test(p));

// ---- the install ---------------------------------------------------------

/** Installs the runtime. `o`: home, platform, arch, pathValue, startDir, env,
 *  transport, runUv (file, args, { cwd, env }) -> { code, stdout }, fs (for
 *  finding uv), free (bytes), log (a line at a time, as each part finishes).
 *  Returns { lines, code }. One line per part: ok, skipped <why> or failed
 *  <file>; the lines are also handed to `o.log` as they come. */
export async function installRuntime(o) {
  const { home, platform, arch } = o;
  const key = platformKey(platform, arch);
  const lines = [];
  const say = l => {
    lines.push(l);
    o.log?.(l);
  };
  const uv = findUv({ platform, pathValue: o.pathValue, startDir: o.startDir, fs: o.fs });
  const pins = o.pins ?? PINS;
  const release = o.release ?? osRelease();
  const plan = planRuntime({ home, platform, arch, uv, release, pins });
  const free = (o.free ?? freeBytes)(home);
  if (free < plan.peak * 1.1) return { lines: ['install: not enough free disk space on the home drive'], code: 1 };
  const root = runtimeDir(home);
  const partial = partialDir(home);
  const transport = o.transport ?? makeTransport();
  try {
    secureFolder(home, stateDir(home), { platform });
    secureFolder(home, root, { platform });
    rmSync(partial, { recursive: true, force: true });
    secureFolder(home, partial, { platform });
  } catch {
    return { lines: ['install: the ~/.grimoire/incantation folder is not private or not a plain folder'], code: 1 };
  }
  let failed = false;

  const installPart = async part => {
    const spec = specOf(part, key, pins);
    const stage = join(partial, part);
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true, mode: 0o700 });
    for (const u of spec.units) {
      const want = new Map(u.files.map(f => [f.file, f]));
      if (u.archive) {
        const tmp = join(stage, `${u.archive.name}.tgz`);
        const r = await download({ src: 'npm', urlPath: u.archive.url, size: u.archive.size, sha256: u.archive.sha256, sha512: u.archive.sha512, out: tmp, transport, origins: o.origins });
        if (!r.ok) return `failed ${u.archive.name}`;
        let entries;
        try {
          entries = readTgz(readFileSync(tmp), { maxBytes: u.files.reduce((n, f) => n + f.size, 0) + 1_000_000 });
        } catch {
          return `failed ${u.archive.name}`;
        }
        const seen = new Set();
        for (const e of entries) {
          const rel = e.path.replace(/^package\//, '');
          if (!e.path.startsWith('package/') || !want.has(rel)) continue;
          const f = want.get(rel);
          if (e.data.length !== f.size || createHash('sha256').update(e.data).digest('hex') !== f.sha256) return `failed ${rel}`;
          const out = join(stage, u.dest, ...rel.split('/'));
          mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
          const fd = openSync(out, 'wx', 0o600);
          try {
            writeSync(fd, e.data);
          } finally {
            closeSync(fd);
          }
          seen.add(rel);
        }
        for (const f of u.files) if (!seen.has(f.file)) return `failed ${f.file}`;
        rmSync(tmp, { force: true });
      } else {
        for (const f of u.files) {
          if (!safeRel(f.file)) return `failed ${f.file}`;
          const r = await download({ src: u.group.src, urlPath: `${u.group.base}${encodePath(f.file)}`, size: f.size, sha256: f.sha256, out: join(stage, ...u.dest.split('/'), ...f.file.split('/')), transport, origins: o.origins });
          if (!r.ok) return `failed ${f.file}`;
          o.log?.(`fetched ${part} ${f.file}`);
        }
      }
    }
    // Every pin of the part has passed: put each folder into place.
    for (const u of spec.units) {
      const to = join(root, ...u.dest.split('/'));
      mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
      rmSync(to, { recursive: true, force: true });
      renameWithRetry(join(stage, ...u.dest.split('/')), to);
    }
    rmSync(stage, { recursive: true, force: true });
    return 'ok';
  };

  const lockPath = () => join(o.lockDir ?? dirname(fileURLToPath(import.meta.url)), pins.LOCKS[key] ?? '');
  const stampOf = () => {
    try {
      return createHash('sha256').update(PYTHON.version).update('\0').update(readFileSync(lockPath())).digest('hex');
    } catch {
      return null;
    }
  };
  const partCurrent = part => {
    if (part === 'python') return readManifest(home)?.stamp === stampOf();
    return specOf(part, key, pins).units.flatMap(u => u.files).every(f => hashFile(join(root, ...f.rel.split('/'))) === f.sha256);
  };

  const installPython = async () => {
    const lock = lockPath();
    // uv's own cache, asked of uv and passed back explicitly, so no UV_* variable
    // of the person's environment ever reaches it.
    const bare = namedEnv(o.env ?? {}, {}, platform);
    const asked = await o.runUv(uv, uvArgs.cacheDir(), { cwd: root, env: bare });
    const cache = String(asked.stdout ?? '').trim();
    const env = asked.code === 0 && (platform === 'win32' ? /^[A-Za-z]:[\\/]/ : /^\//).test(cache) ? { ...bare, UV_CACHE_DIR: cache } : bare;
    // The venv is made in place, not in runtime.partial/: a venv does not move,
    // and nothing in runtime.partial/ is ever run. Its interpreter is uv's own
    // CPython, which uv checks; the wheels are checked by uv against the lock's
    // hashes before it unpacks any of them.
    const venv = join(root, 'py');
    rmSync(venv, { recursive: true, force: true });
    rmSync(join(root, MANIFEST), { force: true });
    const run = (args, cwd) => o.runUv(uv, args, { cwd, env });
    let r = await run(uvArgs.venv(venv), root);
    if (r.code !== 0) return 'failed venv';
    r = await run(uvArgs.install(pythonExe(home, platform), lock), root);
    if (r.code !== 0) return 'failed wheels';
    const files = walkFiles(venv, venv, n => n === '__pycache__').sort();
    const manifest = { python: PYTHON.version, stamp: stampOf(), files: files.map(f => [f, statSync(join(venv, ...f.split('/'))).size, hashFile(join(venv, ...f.split('/')))]) };
    writePrivate(join(root, MANIFEST), `${JSON.stringify(manifest)}\n`, { platform });
    return 'ok';
  };

  for (const part of PARTS) {
    const spec = specOf(part, key, pins);
    if (part === 'addon' && !spec.supported) {
      say(`addon failed ${addonGap(key, pins)}`);
      failed = true;
      continue;
    }
    if (LAYER.includes(part)) {
      // The platform's own gap comes first, as in the plan: uv would not help.
      const noPython = part === 'python' && pythonGap(key, release, pins);
      if (noPython) {
        say(`python skipped ${noPython}`);
        continue;
      }
      if (!uv) {
        say(`${part} skipped no uv`);
        continue;
      }
      if ((part === 'turn' || part === 'phonon') && partState(home, 'python', key, pins) !== 'ok') {
        say(`${part} skipped no python layer`);
        continue;
      }
    }
    // Installed and the right size is not enough here: a part is current only when
    // its files hash to this table's pins (python: the lock and the interpreter it
    // was built from), so a pin changed by a later release is applied, not skipped.
    if (partState(home, part, key, pins) === 'ok' && partCurrent(part)) {
      say(`${part} ok`);
      continue;
    }
    let result;
    try {
      if (part === 'python') {
        result = await installPython();
      } else {
        result = await installPart(part);
      }
    } catch {
      result = `failed ${part}`;
    }
    if (result !== 'ok') failed = true;
    say(`${part} ${result}`);
    if (result !== 'ok') rmSync(part === 'python' ? join(root, 'py') : join(partial, part), { recursive: true, force: true });
  }
  rmSync(partial, { recursive: true, force: true });
  return { lines, code: failed ? 1 : 0 };
}

// ---- verify --------------------------------------------------------------

/** Re-hashes everything installed. One line per part: ok, failed <file>, or
 *  skipped not installed. */
export function verifyRuntime({ home, platform, arch, pins = PINS }) {
  const key = platformKey(platform, arch);
  const root = runtimeDir(home);
  const lines = [];
  let code = 0;
  for (const part of PARTS) {
    let result = 'ok';
    if (part === 'python') {
      const m = readManifest(home);
      if (!m) {
        lines.push(`${part} skipped not installed`);
        continue;
      }
      const bad = m.files.find(([rel, size, sha]) => sizeOf(join(root, 'py', ...rel.split('/'))) !== size || hashFile(join(root, 'py', ...rel.split('/'))) !== sha);
      if (bad) result = `failed ${bad[0]}`;
    } else {
      const spec = specOf(part, key, pins);
      if (partState(home, part, key, pins) === 'absent') {
        lines.push(`${part} skipped not installed`);
        continue;
      }
      const bad = spec.units.flatMap(u => u.files).find(f => sizeOf(join(root, ...f.rel.split('/'))) !== f.size || hashFile(join(root, ...f.rel.split('/'))) !== f.sha256);
      if (bad) result = `failed ${bad.file}`;
    }
    if (result !== 'ok') code = 1;
    lines.push(`${part} ${result}`);
  }
  return { lines, code };
}
