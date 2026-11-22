// The echo stack as the listener wires it (docs/spec/0001, S5.8; claim 9), with a
// fake recorder, engine, player, canceller and turn judge. Each layer is used
// when present and passed through when it fails; the text guard drops a heard
// echo and keeps a stop word; the turn hold joins and never loses a turn.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { stampOf } from '../skills/incantation/scripts/capture/ffmpeg.mjs';
import { ask, readChannel, say, startListener } from '../skills/incantation/scripts/listen.mjs';
import { secureState, settingsPath, writePrivate } from '../skills/incantation/scripts/lib.mjs';

const RECORDER = process.platform === 'win32' ? 'C:\\fake\\bin\\ffmpeg.exe' : '/fake/bin/ffmpeg';
const LISTINGS = {
  win32: '[in#0 @ 0000] "Desk Mic One" (audio)\n[in#0 @ 0000]   Alternative name "@device_cm_{MADEUP}\\wave_{0001}"\n',
  darwin: '[AVFoundation indev @ 0x1] AVFoundation audio devices:\n[AVFoundation indev @ 0x1] [0] Desk Mic One\n',
  linux: 'Auto-detected sources for pulse:\n* made_up_source.analog [Desk Mic One]\n',
};
const PARSED = { win32: [{ name: 'Desk Mic One', id: '@device_cm_{MADEUP}\\wave_{0001}' }], darwin: [{ name: 'Desk Mic One', id: ':0' }], linux: [{ name: 'Desk Mic One', id: 'made_up_source.analog' }] };
const listing = LISTINGS[process.platform] ?? LISTINGS.linux;
const STAMP = stampOf(PARSED[process.platform] ?? PARSED.linux);

const frame = amp => {
  const b = Buffer.alloc(960);
  for (let i = 0; i < 480; i++) b.writeInt16LE(i % 2 ? amp : -amp, i * 2);
  return b;
};
const tick = ms => new Promise(r => setTimeout(r, ms));
const raced = (p, ms = 300) => Promise.race([p, tick(ms).then(() => 'still waiting')]);
const wait = home => ask(readChannel(home), 'wait', 5000);

async function rig(t, { text = 'hello there', ...layers } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'incantation-wiring-'));
  secureState(home);
  writePrivate(settingsPath(home), JSON.stringify({ engine: 'voicebox', port: 17493, profile: 'p', device: { index: 0, stamp: STAMP }, recorder: RECORDER, endOfSpeechMs: 300 }));
  const feed = Object.assign(new EventEmitter(), { close() {} });
  const engine = {
    calls: 0,
    feed,
    tailMs: 300,
    health: async () => true,
    warm: async () => 42,
    synthesize: async () => Buffer.from('RIFF-made-up-audio'),
    transcribe: async () => (engine.calls++, typeof text === 'function' ? text(engine.calls) : text),
    playback: () => (setImmediate(() => feed.emit('open')), feed),
  };
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kill = () => setTimeout(() => child.emit('exit', 0), 10);
  const recorder = { path: RECORDER, list: async () => listing, spawn: () => child };
  const plays = [];
  const player = {
    available: true,
    play: wav => {
      let end;
      const done = new Promise(r => (end = r));
      const h = { done, end: o => end(o ?? 'ended'), stop: () => end('killed') };
      if (!String(wav).startsWith('RIFF-spin-')) plays.push(h);
      return h;
    },
  };
  const r = { home, engine, plays, t: 0 };
  r.push = (amp, n = 1) => {
    for (let i = 0; i < n; i++) {
      child.stdout.write(frame(amp));
      r.t += 30;
    }
  };
  const l = await startListener({ home, engine, recorder, player, clock: () => r.t, parentPid: 1234, ppid: () => 1234, parentAlive: () => true, knobs: { parentPollMs: 20, handshakeMs: 200, joinMs: 0 }, ...layers });
  t.after(async () => {
    await l.stop();
    rmSync(home, { recursive: true, force: true });
  });
  assert.match(await wait(home), /^ready /m);
  return r;
};

test('claim 9: a turn that starts over a line just spoken and repeats its words is dropped; a stop word over it is kept', async t => {
  const r = await rig(t, { text: n => (n === 1 ? 'I will run the tests now and tell you what they say' : 'stop') });
  r.push(1000, 34);
  assert.equal(await say(readChannel(r.home), 'I will run the tests now and tell you what they say.', 3000), 'speaking\n');
  r.push(3163, 15); // voice over the line: its echo
  r.push(1000, 15);
  const pending = wait(r.home);
  assert.equal(await raced(pending, 400), 'still waiting', 'the echo is not a turn');
  assert.equal(r.engine.calls, 1);
  r.push(3163, 15);
  r.push(1000, 15);
  assert.match(await pending, /Heard.*"stop"/, 'a stop word is never dropped as an echo');
});

test('claim 9: a canceller that is active cleans the frames the gate hears; one that fails passes them through', async t => {
  let calls = 0;
  const silent = { active: true, close() {}, process: async frame => (calls++, Buffer.alloc(frame.length)) };
  const a = await rig(t, { aec: silent });
  a.push(1000, 34);
  a.push(3163, 15);
  a.push(1000, 15);
  assert.equal(await raced(wait(a.home), 300), 'still waiting', 'loud mic, cleaned to silence: no turn');
  assert.ok(calls >= 60, 'every frame went through the canceller');

  const broken = { active: true, close() {}, process: async () => Promise.reject(new Error('worker')) };
  const b = await rig(t, { aec: broken });
  b.push(1000, 34);
  b.push(3163, 15);
  b.push(1000, 15);
  assert.match(await wait(b.home), /Heard.*"hello there"/, 'a failed canceller leaves the frame as the mic gave it');
});

test('claim 9: a turn that sounds unfinished is held and joined with what follows, transcribed once; and it is never held forever', async t => {
  const chances = [0.1, 0.9];
  const judge = { active: true, close() {}, done: async () => chances.shift() ?? null };
  const r = await rig(t, { turnJudge: judge });
  r.push(1000, 34);
  r.push(3163, 15);
  r.push(1000, 15);
  const held = wait(r.home);
  assert.equal(await raced(held, 300), 'still waiting', 'held, not delivered');
  assert.equal(r.engine.calls, 0, 'and not transcribed yet');
  r.push(1000, 30); // 0.9 s of quiet: still under the hold
  r.push(3163, 15);
  r.push(1000, 15);
  assert.match(await held, /Heard.*"hello there"/);
  assert.equal(r.engine.calls, 1, 'the two parts were joined and heard as one');

  const never = { active: true, close() {}, done: async () => 0.1 };
  const s = await rig(t, { turnJudge: never });
  s.push(1000, 34);
  s.push(3163, 15);
  s.push(1000, 15);
  const lone = wait(s.home);
  assert.equal(await raced(lone, 200), 'still waiting');
  s.push(1000, 100); // 3 s of quiet: past the hold
  assert.match(await lone, /Heard.*"hello there"/, 'the hold lets the turn go when nothing follows');
});
