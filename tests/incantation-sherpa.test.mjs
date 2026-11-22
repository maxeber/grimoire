// Tests of engines/sherpa.mjs and the engine table (docs/spec/0001, S5.10,
// S13.10; claims 16 and 17), with a fake addon and a fake worker. No model, no
// Python, no real runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isEngine, loadEngine } from '../skills/incantation/scripts/engines/index.mjs';
import { makeEngine } from '../skills/incantation/scripts/engines/sherpa.mjs';
import { SETTINGS_DEFAULTS, parseSettings, secureState } from '../skills/incantation/scripts/lib.mjs';
import { platformKey, runtimeDir } from '../skills/incantation/scripts/runtime/install.mjs';

const KEY = platformKey(process.platform, process.arch);

// A fake addon that records what it is asked, and returns fixed answers.
function fakeAddon(log) {
  return {
    OfflineTts: class {
      constructor(cfg) {
        log.push(['tts', cfg]);
      }
      generate(args) {
        log.push(['generate', args]);
        return { samples: Float32Array.from([0, 0.5, -0.5]), sampleRate: 24000 };
      }
    },
    OfflineRecognizer: class {
      constructor(cfg) {
        log.push(['asr', cfg]);
      }
      createStream() {
        return { acceptWaveform: a => log.push(['wave', a.samples.length]) };
      }
      decode() {
        log.push(['decode']);
      }
      getResult() {
        return { text: '  hello there ' };
      }
    },
  };
}

// A small table of the same shape as the real one: each part has one file, so
// a fixture can write every file at its pinned size.
const PINS = {
  ARCHIVES: [{ name: 'win', url: '/w', platform: KEY, dest: 'node_modules/w', size: 1, sha256: '0'.repeat(64), sha512: '', files: [['a.node', 3, '0'.repeat(64)]] }],
  FILES: ['hearing', 'speaking', 'detector', 'turn', 'phonon'].map(part => ({ part, src: 'hf', base: '/o/r/resolve/abc/', dest: `${part}/`, files: [['f.bin', 4, '0'.repeat(64)]] })),
  LOCKS: {},
};

function installFake(home, parts) {
  const put = (rel, size) => {
    const p = join(runtimeDir(home), ...rel.split('/'));
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, Buffer.alloc(size));
  };
  if (parts.includes('addon')) put('node_modules/w/a.node', 3);
  for (const part of parts.filter(p => p !== 'addon')) put(`${part}/f.bin`, 4);
}

const fixture = () => {
  const home = mkdtempSync(join(tmpdir(), 'incantation-sherpa-'));
  secureState(home);
  return { home, remove: () => rmSync(home, { recursive: true, force: true }) };
};

test('claim 16: warm loads and runs each model once; transcribe and synthesize return text and a WAV', async () => {
  const f = fixture();
  try {
    const log = [];
    const engine = makeEngine({ port: 17493, profile: 'bella', home: f.home, load: () => fakeAddon(log) });
    const ms = await engine.warm();
    assert.ok(Number.isInteger(ms));
    assert.equal(log.filter(l => l[0] === 'tts').length, 1);
    assert.equal(log.filter(l => l[0] === 'asr').length, 1);
    assert.equal(log.filter(l => l[0] === 'generate').length, 1);
    assert.equal(log.filter(l => l[0] === 'decode').length, 1);
    assert.equal(await engine.transcribe(Buffer.alloc(3200)), 'hello there');
    const wav = await engine.synthesize('Okay.');
    assert.equal(wav.toString('latin1', 0, 4), 'RIFF');
    assert.equal(wav.readUInt32LE(24), 24000);
    assert.equal(log.filter(l => l[0] === 'tts').length, 1, 'the model was loaded once');
    assert.equal(await engine.synthesize(''), null);
  } finally {
    f.remove();
  }
});

test('claim 16: no provider but cpu is ever passed, and no PATH is changed', async () => {
  const f = fixture();
  const before = process.env.PATH;
  try {
    const log = [];
    const engine = makeEngine({ port: 17493, profile: 'bella', home: f.home, load: () => fakeAddon(log) });
    await engine.warm();
    const providers = JSON.stringify(log.filter(l => l[0] === 'tts' || l[0] === 'asr'), (k, v) => v);
    assert.deepEqual([...providers.matchAll(/"provider":"([a-z]+)"/g)].map(m => m[1]), ['cpu', 'cpu']);
    assert.equal(process.env.PATH, before);
    for (const name of ['cuda', 'CUDA', 'Ollama']) assert.ok(!providers.includes(name));
  } finally {
    f.remove();
  }
});

test('claim 16: profiles lists bella, and everly only when Phonon is installed', async () => {
  const f = fixture();
  try {
    const engine = () => makeEngine({ port: 17493, home: f.home, pins: PINS });
    assert.deepEqual((await engine().profiles()).map(p => p.id), ['bella']);
    installFake(f.home, ['phonon']);
    assert.deepEqual((await engine().profiles()).map(p => p.id), ['bella', 'everly']);
  } finally {
    f.remove();
  }
});

test('claim 16: a Phonon voice runs in a worker started with no shell, -I, the runtime interpreter, the state folder and a named environment', async () => {
  const f = fixture();
  try {
    const calls = [];
    const spawn = (file, args, opts) => {
      calls.push({ file, args, opts });
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stdin = new PassThrough();
      child.exitCode = null;
      child.kill = () => {};
      const pcm = Buffer.alloc(4);
      child.stdin.on('data', () => child.stdout.write(`${JSON.stringify({ ok: true, rate: 24000, pcm: pcm.toString('base64') })}\n`));
      setImmediate(() => child.stdout.write(`${JSON.stringify({ ready: true, rate: 24000 })}\n`));
      return child;
    };
    const env = { PATH: 'p', HF_TOKEN: 'secret', UV_INDEX_URL: 'x', SystemRoot: 'r' };
    const engine = makeEngine({ port: 17493, profile: 'everly', home: f.home, load: () => fakeAddon([]), spawn, env, platform: 'win32', pins: PINS });
    await engine.warm();
    const wav = await engine.synthesize('Hello.');
    assert.equal(wav.toString('latin1', 0, 4), 'RIFF');
    const [{ file, args, opts }] = calls;
    assert.ok(file.startsWith(runtimeDir(f.home)) && /python/i.test(file));
    assert.equal(args[0], '-I');
    assert.equal(args[2], 'Everly');
    assert.equal(opts.shell, false);
    assert.deepEqual(opts.stdio, ['pipe', 'pipe', 'ignore']);
    assert.equal(opts.cwd, join(f.home, '.grimoire', 'incantation'));
    assert.deepEqual(Object.keys(opts.env).sort(), ['HF_HOME', 'HF_HUB_OFFLINE', 'PATH', 'SYSTEMROOT']);
    assert.equal(opts.env.HF_HUB_OFFLINE, '1');
    assert.equal(opts.env.HF_HOME, join(runtimeDir(f.home), 'hf'));
  } finally {
    f.remove();
  }
});

test('claim 16: health is false until every core part is installed with its pinned sizes, then true', async () => {
  const f = fixture();
  try {
    const engine = () => makeEngine({ port: 17493, profile: 'bella', home: f.home, pins: PINS });
    assert.equal(await engine().health(), false);
    installFake(f.home, ['addon', 'hearing', 'speaking']);
    assert.equal(await engine().health(), false, 'the speech detector is still missing');
    installFake(f.home, ['detector']);
    assert.equal(await engine().health(), true);
    writeFileSync(join(runtimeDir(f.home), 'hearing', 'f.bin'), 'x');
    assert.equal(await engine().health(), false, 'a short file');
  } finally {
    f.remove();
  }
});

test('claim 17: the engine table holds sherpa and voicebox and nothing else', async () => {
  assert.ok(isEngine('sherpa') && isEngine('voicebox'));
  assert.ok(!isEngine('whisper') && !isEngine('__proto__') && !isEngine(undefined));
  const e = await loadEngine('sherpa', { port: 17493, profile: 'bella' });
  assert.equal(e.name, 'sherpa');
  await assert.rejects(loadEngine('whisper', {}), /engine/);
});

test('claim 17: a settings file with no engine key reads as voicebox; sherpa is read when written; an old file still passes', () => {
  assert.equal(SETTINGS_DEFAULTS.engine, 'voicebox');
  const base = { profile: 'p', device: { index: 0, stamp: '0123456789abcdef' }, recorder: process.platform === 'win32' ? 'C:\\bin\\ffmpeg.exe' : '/bin/ffmpeg' };
  assert.equal(parseSettings(JSON.stringify(base)).engine, 'voicebox');
  assert.equal(parseSettings(JSON.stringify({ ...base, engine: 'sherpa' })).engine, 'sherpa');
  assert.equal(parseSettings(JSON.stringify({ ...base, engine: 'voicebox', port: 17493 })).port, 17493);
});
