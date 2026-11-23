// Tests of the echo stack's modules (docs/spec/0001, S5.8; claim 9), with fake
// workers. Each layer is used when present and passed through when missing or
// failing, and every worker is started the one way the spec names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { join, win32 } from 'node:path';
import { RefFeed, isEcho, makeAec, makeLoopback, wavTo16k, windowsPowerShell } from '../skills/incantation/scripts/echo.mjs';
import { OUT_RATE, makeSpeech, makeStreamPlayer, wavSamples } from '../skills/incantation/scripts/stream.mjs';
import { TurnHold, makeTurnJudge } from '../skills/incantation/scripts/turn.mjs';

const HOME = join('fake', 'home');
const ENV = { PATH: 'p', SystemRoot: 'C:\\Windows', HF_TOKEN: 'secret', UV_INDEX_URL: 'x', HTTPS_PROXY: 'y' };

// A fake child process: its stdin is read by `onIn`, its stdout is written by the test.
function fakeChild(onIn = () => {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stdin.on('data', d => onIn(d, child));
  child.kill = () => {};
  child.exitCode = null;
  return child;
}
const spawnOf = (calls, child) => (file, args, opts) => {
  calls.push({ file, args, opts });
  return child;
};
const always = () => true;
const wav = (samples, rate) => {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0, 'latin1');
  b.write('WAVE', 8, 'latin1');
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt16LE(16, 34);
  samples.forEach((s, i) => b.writeInt16LE(s, 44 + i * 2));
  return b;
};

test('claim 9: the text guard drops a turn that mostly repeats a line just spoken, and never on nothing', () => {
  const spoken = ['I will run the tests now and tell you what they say.'];
  assert.equal(isEcho('run the tests now and tell you what they say', spoken), true);
  assert.equal(isEcho('please open the settings file instead', spoken), false);
  assert.equal(isEcho('', spoken), false);
  assert.equal(isEcho('run the tests', []), false);
});

test('claim 9: the reference feed hands out one frame at a time, stays near now, and a clear empties it', () => {
  const feed = new RefFeed();
  assert.equal(feed.empty, true);
  feed.add(Int16Array.from([1, 2, 3]));
  feed.add(Int16Array.from([10, 10, 10, 10]));
  assert.deepEqual([...feed.buf], [11, 12, 13, 10]);
  assert.equal(feed.take(2).readInt16LE(2), 12);
  feed.append(new Int16Array(40_000));
  assert.equal(feed.buf.length, 32_000, 'kept to two seconds');
  feed.trim(1600);
  assert.equal(feed.buf.length, 1600);
  feed.clear();
  assert.equal(feed.empty, true);
  assert.deepEqual([...wavTo16k(wav([0, 100, 200, 300], 8000))].length, 8);
  assert.equal(wavTo16k(Buffer.from('nope')).length, 0);
});

test('claim 9: the canceller is used when present, and is passed through when it is missing, wrong or gone', async () => {
  const mic = Buffer.alloc(960, 1);
  const ref = Buffer.alloc(960, 2);
  const missing = makeAec({ home: HOME, python: 'x', worker: 'y', exists: () => false });
  assert.equal(missing.active, false);
  assert.equal(await missing.process(mic, ref), mic);

  const calls = [];
  const child = fakeChild((d, c) => c.stdout.write(Buffer.alloc(960, 9)));
  const aec = makeAec({ home: HOME, platform: 'win32', env: ENV, python: 'py', worker: 'w.py', exists: always, spawn: spawnOf(calls, child) });
  child.stdout.write('AEC1');
  assert.equal(await aec.ready, true);
  const cleaned = await aec.process(mic, ref);
  assert.equal(cleaned[0], 9, 'the cleaned frame came back');
  assert.equal(await aec.process(Buffer.alloc(10), ref).then(b => b.length), 10, 'a wrong-sized frame passes through');

  child.emit('exit');
  assert.equal(aec.active, false);
  assert.equal(await aec.process(mic, ref), mic, 'a worker that exited passes frames through');

  const wrong = fakeChild();
  const bad = makeAec({ home: HOME, python: 'py', worker: 'w.py', exists: always, spawn: spawnOf([], wrong) });
  wrong.stdout.write('NOPE');
  assert.equal(await bad.ready, false);

  const thrower = makeAec({ home: HOME, python: 'py', worker: 'w.py', exists: always, spawn: () => { throw new Error('spawn'); } });
  assert.equal(thrower.active, false);
});

test('claim 9: every Python worker starts with no shell, -I, the given interpreter, pipes only, the state folder and a named environment', () => {
  const aecCalls = [];
  makeAec({ home: HOME, platform: 'win32', env: ENV, python: 'PY', worker: 'W.py', exists: always, spawn: spawnOf(aecCalls, fakeChild()) });
  const turnCalls = [];
  makeTurnJudge({ home: HOME, platform: 'win32', env: ENV, python: 'PY', worker: 'T.py', model: 'M.onnx', exists: always, spawn: spawnOf(turnCalls, fakeChild()) });
  for (const [{ file, args, opts }, tail] of [[aecCalls[0], ['W.py']], [turnCalls[0], ['T.py', 'M.onnx']]]) {
    assert.equal(file, 'PY');
    assert.deepEqual(args, ['-I', ...tail]);
    assert.equal(opts.shell, false);
    assert.deepEqual(opts.stdio, ['pipe', 'pipe', 'ignore']);
    assert.equal(opts.cwd, join(HOME, '.grimoire', 'incantation'));
    assert.deepEqual(Object.keys(opts.env).sort(), ['HF_HOME', 'HF_HUB_OFFLINE', 'PATH', 'SYSTEMROOT']);
  }
});

test('claim 9: the loopback runs Windows PowerShell by its absolute system path, and only on Windows', async () => {
  assert.equal(windowsPowerShell(ENV), win32.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  assert.equal(makeLoopback({ platform: 'linux', exists: always, onSamples() {} }).active, false);
  assert.equal(makeLoopback({ platform: 'win32', exists: () => false, onSamples() {} }).active, false);
  const calls = [];
  const child = fakeChild();
  const got = [];
  const lb = makeLoopback({ home: HOME, platform: 'win32', env: ENV, script: 'loop.ps1', exists: always, spawn: spawnOf(calls, child), onSamples: s => got.push(...s) });
  const { file, args, opts } = calls[0];
  assert.equal(file, windowsPowerShell(ENV));
  assert.deepEqual(args, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'loop.ps1']);
  assert.equal(opts.shell, false);
  assert.deepEqual(opts.stdio, ['ignore', 'pipe', 'ignore']);
  assert.equal(opts.cwd, join(HOME, '.grimoire', 'incantation'));
  assert.deepEqual(Object.keys(opts.env).sort(), ['PATH', 'SYSTEMROOT']);
  child.stdout.write(Buffer.concat([Buffer.from('LBK1'), Buffer.from([1, 0, 2, 0])]));
  await new Promise(r => setImmediate(r));
  assert.equal(lb.active, true);
  assert.deepEqual(got, [1, 2]);
  child.emit('exit');
  assert.equal(lb.active, false, 'a failed loopback hands back to the player\'s own samples');
});

test('claim 9: the steady player writes what is due, hands the reference out at 16 kHz, and settles a line ended or killed', async () => {
  assert.equal(makeStreamPlayer({ ffplay: undefined }), null);
  assert.equal(makeStreamPlayer({ ffplay: 'nowhere', exists: () => false }), null);
  const written = [];
  const child = fakeChild();
  child.stdin.on('data', d => written.push(d));
  const ref = [];
  const started = [];
  const player = makeStreamPlayer({ ffplay: 'ffplay', cwd: 'STATE', exists: always, spawn: (file, args, opts) => (started.push(opts), child), onWrite: s => ref.push(...s), timers: false, latencyMs: 0, leadMs: 0 });
  const line = player.play(wav(new Array(2400).fill(1000), OUT_RATE)); // 100 ms
  for (let i = 0; i < 6; i++) player.pump(30);
  assert.equal(started[0].cwd, 'STATE', 'ffplay starts in the state folder, not the session\'s');
  assert.equal(started[0].shell, false);
  assert.equal(await line.done, 'ended');
  assert.ok(written.length > 0);
  assert.equal(ref.length, 2880, 'six 30 ms frames of reference at 16 kHz, silence between lines included');
  const voiced = ref.filter(s => s === 1000).length;
  assert.ok(voiced >= 1500 && voiced <= 1700, `the 100 ms line is in the reference, got ${voiced} samples`);
  const second = player.play(wav(new Array(24000).fill(5), OUT_RATE));
  second.stop();
  assert.equal(await second.done, 'killed');
  assert.equal(player.play(Buffer.from('not a wav')), null);
  player.close();
  assert.equal(wavSamples(Buffer.from('x')), null);
});

// GRIM-57, macOS: every line was silent. A copy of this player was heard when
// ffplay started with the mic already open and the stream ran 300 ms ahead.
// The listener started ffplay before the mic, and its first mic frame put the
// stream only one frame ahead, where it stayed.
test('claim 9: the pumped player starts ffplay on the first mic frame', () => {
  const spawned = [];
  const player = makeStreamPlayer({ ffplay: 'ffplay', exists: always, spawn: (...a) => (spawned.push(a), fakeChild()), timers: false });
  assert.ok(player.play(wav(new Array(2400).fill(1000), OUT_RATE)), 'a line is accepted before the mic has started');
  assert.equal(spawned.length, 0, 'ffplay waits for the mic, so it opens the output device the open mic leaves');
  player.pump(30);
  player.pump(30);
  assert.equal(spawned.length, 1, 'one ffplay, started by the first frame');
  player.close();
});

test('claim 9: the pumped player runs the lead ahead of the mic from the first frame on', async () => {
  const written = [];
  const child = fakeChild(d => written.push(d));
  const player = makeStreamPlayer({ ffplay: 'ffplay', exists: always, spawn: () => child, timers: false, leadMs: 300 });
  player.play(wav(new Array(24000).fill(1000), OUT_RATE));
  player.pump(30);
  const bytes = () => written.reduce((n, d) => n + d.length, 0);
  await new Promise(r => setImmediate(r));
  assert.equal(bytes(), ((330 * OUT_RATE) / 1000) * 2, 'the first frame writes the frame and the 300 ms lead');
  for (let i = 0; i < 10; i++) player.pump(30);
  await new Promise(r => setImmediate(r));
  assert.equal(bytes(), ((630 * OUT_RATE) / 1000) * 2, 'each frame after adds exactly its length, so the lead holds');
  player.close();
});

test('claim 9: a player closed before the mic started never starts ffplay', () => {
  const spawned = [];
  const player = makeStreamPlayer({ ffplay: 'ffplay', exists: always, spawn: (...a) => (spawned.push(a), fakeChild()), timers: false });
  player.close();
  player.pump(30);
  assert.equal(spawned.length, 0);
});

test('claim 9: the speech detector is off with no model, and answers per frame with one', () => {
  assert.equal(makeSpeech({ model: 'm', exists: () => false }), null);
  assert.equal(makeSpeech({ model: 'm', exists: always, load: () => { throw new Error('no addon'); } }), null);
  let detected = false;
  const sherpa = { Vad: class { acceptWaveform() {} isEmpty() { return true; } isDetected() { return detected; } } };
  const speech = makeSpeech({ model: 'm', exists: always, load: () => sherpa });
  assert.equal(speech(Buffer.alloc(960)), false);
  detected = true;
  assert.equal(speech(Buffer.alloc(960)), true);
});

test('claim 9: the turn judge answers a chance, and is off or null when the model or worker is missing or gone', async () => {
  const off = makeTurnJudge({ home: HOME, python: 'p', worker: 'w', model: 'm', exists: () => false });
  assert.equal(off.active, false);
  assert.equal(await off.done(Buffer.alloc(100)), null);
  const child = fakeChild((d, c) => {
    const p = Buffer.alloc(4);
    p.writeFloatLE(0.25, 0);
    c.stdout.write(p);
  });
  const judge = makeTurnJudge({ home: HOME, python: 'p', worker: 'w', model: 'm', exists: always, spawn: () => child });
  child.stdout.write('TRN1');
  await new Promise(r => setImmediate(r));
  assert.equal(judge.active, true);
  assert.equal(await judge.done(Buffer.alloc(3200)), 0.25);
  child.emit('exit');
  assert.equal(await judge.done(Buffer.alloc(3200)), null);
});

test('claim 9: the turn hold joins a turn judged unfinished with what follows, and never ends a turn sooner', async () => {
  const released = [];
  const verdicts = [0.1, 0.1, 0.9];
  const judge = { done: async () => verdicts.shift() ?? null };
  const hold = new TurnHold({ judge, release: t => released.push(t), holdMs: 2500, threshold: 0.5, maxJoins: 3 });
  await hold.offer({ pcm: Buffer.from('aa'), overlap: false }, 0);
  assert.equal(hold.holding, true, 'an unfinished turn is held, not released');
  assert.equal(released.length, 0);
  hold.tick(1000, false);
  assert.equal(released.length, 0, 'still waiting under holdMs');
  hold.tick(1500, true);
  hold.tick(3000, false);
  assert.equal(released.length, 0, 'speech heard restarts the quiet');
  await hold.offer({ pcm: Buffer.from('bb'), overlap: true }, 3100);
  assert.equal(hold.holding, true);
  await hold.offer({ pcm: Buffer.from('cc') }, 3200);
  assert.equal(released.length, 1);
  assert.equal(released[0].pcm.toString(), 'aabbcc', 'the three joined');
  assert.equal(released[0].overlap, true);
  assert.equal(released[0].joins, 2);
  // Quiet long enough lets a held turn go.
  const quiet = [];
  const h2 = new TurnHold({ judge: { done: async () => 0.1 }, release: t => quiet.push(t), holdMs: 2500 });
  await h2.offer({ pcm: Buffer.from('x') }, 0);
  h2.tick(2499, false);
  assert.equal(quiet.length, 0);
  h2.tick(2500, false);
  assert.equal(quiet.length, 1);
  // No verdict (model not running): the turn goes straight through, as before.
  const direct = [];
  await new TurnHold({ judge: { done: async () => null }, release: t => direct.push(t) }).offer({ pcm: Buffer.from('y') }, 0);
  assert.equal(direct.length, 1);
  // After maxJoins joins it goes without asking again.
  const capped = [];
  const asked = [];
  const h3 = new TurnHold({ judge: { done: async () => (asked.push(1), 0.1) }, release: t => capped.push(t), maxJoins: 1 });
  await h3.offer({ pcm: Buffer.from('1') }, 0);
  await h3.offer({ pcm: Buffer.from('2') }, 1);
  assert.equal(capped.length, 1);
  assert.equal(asked.length, 1, 'the second offer reached maxJoins and was not judged again');
});
