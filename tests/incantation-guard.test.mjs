// Tests of guard.mjs (docs/spec/incantation.md, S5.6; claim 3), on a fake
// engine, a fake recorder file system and a fixture home. No real Voicebox.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { LINES, runGuard } from '../skills/incantation/scripts/guard.mjs';
import { secureState, settingsPath, writePrivate } from '../skills/incantation/scripts/lib.mjs';

const win = process.platform === 'win32';
const BIN = win ? 'C:\\fake\\bin' : '/fake/bin';
const RECORDER = win ? win32.join(BIN, 'ffmpeg.exe') : posix.join(BIN, 'ffmpeg');
const URL_OK = 'http://127.0.0.1:17493/mcp';
const PLANTED = 'sk-planted-fake-key-0123456789abcdef';

const fakeFs = {
  isFile: p => p === RECORDER,
  realpath: p => p,
  lstat: () => ({ uid: 0, mode: 0o40755 }),
  uid: () => 1000,
};

function fixture({ settings = {}, claude, project } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'incantation-guard-'));
  secureState(home);
  writePrivate(settingsPath(home), JSON.stringify({ engine: 'voicebox', port: 17493, profile: 'made-up', device: { index: 0, stamp: '0123456789abcdef' }, recorder: RECORDER, endOfSpeechMs: 1000, ...settings }));
  const claudeJson = claude ?? { mcpServers: { voicebox: { type: 'http', url: URL_OK } }, projects: {} };
  writeFileSync(join(home, '.claude.json'), typeof claudeJson === 'string' ? claudeJson : JSON.stringify(claudeJson));
  const projectDir = mkdtempSync(join(tmpdir(), 'incantation-project-'));
  if (project) writeFileSync(join(projectDir, '.mcp.json'), JSON.stringify(project));
  return { home, projectDir, remove: () => (rmSync(home, { recursive: true, force: true }), rmSync(projectDir, { recursive: true, force: true })) };
}

const engine = (over = {}) => ({ health: async () => true, ...over });

const guard = (f, over = {}) =>
  runGuard({ home: f.home, projectDir: f.projectDir, pathValue: BIN, startDir: f.projectDir, fs: fakeFs, engine: engine(), addresses: () => [], ...over });

const noValues = line => {
  assert.ok(!/127\.0\.0\.1|17493|fake|[\\/]Users|[\\/]home|sk-/.test(line), line);
  assert.ok(Object.values(LINES).includes(line) || line === 'ok', line);
};

test('ok with valid settings, a fake engine on 127.0.0.1 and a fake recorder', async t => {
  const f = fixture();
  t.after(f.remove);
  assert.equal(await guard(f), 'ok');
});

test('each check fails with its fixed line and no value', async t => {
  const cases = [
    [{}, { nodeVersion: '22.11.0' }, 'node'],
    [{}, { nodeVersion: '23.9.0' }, 'node'],
    [{ settings: { port: 80 } }, {}, 'settings'],
    [{ settings: { engine: 'elsewhere' } }, {}, 'engine'],
    [{ settings: { engine: '../../evil' } }, {}, 'settings'],
    [{}, { engine: engine({ health: async () => false }) }, 'health'],
    [{}, { addresses: () => ['192.0.2.10'], tcpOpen: async () => true }, 'reach'],
    [{ settings: { recorder: win ? 'C:\\elsewhere\\ffmpeg.exe' : '/elsewhere/ffmpeg' } }, {}, 'recorder'],
    [{}, { pathValue: '' }, 'recorder'],
    // The speech runtime (docs/spec/0001, S5.9, claim 15): an installed part with a
    // missing or short file fails either engine; the sherpa engine also needs its core.
    [{}, { checkRuntime: () => ({ damaged: ['hearing'], core: false, states: {} }) }, 'runtime'],
    [{ settings: { engine: 'sherpa' } }, { engine: engine({ name: 'sherpa', health: async () => false }) }, 'runtime'],
  ];
  for (const [fx, over, key] of cases) {
    const f = fixture(fx);
    const line = await guard(f, over);
    f.remove();
    assert.equal(line, LINES[key], `${key}: ${line}`);
    noValues(line);
  }
});

test('the sherpa engine opens no port, so the reach check does not run for it', async t => {
  const f = fixture({ settings: { engine: 'sherpa' } });
  t.after(f.remove);
  const asked = [];
  const line = await guard(f, { engine: engine({ name: 'sherpa' }), addresses: () => ['192.0.2.10'], tcpOpen: async (...a) => (asked.push(a), true) });
  assert.equal(line, 'ok');
  assert.deepEqual(asked, []);
});

test('the reach check asks every non-loopback address on the settings port', async t => {
  const f = fixture();
  t.after(f.remove);
  const asked = [];
  await guard(f, { addresses: () => ['192.0.2.10', '2001:db8::1'], tcpOpen: async (a, p) => (asked.push(`${a} ${p}`), false) });
  assert.deepEqual(asked, ['192.0.2.10 17493', '2001:db8::1 17493']);
});

test('it finishes within 2 s with every port timing out', async t => {
  const f = fixture();
  t.after(f.remove);
  const began = Date.now();
  const line = await guard(f, { addresses: () => ['192.0.2.10'], tcpOpen: () => new Promise(() => {}) });
  assert.ok(Date.now() - began < 2100);
  assert.equal(line, LINES.late);
});

test('T18: the guard no longer asks for a voicebox MCP registration, and never reads Claude Code\'s own config', async t => {
  for (const claude of [{ mcpServers: {} }, 'not json at all ' + PLANTED, { mcpServers: { voicebox: { type: 'stdio', command: '/usr/bin/bridge' } } }]) {
    const f = fixture({ claude });
    assert.equal(await guard(f), 'ok', 'the session speaks through the listener now, so the MCP entry is not its business');
    f.remove();
  }
  assert.equal(LINES.mcp, undefined);
});

// A link in place of the state folder: a junction on Windows, a symlink elsewhere.
const linkFolder = (target, path) => symlinkSync(target, path, win ? 'junction' : 'dir');

test('the state check fails closed on a link or junction in place, a real path outside home, and a looser mode', async t => {
  const outside = mkdtempSync(join(tmpdir(), 'incantation-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const moved = fixture();
  renameSync(join(moved.home, '.grimoire', 'incantation'), join(outside, 'incantation'));
  linkFolder(join(outside, 'incantation'), join(moved.home, '.grimoire', 'incantation'));
  assert.equal(await guard(moved), LINES.state, 'a link whose real path is outside home');
  moved.remove();
  const inside = fixture();
  renameSync(join(inside.home, '.grimoire', 'incantation'), join(inside.home, 'kept'));
  linkFolder(join(inside.home, 'kept'), join(inside.home, '.grimoire', 'incantation'));
  assert.equal(await guard(inside), LINES.state, 'a link, even to a folder inside home');
  inside.remove();
  if (!win) {
    for (const [path, mode] of [[join('.grimoire', 'incantation'), 0o755], [join('.grimoire', 'incantation', 'run'), 0o750], [join('.grimoire', 'incantation', 'settings.json'), 0o644]]) {
      const f = fixture();
      chmodSync(join(f.home, path), mode);
      assert.equal(await guard(f), LINES.state, `${path} at ${mode.toString(8)}`);
      f.remove();
    }
  }
});

test('T2: the guard says ok with the grimoire folder as its owner made it (eagle-eye\'s files beside ours, a looser mode on this platform)', async t => {
  const f = fixture();
  t.after(f.remove);
  mkdirSync(join(f.home, '.grimoire', 'eagle-eye'), { mode: 0o755 });
  if (!win) chmodSync(join(f.home, '.grimoire'), 0o755);
  assert.equal(await guard(f), 'ok');
});

test('T2: the first run moves an old ~/.incantation to ~/.grimoire/incantation, settings and all, and goes on; a folder already at the new place is never overwritten', async t => {
  const f = fixture();
  t.after(f.remove);
  const fresh = join(f.home, '.grimoire', 'incantation');
  const old = join(f.home, '.incantation');
  renameSync(fresh, old); // the shape the owner's machine has: settings, run/ and observe/ in the old place
  rmSync(join(f.home, '.grimoire'), { recursive: true, force: true });
  assert.equal(await guard(f), 'ok', 'the old settings are found where they were moved');
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(join(fresh, 'settings.json')), true);
  assert.equal(existsSync(join(fresh, 'run')) && existsSync(join(fresh, 'observe')), true);
  // Both folders present: the old one is left alone.
  mkdirSync(old);
  writeFileSync(join(old, 'settings.json'), 'old');
  assert.equal(await guard(f), 'ok');
  assert.equal(readFileSync(join(old, 'settings.json'), 'utf8'), 'old');
});

test('T2: an old ~/.incantation that is a link is never moved', async t => {
  const f = fixture();
  t.after(f.remove);
  const outside = mkdtempSync(join(tmpdir(), 'incantation-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const fresh = join(f.home, '.grimoire', 'incantation');
  renameSync(fresh, join(outside, 'incantation'));
  rmSync(join(f.home, '.grimoire'), { recursive: true, force: true });
  linkFolder(join(outside, 'incantation'), join(f.home, '.incantation'));
  // Nothing is moved into place, so the new folder is simply not there: settings
  // missing, and the install that follows makes a fresh folder.
  assert.equal(await guard(f), LINES.settings);
  assert.equal(existsSync(fresh), false);
});

test('the command line exits 1 on a failed check, and prints only its fixed line', async t => {
  const home = mkdtempSync(join(tmpdir(), 'incantation-guard-cli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const GUARD = fileURLToPath(new URL('../skills/incantation/scripts/guard.mjs', import.meta.url));
  const r = await new Promise(res => execFile(process.execPath, [GUARD], { cwd: home, env: { HOME: home, USERPROFILE: home, PATH: '' }, encoding: 'utf8', timeout: 15_000 }, (e, stdout) => res({ code: e ? e.code : 0, stdout })));
  assert.equal(r.code, 1);
  assert.ok(Object.values(LINES).includes(r.stdout.trimEnd()), r.stdout);
});

test('a machine where setup has not run is missing its settings, not an unsafe folder', async t => {
  const f = fixture();
  t.after(f.remove);
  rmSync(join(f.home, '.grimoire'), { recursive: true, force: true });
  assert.equal(await guard(f), LINES.settings);
});
