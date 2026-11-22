// Tests of the runtime installer and its checks (docs/spec/0001, S5.9; claims
// 14 and 15), against a fake transport and a fake uv, in a fixture home. No
// network, no real model, no real uv.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ARCHIVES, FILES, HOSTS, LOCKS, SOURCES } from '../skills/incantation/scripts/runtime/pins.mjs';
import { checkRuntime, download, findUv, installRuntime, makeTransport, namedEnv, partState, partialDir, planRuntime, pythonExe, readTgz, runtimeDir, uvArgs, verifyRuntime } from '../skills/incantation/scripts/runtime/install.mjs';
import { secureState } from '../skills/incantation/scripts/lib.mjs';

const sha256 = b => createHash('sha256').update(b).digest('hex');
const sha512 = b => createHash('sha512').update(b).digest('base64');
// The install runs for the platform the test runs on (Windows or Linux), x64, so
// the fake uv's path, the interpreter's path and the pinned key all agree.
const platform = process.platform;
const arch = 'x64';
const KEY = `${platform}-${arch}`;

// A tar entry: 512-byte header, then the data padded to 512.
function tar(entries) {
  const blocks = [];
  for (const { name, data = Buffer.alloc(0), type = '0' } of entries) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 'latin1');
    h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
    h.write(type, 156, 'latin1');
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const rows = map => Object.entries(map).map(([f, d]) => [f, d.length, sha256(d)]);
const DATA = {
  parakeet: { 'enc.bin': Buffer.from('encoder bytes'), 'tokens.txt': Buffer.from('a b c') },
  kokoro: { 'model.bin': Buffer.from('model bytes'), 'data/x.dict': Buffer.from('dict') },
  vad: { 'v.onnx': Buffer.from('vad') },
  turn: { 't.onnx': Buffer.from('turn') },
  phonon: { 'model.safetensors': Buffer.from('phonon') },
};
const NODE_TGZ = tar([
  { name: 'package/', type: '5' },
  { name: 'package/index.js', data: Buffer.from('module.exports = 1;') },
  { name: 'package/extra.txt', data: Buffer.from('not in the table') },
]);
const WIN_TGZ = tar([{ name: 'package/addon.node', data: Buffer.from('native') }]);
const archive = (name, platformKey, dest, tgz, files) => ({ name, url: `/${name}/-/${name}.tgz`, platform: platformKey, dest, size: tgz.length, sha256: sha256(tgz), sha512: sha512(tgz), files });
const PINS = {
  ARCHIVES: [
    archive('node-pkg', null, 'node_modules/node-pkg', NODE_TGZ, rows({ 'index.js': Buffer.from('module.exports = 1;') })),
    archive('win-pkg', KEY, 'node_modules/win-pkg', WIN_TGZ, rows({ 'addon.node': Buffer.from('native') })),
  ],
  FILES: [
    { part: 'hearing', src: 'hf', base: '/o/p/resolve/abc/', dest: 'parakeet/', files: rows(DATA.parakeet) },
    { part: 'speaking', src: 'hf', base: '/o/k/resolve/abc/', dest: 'kokoro/', files: rows(DATA.kokoro) },
    { part: 'detector', src: 'github', base: '/g/r/releases/download/x/', dest: 'vad/', files: rows(DATA.vad) },
    { part: 'turn', src: 'hf', base: '/o/t/resolve/abc/', dest: 'smart-turn/', files: rows(DATA.turn) },
    { part: 'phonon', src: 'hf', base: '/o/ph/resolve/abc/', dest: 'hf/hub/m/snapshots/abc/', files: rows(DATA.phonon) },
  ],
  LOCKS: { [KEY]: 'lock-test.txt' },
};

// What the fake origins serve, by `host + path`.
function served() {
  const m = new Map();
  m.set('registry.npmjs.org/node-pkg/-/node-pkg.tgz', NODE_TGZ);
  m.set('registry.npmjs.org/win-pkg/-/win-pkg.tgz', WIN_TGZ);
  for (const g of PINS.FILES) for (const [f] of g.files) m.set(`${g.src === 'hf' ? 'huggingface.co' : 'github.com'}${g.base}${f}`, Object.values(DATA).map(d => d[f]).find(Boolean));
  return m;
}
const reply = (status, body, headers = {}) => ({ status, headers, body: (async function* () { if (body) yield body; })() });
const fakeTransport = (map, log = []) => async (url, headers) => {
  log.push({ host: url.host, path: url.pathname, headers });
  const b = map.get(`${url.host}${url.pathname}`);
  return b ? reply(200, b) : reply(404, null);
};

const win = process.platform === 'win32';
const BIN = win ? 'C:\\fake\\bin' : '/fake/bin';
const UV = win ? win32.join(BIN, 'uv.exe') : posix.join(BIN, 'uv');
const fakeFs = { isFile: p => p === UV, realpath: p => p, lstat: () => ({ uid: 0, mode: 0o40755 }), uid: () => 1000 };
const pathValue = BIN;

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'incantation-runtime-'));
  secureState(home);
  return { home, remove: () => rmSync(home, { recursive: true, force: true }) };
}

// A fake uv: `venv` makes the folder and an interpreter file; `pip install`
// puts one package file in it; `cache dir` answers a folder.
const fakeUv = calls => async (file, args, opts) => {
  calls.push({ file, args, opts });
  if (args[0] === 'cache') return { code: 0, stdout: win ? 'C:\\fake\\uvcache\n' : '/fake/uvcache\n' };
  if (args[0] === 'venv') {
    const venv = args[args.length - 1];
    const py = join(venv, ...(win ? ['Scripts', 'python.exe'] : ['bin', 'python']));
    mkdirSync(join(py, '..'), { recursive: true });
    writeFileSync(py, 'interpreter');
    return { code: 0, stdout: '' };
  }
  const site = join(args[args.indexOf('--python') + 1], '..', '..', 'Lib', 'site-packages');
  mkdirSync(site, { recursive: true });
  writeFileSync(join(site, 'pkg.py'), 'x = 1');
  return { code: 0, stdout: '' };
};

const install = (f, over = {}) =>
  installRuntime({ home: f.home, platform, arch, pathValue, startDir: join(tmpdir(), 'elsewhere'), fs: fakeFs, env: {}, pins: PINS, lockDir: tmpdir(), free: () => Infinity, runUv: fakeUv([]), transport: fakeTransport(served()), ...over });

test('claim 14: every part is fetched, checked and renamed into place; verify then reports ok', async () => {
  const f = fixture();
  try {
    const { lines, code } = await install(f);
    assert.equal(code, 0);
    for (const p of ['addon', 'hearing', 'speaking', 'detector', 'python', 'turn', 'phonon']) assert.ok(lines.includes(`${p} ok`), `${p}: ${lines.join(' | ')}`);
    assert.equal(readFileSync(join(runtimeDir(f.home), 'kokoro', 'data', 'x.dict'), 'utf8'), 'dict');
    assert.equal(existsSync(partialDir(f.home)), false, 'runtime.partial is gone');
    assert.deepEqual(verifyRuntime({ home: f.home, platform, arch, pins: PINS }).lines.every(l => l.endsWith(' ok')), true);
    assert.equal(checkRuntime(f.home, KEY, PINS).core, true);
  } finally {
    f.remove();
  }
});

test('claim 14: a rerun skips what is current, and fetches again a file changed to the same size and a python layer whose lock changed', async () => {
  const f = fixture();
  const locks = mkdtempSync(join(tmpdir(), 'incantation-locks-'));
  try {
    writeFileSync(join(locks, 'lock-test.txt'), 'wheel-a --hash=sha256:aa\n');
    const calls = [];
    const log = [];
    const again = () => install(f, { lockDir: locks, runUv: fakeUv(calls), transport: fakeTransport(served(), log) });
    await again();
    calls.length = 0;
    log.length = 0;
    const rerun = await again();
    assert.deepEqual([calls.length, log.length], [0, 0], 'nothing current is fetched or rebuilt');
    assert.ok(rerun.lines.includes('python ok') && rerun.lines.includes('hearing ok'));

    // The same size, other bytes: the size check passes, the hash does not.
    writeFileSync(join(runtimeDir(f.home), 'parakeet', 'enc.bin'), 'ENCODER BYTES');
    assert.equal(partState(f.home, 'hearing', KEY, PINS), 'ok', 'the start check reads sizes only');
    await again();
    assert.ok(log.some(l => l.path.endsWith('/enc.bin')), 'the changed file was fetched again');
    assert.equal(readFileSync(join(runtimeDir(f.home), 'parakeet', 'enc.bin'), 'utf8'), 'encoder bytes');

    // A later release changes the lock: the layer is built again.
    calls.length = 0;
    writeFileSync(join(locks, 'lock-test.txt'), 'wheel-a --hash=sha256:bb\n');
    await again();
    assert.ok(calls.some(c => c.args[0] === 'venv') && calls.some(c => c.args[0] === 'pip'), 'uv ran again for the new lock');
  } finally {
    rmSync(locks, { recursive: true, force: true });
    f.remove();
  }
});

test('claim 14: a file whose size or sha256 differs from its pin is not kept, and the part fails naming that file', async () => {
  for (const [label, mutate] of [['sha256', b => Buffer.from(b.toString().toUpperCase())], ['size', b => Buffer.concat([b, Buffer.from('+')])]]) {
    const f = fixture();
    try {
      const map = served();
      const key = [...map.keys()].find(k => k.endsWith('/enc.bin'));
      map.set(key, mutate(map.get(key)));
      const { lines, code } = await install(f, { transport: fakeTransport(map) });
      assert.equal(code, 1, label);
      assert.ok(lines.includes('hearing failed enc.bin'), `${label}: ${lines.join(' | ')}`);
      assert.equal(existsSync(join(runtimeDir(f.home), 'parakeet')), false, `${label}: nothing of the failed part is kept`);
      assert.ok(lines.includes('speaking ok'), 'the next part still goes on');
    } finally {
      f.remove();
    }
  }
});

test('claim 14: an archive is checked whole before it is opened, and a file the table does not name is not kept', async () => {
  const f = fixture();
  try {
    const map = served();
    const bad = Buffer.from(NODE_TGZ);
    bad[bad.length - 1] ^= 1; // same size, other bytes: the archive's sha256 no longer matches
    map.set('registry.npmjs.org/node-pkg/-/node-pkg.tgz', bad);
    const { lines } = await install(f, { transport: fakeTransport(map) });
    assert.ok(lines.includes('addon failed node-pkg'), lines.join(' | '));
  } finally {
    f.remove();
  }
  const g = fixture();
  try {
    const { code } = await install(g);
    assert.equal(code, 0);
    assert.equal(existsSync(join(runtimeDir(g.home), 'node_modules', 'node-pkg', 'extra.txt')), false);
    assert.equal(existsSync(join(runtimeDir(g.home), 'node_modules', 'node-pkg', 'index.js')), true);
  } finally {
    g.remove();
  }
});

test('claim 14: an archive entry that is a link, absolute, has a drive, a backslash or .. is refused', () => {
  const data = Buffer.from('x');
  for (const entry of [{ name: 'package/l', type: '2' }, { name: 'package/h', type: '1' }, { name: '/etc/x', data }, { name: 'package/../x', data }, { name: 'C:/x', data }, { name: 'package\\x', data }, { name: 'package/dev', type: '3' }]) {
    assert.throws(() => readTgz(tar([entry]), { maxBytes: 1_000_000 }), /entry/, entry.name);
  }
  assert.deepEqual(readTgz(tar([{ name: 'package/', type: '5' }, { name: 'package/a.js', data }]), { maxBytes: 1_000_000 }).map(e => e.path), ['package/a.js']);
});

test('claim 14: a redirect to a host the table does not name, or over http, is refused; a named one is followed', async () => {
  const body = Buffer.from('payload');
  const run = (location, origins) =>
    download({
      src: 'hf',
      urlPath: '/o/r/resolve/abc/f',
      size: body.length,
      sha256: sha256(body),
      out: join(tmpdir(), `incantation-dl-${process.pid}-${Math.random().toString(16).slice(2)}`),
      origins,
      transport: async url => (url.host === 'huggingface.co' ? reply(302, null, { location }) : reply(200, body)),
    });
  assert.deepEqual(await run('https://evil.example/f'), { ok: false, why: 'redirect host' });
  assert.deepEqual(await run('http://us.aws.cdn.hf.co/f'), { ok: false, why: 'redirect' });
  assert.deepEqual(await run('https://us.aws.cdn.hf.co/f'), { ok: true });
});

test('claim 14: with HTTPS_PROXY and NODE_USE_ENV_PROXY set at start, the fake proxy receives nothing from the installer', async () => {
  // Node reads the env proxy switch at start-up, so the request runs in a child.
  // The control request (the global agent) must reach the proxy, or the set-up proves nothing.
  const hits = [];
  const proxy = createServer(sock => {
    hits.push(1);
    sock.destroy();
  });
  await new Promise(res => proxy.listen(0, '127.0.0.1', res));
  const child = label =>
    new Promise(res => {
      const code = `import { request } from 'node:https'; import { makeTransport } from ${JSON.stringify(new URL('../skills/incantation/scripts/runtime/install.mjs', import.meta.url).href)};
        const url = new URL('https://example.invalid/x');
        if (process.argv[1] === 'control') { const r = request(url); r.on('error', () => process.exit(0)); r.end(); }
        else makeTransport()(url, {}).catch(() => process.exit(0));`;
      const p = spawn(process.execPath, ['--input-type=module', '-e', code, label], { env: { ...process.env, HTTPS_PROXY: `http://127.0.0.1:${proxy.address().port}`, HTTP_PROXY: `http://127.0.0.1:${proxy.address().port}`, NODE_USE_ENV_PROXY: '1' }, stdio: 'ignore' });
      p.on('exit', res);
    });
  try {
    await child('control');
    assert.ok(hits.length >= 1, 'the control request reached the fake proxy');
    const before = hits.length;
    await child('installer');
    assert.equal(hits.length, before, 'the installer\x27s transport did not');
  } finally {
    proxy.close();
  }
});

test('claim 14: no request carries a cookie, a token or an authorization header', async () => {
  const f = fixture();
  try {
    const log = [];
    await install(f, { transport: fakeTransport(served(), log) });
    assert.ok(log.length > 5);
    for (const l of log) assert.deepEqual(Object.keys(l.headers).sort(), ['accept-encoding', 'user-agent']);
  } finally {
    f.remove();
  }
});

test('claim 14: nothing in runtime.partial is run; uv runs from the runtime folder with the fixed flags and a named environment', async () => {
  const f = fixture();
  try {
    const calls = [];
    const env = { PATH: BIN, SystemRoot: 'C:\\Windows', TEMP: 'T', UV_INDEX_URL: 'https://evil.example', PIP_INDEX_URL: 'https://evil.example', HTTPS_PROXY: 'http://evil.example', HF_TOKEN: 'hf_secret', USERPROFILE: f.home };
    await install(f, { runUv: fakeUv(calls), env });
    const pip = calls.find(c => c.args[0] === 'pip');
    assert.equal(pip.file, UV);
    for (const flag of ['--require-hashes', '--no-deps', '--no-config']) assert.ok(pip.args.includes(flag), flag);
    assert.equal(pip.args[pip.args.indexOf('--only-binary') + 1], ':all:');
    assert.equal(pip.args[pip.args.indexOf('--index-url') + 1], 'https://pypi.org/simple');
    assert.equal(pip.args[pip.args.indexOf('--python-preference') + 1], 'only-managed');
    assert.equal(pip.args[pip.args.indexOf('--python') + 1], pythonExe(f.home, platform));
    assert.ok(calls.find(c => c.args[0] === 'venv').args.includes('--managed-python'));
    assert.equal(pip.opts.cwd, runtimeDir(f.home));
    assert.deepEqual(Object.keys(pip.opts.env).sort(), ['PATH', ...(win ? ['SYSTEMROOT'] : []), 'TEMP', 'USERPROFILE', 'UV_CACHE_DIR'].sort());
    for (const c of calls) assert.ok(!c.args.some(a => String(a).includes('runtime.partial')), 'uv never touches runtime.partial');
  } finally {
    f.remove();
  }
});

test('claim 14: uv from a relative PATH entry or the working folder is never run', () => {
  const start = win ? 'C:\\work' : '/work';
  const fsAt = place => ({ isFile: p => p === place, realpath: p => p, lstat: () => ({ uid: 0, mode: 0o40755 }), uid: () => 1000 });
  const inWork = win ? win32.join(start, 'uv.exe') : posix.join(start, 'uv');
  assert.equal(findUv({ platform: process.platform, pathValue: `${start}${win ? ';' : ':'}.${win ? ';' : ':'}bin`, startDir: start, fs: fsAt(inWork) }), null);
  assert.equal(findUv({ platform: process.platform, pathValue: 'relative', startDir: start, fs: fsAt(win ? 'relative\\uv.exe' : 'relative/uv') }), null);
  assert.equal(findUv({ platform: process.platform, pathValue: BIN, startDir: start, fs: fsAt(UV) }), UV);
});

test('claim 14: namedEnv passes the named list and nothing else', () => {
  assert.deepEqual(namedEnv({ Path: 'p', UV_INDEX_URL: 'x', pip_index_url: 'y', HTTP_PROXY: 'z', SystemRoot: 'r' }, { HF_HUB_OFFLINE: '1' }, 'win32'), { PATH: 'p', SYSTEMROOT: 'r', HF_HUB_OFFLINE: '1' });
});

test('claim 14: uvArgs holds the isolation flags on every call that reads an index', () => {
  for (const args of [uvArgs.venv('v'), uvArgs.install('p', 'l'), uvArgs.cacheDir()]) assert.ok(args.includes('--no-config'));
  for (const args of [uvArgs.venv('v'), uvArgs.install('p', 'l')]) assert.ok(args.includes('--index-url'));
  // uv refuses --managed-python with --python-preference, so each call holds one of the two, never neither.
  assert.ok(uvArgs.venv('v').includes('--managed-python') && !uvArgs.venv('v').includes('--python-preference'));
  assert.ok(uvArgs.install('p', 'l').includes('only-managed'));
  assert.ok(uvArgs.venv('v').includes('3.12.12'));
});

test('claim 14: the hosts the plan shows include every origin and every redirect host a download may touch', () => {
  const shown = new Set(HOSTS);
  for (const s of Object.values(SOURCES)) for (const h of [new URL(s.origin).hostname, ...(s.redirects ?? [])]) assert.ok(shown.has(h), h);
});

test('claim 14: the real table holds no .bz2, only https sources, full commits and 64-hex hashes', () => {
  for (const g of FILES) {
    assert.ok(Object.hasOwn(SOURCES, g.src));
    if (g.src === 'hf') assert.match(g.base, /\/resolve\/[0-9a-f]{40}\/$/);
    for (const [file, size, hash] of g.files) {
      assert.ok(!file.endsWith('.bz2'));
      assert.ok(Number.isInteger(size) && size >= 0);
      assert.match(hash, /^[0-9a-f]{64}$/);
    }
  }
  for (const a of ARCHIVES) {
    assert.ok(a.url.endsWith('.tgz') && !a.url.endsWith('.bz2'));
    assert.match(a.sha256, /^[0-9a-f]{64}$/);
    assert.ok(a.sha512.length === 88);
  }
  for (const s of Object.values(SOURCES)) assert.ok(s.origin.startsWith('https://') && s.redirects.every(h => /^[a-z0-9.-]+$/.test(h)));
  for (const lock of Object.values(LOCKS)) assert.ok(readFileSync(new URL(`../skills/incantation/scripts/runtime/${lock}`, import.meta.url), 'utf8').includes('--hash=sha256:'));
});

test('claim 15: plan prints each part\'s state and size and whether uv was found, and with no uv names what is lost', async () => {
  const f = fixture();
  try {
    const withUv = planRuntime({ home: f.home, platform, arch, uv: UV, pins: PINS }).lines;
    assert.ok(withUv.some(l => /^addon missing \d+ MB$/.test(l)));
    assert.ok(withUv.includes('uv found'));
    assert.ok(withUv.some(l => l.startsWith('total download ') && l.includes('peak disk') && l.includes('at 10 MB/s')));
    // The plan names exactly the table's hosts, as whole words and in order.
    assert.deepEqual(withUv.find(l => l.startsWith('hosts '))?.split(' ').slice(1), [...HOSTS]);
    const without = planRuntime({ home: f.home, platform, arch, uv: null, pins: PINS }).lines;
    assert.ok(without.includes('uv not found') && without.includes('python skipped no uv'));
    assert.ok(without.some(l => /echo cancelling/.test(l) && /end-of-turn/.test(l) && /Phonon/.test(l)));
    await install(f);
    assert.ok(planRuntime({ home: f.home, platform, arch, uv: UV, pins: PINS }).lines.some(l => /^hearing present \d+ MB$/.test(l)));
  } finally {
    f.remove();
  }
});

test('claim 15: with no uv the core installs and the Python layer is skipped; with too little disk nothing is fetched', async () => {
  const f = fixture();
  try {
    const log = [];
    const { lines, code } = await install(f, { pathValue: '', transport: fakeTransport(served(), log) });
    assert.equal(code, 0);
    assert.ok(lines.includes('python skipped no uv') && lines.includes('turn skipped no uv') && lines.includes('phonon skipped no uv'));
    assert.ok(lines.includes('hearing ok'));
    const g = fixture();
    try {
      const short = await install(g, { free: () => 10, transport: fakeTransport(served(), log) });
      assert.equal(short.code, 1);
      assert.match(short.lines[0], /not enough free disk space/);
      assert.equal(existsSync(join(runtimeDir(g.home), 'parakeet')), false);
    } finally {
      g.remove();
    }
  } finally {
    f.remove();
  }
});

test('claim 15: verify re-hashes (a same-size change is caught); the guard check sees a missing or short file but not a same-size change', async () => {
  const f = fixture();
  try {
    await install(f);
    const target = join(runtimeDir(f.home), 'parakeet', 'enc.bin');
    writeFileSync(target, Buffer.from('ENCODER BYTES'));
    assert.equal(partState(f.home, 'hearing', KEY, PINS), 'ok', 'the start check reads sizes only');
    const v = verifyRuntime({ home: f.home, platform, arch, pins: PINS });
    assert.ok(v.lines.includes('hearing failed enc.bin'), v.lines.join(' | '));
    assert.equal(v.code, 1);
    writeFileSync(target, Buffer.from('short'));
    assert.equal(partState(f.home, 'hearing', KEY, PINS), 'damaged');
    rmSync(target);
    assert.deepEqual(checkRuntime(f.home, KEY, PINS).damaged, ['hearing']);
    assert.equal(checkRuntime(f.home, KEY, PINS).core, false);
  } finally {
    f.remove();
  }
});

test('claim 15: nothing installed reads as absent for every part, and nothing is damaged', () => {
  const f = fixture();
  try {
    const c = checkRuntime(f.home, KEY, PINS);
    assert.deepEqual(c.damaged, []);
    assert.ok(Object.values(c.states).every(s => s === 'absent'));
    assert.equal(readdirSync(join(f.home, '.grimoire', 'incantation')).includes('runtime'), false);
  } finally {
    f.remove();
  }
});
