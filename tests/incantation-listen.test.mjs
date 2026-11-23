// Tests of listen.mjs (docs/spec/incantation.md, S6; claims 4, 6, 8, 10, 11
// and 12). Everything runs on a fake engine and a fake recorder passed in
// through startListener's options: tones and silence only, never recorded
// speech, and made-up device listings. The same tests run on every platform.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { stampOf } from '../skills/incantation/scripts/capture/ffmpeg.mjs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SPINNERS, ask, leadSilence, pickSpinner, readChannel, runListing, say, startListener, waitLines } from '../skills/incantation/scripts/listen.mjs';

const LISTEN = fileURLToPath(new URL('../skills/incantation/scripts/listen.mjs', import.meta.url));
import { deviceDigest, ensureKey, observeDir, runDir, secureState, settingsPath, writePrivate } from '../skills/incantation/scripts/lib.mjs';

const RECORDER = process.platform === 'win32' ? 'C:\\fake\\bin\\ffmpeg.exe' : '/fake/bin/ffmpeg';
// A made-up listing in the Windows format; the Linux and macOS rows read their own.
const LISTINGS = {
  win32: '[in#0 @ 0000] "Desk Mic One" (audio)\n[in#0 @ 0000]   Alternative name "@device_cm_{MADEUP}\\wave_{0001}"\n',
  darwin: '[AVFoundation indev @ 0x1] AVFoundation audio devices:\n[AVFoundation indev @ 0x1] [0] Desk Mic One\n',
  linux: 'Auto-detected sources for pulse:\n* made_up_source.analog [Desk Mic One]\n',
};
const listing = LISTINGS[process.platform] ?? LISTINGS.linux;
// A listing with nothing but a device that records what plays: never opened as a mic (S5.5).
const LOOPBACK_ONLY = {
  win32: '[in#0 @ 0000] "Stereo Mix (Made Up)" (audio)\n[in#0 @ 0000]   Alternative name "@device_cm_{LOOP}\\wave_{0002}"\n',
  darwin: '[AVFoundation indev @ 0x1] AVFoundation audio devices:\n[AVFoundation indev @ 0x1] [0] BlackHole 2ch\n',
  linux: 'Auto-detected sources for pulse:\n* made_up_source.analog-stereo.monitor [Monitor of Made Up Speakers]\n',
};
const PARSED = { win32: [{ name: 'Desk Mic One', id: '@device_cm_{MADEUP}\\wave_{0001}' }], darwin: [{ name: 'Desk Mic One', id: ':0' }], linux: [{ name: 'Desk Mic One', id: 'made_up_source.analog' }] };
const STAMP = stampOf(PARSED[process.platform] ?? PARSED.linux);

const frame = amp => {
  const b = Buffer.alloc(960);
  for (let i = 0; i < 480; i++) b.writeInt16LE(i % 2 ? amp : -amp, i * 2);
  return b;
};

function makeHome(overrides = {}) {
  const home = mkdtempSync(join(tmpdir(), 'incantation-home-'));
  secureState(home);
  const settings = { engine: 'voicebox', port: 17493, profile: 'made-up-profile', device: { index: 0, stamp: STAMP }, recorder: RECORDER, endOfSpeechMs: 300, ...overrides };
  writePrivate(settingsPath(home), JSON.stringify(settings));
  return home;
}

function fakeEngine({ text = 'hello there', warm = async () => 42, health = true, synth } = {}) {
  const feed = new EventEmitter();
  feed.close = () => {};
  const engine = {
    calls: 0,
    synthesized: [],
    wav: Buffer.from('RIFF-made-up-audio'),
    // The ten spinner words are made once after ready (S5.2); each is its own small buffer, and none is a reply.
    synthesize: async text => {
      if (SPINNERS.includes(text)) return Buffer.from(`RIFF-spin-${text}`);
      engine.synthesized.push(text);
      return synth === undefined ? engine.wav : typeof synth === 'function' ? synth(text) : synth;
    },
    feed,
    tailMs: 300,
    health: async () => health,
    warm,
    transcribe: async () => {
      engine.calls++;
      return typeof text === 'function' ? text() : text;
    },
    playback: () => (setImmediate(() => feed.emit('open')), feed),
  };
  return engine;
}

// A player the test drives: each play is a handle that ends when the test says so.
// A spinner word is not a reply: it is kept apart in `spinners`, and ends by itself after a moment, as a short clip does.
function fakePlayer({ available = true, spinnerMs = 20 } = {}) {
  const p = { available, plays: [], spinners: [], stops: 0 };
  p.play = wav => {
    if (!available) return null;
    let resolve;
    const done = new Promise(r => (resolve = r));
    const h = { wav, done, stopped: false, end: outcome => resolve(outcome ?? 'ended'), stop: () => ((h.stopped = true), p.stops++, resolve('killed')) };
    if (Buffer.isBuffer(wav) && wav.toString().startsWith('RIFF-spin-')) {
      h.word = wav.toString().slice('RIFF-spin-'.length);
      h.stop = () => ((h.stopped = true), resolve('killed'));
      p.spinners.push(h);
      setTimeout(() => h.end(), spinnerMs);
      return h;
    }
    p.plays.push(h);
    return h;
  };
  return p;
}

function fakeRecorder({ path = RECORDER, list = listing } = {}) {
  const r = { path, spawned: [], killed: false, exited: false, listed: 0 };
  r.list = async () => (r.listed++, list);
  r.spawn = (file, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    // The recorder takes a moment to exit, so a stop that does not wait for it shows.
    child.kill = () => {
      r.killed = true;
      setTimeout(() => {
        r.exited = true;
        child.emit('exit', 0);
      }, 40);
    };
    r.child = child;
    r.spawned.push({ file, args });
    return child;
  };
  return r;
}

// A clock the test moves: each pushed frame is 30 ms.
function rig(options = {}) {
  const home = options.home ?? makeHome(options.settings);
  const engine = options.engine ?? fakeEngine(options.engineOptions);
  const recorder = options.recorder ?? fakeRecorder();
  const player = options.player ?? fakePlayer();
  const r = { home, engine, recorder, player, t: 0 };
  r.start = () =>
    startListener({
      home,
      engine,
      recorder,
      player,
      clock: () => r.t,
      parentPid: options.parentPid ?? 1234,
      ppid: options.ppid ?? (() => 1234),
      parentAlive: options.parentAlive ?? (() => true),
      knobs: { parentPollMs: 20, handshakeMs: 200, joinMs: 0, ...options.knobs },
    });
  r.push = (amp, n = 1) => {
    for (let i = 0; i < n; i++) {
      recorder.child.stdout.write(frame(amp));
      r.t += 30;
    }
  };
  r.turn = () => {
    r.push(1000, 34); // the room's level
    r.push(3163, 15); // voice, 10 dB over it
    r.push(1000, 15); // the end of the turn
  };
  r.cleanup = () => rmSync(home, { recursive: true, force: true });
  return r;
}

const wait = home => ask(readChannel(home), 'wait', 5000);
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

test('a turn goes through the engine and a waiter is told what was heard, with the timing and the ready line', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  await tick();
  r.turn();
  await tick(80); // the turn is queued before the wait asks
  const out = await wait(r.home);
  assert.match(out, /^Heard: "hello there"$/m);
  assert.match(out, /^timing: wait 300 stt \d+$/m);
  assert.match(out, /^ready 42 voice made-up-profile$/m);
  assert.equal(r.engine.calls, 1);
  assert.deepEqual(r.recorder.spawned[0].file, RECORDER);
});

test('T5: a turn the engine hears as a lone "you" or "Thank you." never reaches a waiter', async t => {
  for (const text of ['you', 'Thank you.']) {
    const r = rig({ engineOptions: { text } });
    const l = await r.start();
    assert.match(await wait(r.home), /^ready /m);
    await tick();
    r.turn();
    const pending = wait(r.home);
    const out = await Promise.race([pending, tick(300).then(() => 'still waiting')]);
    assert.equal(out, 'still waiting', `${text}: a dropped fragment costs the session no turn (T14)`);
    assert.equal(r.engine.calls, 1, 'it was transcribed, then dropped');
    await l.stop();
    r.cleanup();
  }
});

const statusOf = home => readFileSync(join(runDir(home), 'status'), 'utf8').trim();
const texts = (...list) => () => list.shift() ?? 'hello there';
const cli = (home, command) => ask(readChannel(home), command, 3000);

test('T8, T11 and T18: the mic stays open while the listener plays a reply; talking over it kills the player, tells the session, and the turn is heard as a reply', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.match(await wait(r.home), /^ready /m);
  r.push(1000, 34);
  assert.equal(await say(readChannel(r.home), 'Got it, I will check the test run.', 3000), 'speaking\n');
  assert.equal(r.player.plays.length, 1);
  r.push(3163, 11);
  assert.equal(r.player.stops, 0, 'a cough is not a barge-in');
  r.push(3163, 5);
  assert.equal(r.player.stops, 1, 'the player is killed, not asked to finish');
  assert.equal(r.player.plays[0].stopped, true);
  r.push(1000, 15);
  await tick(80);
  const out = await wait(r.home);
  assert.match(out, /^Heard \(after reply\): "hello there"$/m);
  assert.match(out, /^interrupted$/m, 'the session is told its reply was cut, with the turn that cut it');
  assert.match(out, /^plays 1$/m);
  assert.equal(r.engine.calls, 1);
});

test('T18: a reply that is cut drops what was queued behind it, and a person who is muted can still be spoken to', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.match(await wait(r.home), /^ready /m);
  r.push(1000, 34);
  const channel = readChannel(r.home);
  const first = say(channel, 'First line.', 3000);
  assert.equal(await first, 'speaking\n');
  const second = say(channel, 'Second line.', 3000);
  await tick(40);
  assert.equal(r.player.plays.length, 1, 'the second line waits for the first');
  r.push(3163, 16);
  assert.equal(await second, 'say-failed\n', 'cut with the reply before it');
  assert.equal(r.player.plays.length, 1, 'and never played');
});

test('T11: only the person mutes: a spoken mute, then nothing reaches the session until a spoken unmute; the mic stays open', async t => {
  const r = rig({ engineOptions: { text: texts('Mute.', 'do not hear this', 'Unmute.', 'hello there') } });
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.match(await wait(r.home), /^ready /m);
  r.turn();
  await tick(60);
  assert.equal(statusOf(r.home), 'muted');
  r.turn();
  await tick(60);
  assert.equal(r.engine.calls, 2, 'a muted turn is still transcribed here, only to catch unmute');
  r.turn();
  await tick(60);
  assert.notEqual(statusOf(r.home), 'muted');
  r.turn();
  await tick(60);
  const out = await wait(r.home);
  assert.match(out, /^Heard: "hello there"$/m);
  assert.match(out, /^mic-unmuted$/m);
  assert.doesNotMatch(out, /Heard: "(?:un)?mute|do not hear/i, 'the mute word is the listener\'s, and nothing said while muted reaches the session');
});

test('T11: the mute and unmute commands work through the channel, are the person\'s alone to give, and the status word follows', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.equal(await cli(r.home, 'status'), 'listening\n');
  assert.equal(await cli(r.home, 'mute'), 'mic-muted\n');
  assert.equal(await cli(r.home, 'status'), 'muted\n');
  r.turn();
  await tick(60);
  assert.equal(r.engine.calls, 1, 'transcribed locally only for the unmute word');
  assert.equal(await cli(r.home, 'unmute'), 'mic-unmuted\n');
  assert.equal(await ask({ ...readChannel(r.home), token: '0'.repeat(64) }, 'mute', 1000), null, 'no mute without the token');
  assert.equal(await cli(r.home, 'status'), 'listening\n');
});

test('T9: the status file holds one word, listening, hearing, speaking or muted, and goes when the listener does', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  assert.equal(statusOf(r.home), 'listening');
  r.push(1000, 34);
  r.push(3163, 3);
  assert.equal(statusOf(r.home), 'hearing');
  r.push(1000, 15);
  assert.equal(await say(readChannel(r.home), 'A line.', 3000), 'speaking\n');
  assert.equal(statusOf(r.home), 'speaking', 'from the moment the player starts');
  r.player.plays[0].end();
  await tick(30);
  assert.notEqual(statusOf(r.home), 'speaking', 'and not a moment past its real end');
  if (process.platform !== 'win32') assert.equal(statSync(join(runDir(r.home), 'status')).mode & 0o777, 0o600);
  await l.stop();
  assert.equal(existsSync(join(runDir(r.home), 'status')), false);
});

test('T9: a second start that is refused as busy leaves the first listener\'s status file alone', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  await assert.rejects(rig({ home: r.home }).start(), { reason: 'busy' });
  assert.equal(statusOf(r.home), 'listening');
});

test('T12: idle returns only once no reply is playing, and gives up after the idle wait', async t => {
  const r = rig({ knobs: { idleWaitMs: 900 } });
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.equal(await cli(r.home, 'idle'), 'idle\n', 'nothing playing: at once');
  assert.equal(await say(readChannel(r.home), 'One.', 3000), 'speaking\n');
  let settled = false;
  const pending = cli(r.home, 'idle').then(v => ((settled = true), v));
  await tick(150);
  assert.equal(settled, false, 'held while a reply plays');
  r.player.plays[0].end();
  await tick(100);
  assert.equal(settled, false, 'and for the tail after it');
  assert.equal(await pending, 'idle\n');
  assert.equal(await say(readChannel(r.home), 'Two.', 3000), 'speaking\n');
  assert.equal(await cli(r.home, 'idle'), 'idle-timeout\n', 'a reply that never ends does not hold the session for ever');
});

test('T10: a turn cut at a breath is joined to the next; one that is left hanging goes on its own after the join wait', async t => {
  const r = rig({ engineOptions: { text: texts('and then rename the', 'parse helper, please.', 'so I was thinking') }, knobs: { joinMs: 150 } });
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.match(await wait(r.home), /^ready /m);
  r.turn();
  await tick(40);
  r.turn();
  const joined = await wait(r.home);
  assert.match(joined, /^Heard: "and then rename the parse helper, please\."$/m);
  r.turn();
  const hung = await wait(r.home);
  assert.match(hung, /^Heard: "so I was thinking"$/m);
});

test('T13: a second wait while one is live says a wait is already running, and does not end the listener', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  assert.match(await wait(r.home), /^ready /m);
  const first = wait(r.home);
  await tick(50);
  assert.equal(await wait(r.home), 'listener error waiting\n');
  assert.equal(await cli(r.home, 'ping'), 'alive\n');
  await l.stop();
  await first;
});

test('a feed that fails ends the listener with playback, capturing nothing more', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  r.engine.feed.emit('error', new Error('x'));
  assert.equal(await l.done, 'playback');
  assert.equal(r.recorder.killed, true);
});

test('three seconds of all-zero frames at start end it with mic', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  r.push(0, 101);
  assert.equal(await l.done, 'mic');
});

test('a warm that fails or takes too long ends it with warm', async t => {
  for (const warm of [async () => Promise.reject(new Error('x')), () => new Promise(() => {})]) {
    const r = rig({ engineOptions: { warm }, knobs: { warmMs: 50 } });
    const l = await r.start();
    assert.equal(await l.done, 'warm');
    r.cleanup();
  }
  t.diagnostic('both ended with warm');
});

test('the channel binds 127.0.0.1 only and listen.json holds no more than the port and token', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  const channel = readChannel(r.home);
  assert.deepEqual(Object.keys(channel).sort(), ['port', 'token']);
  const other = Object.values(networkInterfaces()).flat().find(a => a && !a.internal && a.family === 'IPv4');
  if (other) {
    const refused = await new Promise(res => {
      const s = connect({ host: other.address, port: channel.port });
      s.on('connect', () => (s.destroy(), res(false)));
      s.on('error', () => res(true));
    });
    assert.equal(refused, true, 'not reachable on a non-loopback address');
  } else t.diagnostic('no non-loopback IPv4 address on this runner');
  if (process.platform !== 'win32') assert.equal(statSync(join(runDir(r.home), 'listen.json')).mode & 0o777, 0o600);
});

test('no token, a wrong token, or none within the handshake is closed and holds no slot; a second waiter is busy', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  const channel = readChannel(r.home);
  assert.equal(await ask({ ...channel, token: '0'.repeat(64) }, 'wait', 1000), null);
  assert.equal(await ask({ port: channel.port, token: '' }, 'wait', 1000), null);
  const silent = await new Promise(res => {
    const s = connect({ host: '127.0.0.1', port: channel.port });
    s.on('close', () => res(true));
    s.on('error', () => {});
  });
  assert.equal(silent, true, 'closed after the handshake time');
  assert.match(await wait(r.home), /^ready /m, 'the ready line goes to the first waiter');
  const first = ask(channel, 'wait', 3000);
  await tick(50);
  assert.equal(await ask(channel, 'wait', 1000), 'listener error waiting\n', 'T13: it says a wait is already running');
  l.stop();
  await first;
});

test('ping answers alive, never the token, and takes no queued turn; a second start is busy and leaves the first running', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  await tick();
  r.turn();
  await tick(50);
  const channel = readChannel(r.home);
  const pong = await ask(channel, 'ping', 1000);
  assert.equal(pong, 'alive\n');
  assert.ok(!pong.includes(channel.token));
  await assert.rejects(rig({ home: r.home }).start(), { reason: 'busy' });
  assert.match(await wait(r.home), /^Heard: "hello there"$/m, 'the turn is still there');
});

test('stop reaches the listener only through the channel; its recorder has exited and listen.json is gone', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  assert.match(await wait(r.home), /^ready /m);
  const waiting = wait(r.home);
  await tick(50);
  assert.equal(await ask(readChannel(r.home), 'stop', 3000), 'stopped\n');
  assert.equal(await waiting, 'stopped\n', 'a waiter is told of a stop the person asked for, not an error');
  assert.equal(r.recorder.exited, true, 'the recorder had exited before stopped was sent');
  assert.equal(await l.done, 'stopped');
  assert.equal(existsSync(join(runDir(r.home), 'listen.json')), false);
});

test('it ends within 1 s of the parent ending, or of its ppid changing, with a waiter connected, and drops its queue', async t => {
  for (const options of [{ parentAlive: () => false }, { ppid: () => 999 }]) {
    let alive = true;
    const r = rig({ ...options, parentAlive: options.parentAlive ? () => alive : () => true, ppid: options.ppid ? (() => (alive ? 1234 : 999)) : () => 1234 });
    const l = await r.start();
    assert.match(await wait(r.home), /^ready /m);
    const pending = wait(r.home); // a waiter connected, the queue empty
    await tick(50);
    r.turn(); // delivered to the waiter at once
    assert.match(await pending, /^Heard/m);
    r.push(3163, 15); // a second turn, still in the gate when the parent ends
    const waiting = wait(r.home);
    await tick(50);
    const began = Date.now();
    alive = false;
    assert.equal(await l.done, 'ended');
    assert.ok(Date.now() - began < 1000);
    assert.equal(await waiting, 'listener error ended\n');
    assert.equal(readChannel(r.home), null, 'nothing is left to deliver');
    r.cleanup();
  }
});

test('it ends with no waiter for the no-waiter time, and after the idle time with no turn', async t => {
  for (const knobs of [{ noWaiterMs: 80 }, { idleMs: 80 }]) {
    const r = rig({ knobs });
    const l = await r.start();
    assert.equal(await l.done, 'ended');
    r.cleanup();
  }
});

test('with no wait connected within the relay time of ready it ends with the fixed reason relay; a wait that connects in time keeps it up', async t => {
  const r = rig({ knobs: { relayWaitMs: 150 } });
  const l = await r.start();
  assert.equal(await l.done, 'relay');
  r.cleanup();
  const kept = rig({ knobs: { relayWaitMs: 150 } });
  const k = await kept.start();
  assert.match(await wait(kept.home), /^ready /m);
  const state = await Promise.race([k.done, tick(500).then(() => 'still up')]);
  assert.equal(state, 'still up');
  await k.stop('stopped');
  kept.cleanup();
});

test('it refuses to start, with a fixed reason, on a changed recorder, no usable mic, an unlisted engine or unparsable settings', async t => {
  const cases = [
    [{ recorder: fakeRecorder({ path: process.platform === 'win32' ? 'C:\\other\\ffmpeg.exe' : '/other/ffmpeg' }) }, 'recorder'],
    [{ recorder: fakeRecorder({ list: LOOPBACK_ONLY[process.platform] ?? LOOPBACK_ONLY.linux }) }, 'device'], // S5.5: only a loopback is listed
    [{ settings: { engine: 'elsewhere' } }, 'engine'],
    [{ settings: { engine: '../x' } }, 'settings'],
    [{ engineOptions: { health: false } }, 'engine'],
  ];
  for (const [options, reason] of cases) {
    const r = rig(options);
    await assert.rejects(r.start(), { reason });
    if (options.settings?.engine) {
      assert.equal(r.recorder.listed, 0, 'refused before any device listing');
      assert.equal(r.recorder.spawned.length, 0, 'refused before the mic opens');
    }
    r.cleanup();
  }
  const r = rig();
  writePrivate(settingsPath(r.home), '{"engine": "voicebox", "port": ');
  await assert.rejects(r.start(), { reason: 'settings' });
  r.cleanup();
});

test('no file under the fixture home or the temp folder holds audio or heard text after a turn', async t => {
  const marker = `zq${Date.now()}heardmarker`;
  const before = new Set(readdirSync(tmpdir()));
  const r = rig({ engineOptions: { text: marker } });
  t.after(r.cleanup);
  const l = await r.start();
  await tick();
  r.turn();
  await tick(80);
  assert.match(await wait(r.home), new RegExp(marker));
  await l.stop();
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  for (const f of walk(r.home)) {
    const bytes = readFileSync(f);
    assert.ok(!bytes.includes(marker), f);
    assert.ok(!bytes.includes('RIFF'), f);
  }
  // Every entry new in the temp folder since the turn began, whatever its name.
  const fresh = readdirSync(tmpdir()).filter(n => !before.has(n) && !r.home.endsWith(n));
  for (const n of fresh) {
    const p = join(tmpdir(), n);
    let files = [];
    try {
      files = statSync(p).isFile() ? [p] : walk(p);
    } catch {
      continue; // another test's entry, gone already
    }
    for (const file of files) {
      let bytes;
      try {
        bytes = readFileSync(file);
      } catch {
        continue;
      }
      assert.ok(!bytes.includes(marker), n);
      if (/^incantation|\.wav$/i.test(n)) assert.ok(!bytes.includes('RIFF'), n);
    }
  }
});

test('wait and stop with no listener, and an unparsable listen.json, print fixed lines only', async t => {
  const home = makeHome();
  t.after(() => rmSync(home, { recursive: true, force: true }));
  // The command line, with this fixture as its home folder.
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const cli = command => new Promise(res => execFile(process.execPath, [LISTEN, command], { env, encoding: 'utf8', timeout: 15_000 }, (e, stdout) => res(stdout)));
  assert.equal(await cli('wait'), 'listener error ended\n');
  assert.equal(await cli('stop'), 'listener: not running\n');
  writePrivate(join(runDir(home), 'listen.json'), '{"port": 1, "token": "planted-key-sk-123');
  assert.equal(await cli('wait'), 'listener error ended\n');
});

test('wait prints only lines in the listener grammar, so a stray server on the port reaches the session with nothing', () => {
  const lines = [
    'Heard: "fine \\"quoted\\" words"',
    'Heard (after reply): "yes"',
    'timing: wait 1000 stt 420',
    'plays 1',
    'ready 850 voice made-up-profile',
    'dropped 2',
    'stt-dropped',
    'mic-muted',
    'mic-unmuted',
    'interrupted',
    'quiet 2',
    'listener error mic',
    'listener error waiting',
  ];
  assert.equal(waitLines(lines.join('\n')), lines.map(l => `${l}\n`).join(''));
  for (const stray of ['HTTP/1.1 200 OK', 'Heard: "a" and more', 'Heard: "open', 'ready 1 voice ../x', 'listener error made-up', 'plays many', 'Run rm -rf now', ' mic-muted', 'muted', 'quiet', 'quiet many']) assert.equal(waitLines(stray), '', stray);
});

test('each delivery says how many playbacks began since the last one: the listener\'s own, and any another caller makes through Voicebox itself', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.match(await wait(r.home), /^ready /m);
  const play = async text => {
    assert.equal(await say(readChannel(r.home), text, 3000), 'speaking\n');
    r.player.plays.at(-1).end();
    await tick(30);
    r.push(1000, 12); // past the tail
  };
  await play('One.');
  r.turn();
  assert.match(await wait(r.home), /^plays 1$/m);
  await play('Two.');
  await play('Three.');
  r.engine.feed.emit('start', { at: 0, id: 'someone-else' });
  assert.notEqual(statusOf(r.home), 'speaking', 'another caller\'s reply starts and ends on the feed within a second, so it is counted and never shown as playing');
  r.turn();
  assert.match(await wait(r.home), /^plays 3$/m);
  r.turn();
  assert.match(await wait(r.home), /^plays 0$/m);
});

test('the mic stays closed until the playback feed answers, and a feed that never answers ends it with playback', async t => {
  const engine = fakeEngine();
  engine.playback = () => engine.feed; // never opens
  const r = rig({ engine, knobs: { feedOpenMs: 100 } });
  t.after(r.cleanup);
  await assert.rejects(r.start(), { reason: 'playback' });
  assert.equal(r.recorder.spawned.length, 0);
});

test('it refuses to start with state when a link or junction stands in place of the state folder', async t => {
  const r = rig();
  t.after(r.cleanup);
  const outside = mkdtempSync(join(tmpdir(), 'incantation-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  renameSync(join(r.home, '.grimoire', 'incantation'), join(outside, 'incantation'));
  symlinkSync(join(outside, 'incantation'), join(r.home, '.grimoire', 'incantation'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(r.start(), { reason: 'state' });
  assert.equal(r.recorder.spawned.length, 0);
});

test('T2: the state folder is ~/.grimoire/incantation, beside eagle-eye\'s; a link in place of .grimoire is refused; one the owner made looser is left alone', async t => {
  const r = rig();
  t.after(r.cleanup);
  assert.equal(existsSync(join(r.home, '.grimoire', 'incantation', 'settings.json')), true);
  assert.equal(existsSync(join(r.home, '.incantation')), false, 'no top-level folder');
  const outside = mkdtempSync(join(tmpdir(), 'incantation-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  renameSync(join(r.home, '.grimoire'), join(outside, 'grimoire'));
  symlinkSync(join(outside, 'grimoire'), join(r.home, '.grimoire'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(r.start(), { reason: 'state' });
  assert.equal(r.recorder.spawned.length, 0);
});

test('T2: the grimoire folder may already hold other skills\' files, at a mode its owner chose', async t => {
  const home = mkdtempSync(join(tmpdir(), 'incantation-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, '.grimoire', 'eagle-eye'), { recursive: true, mode: 0o755 });
  writeFileSync(join(home, '.grimoire', 'eagle-eye', 'log.jsonl'), 'x');
  secureState(home);
  assert.equal(readFileSync(join(home, '.grimoire', 'eagle-eye', 'log.jsonl'), 'utf8'), 'x', 'left as it was');
  if (process.platform !== 'win32') assert.equal(statSync(join(home, '.grimoire')).mode & 0o777, 0o755, 'its mode is not ours to change');
});

test('T14: a wait ends only on a real heard turn, the first ready line, a stop or an error; a quiet stretch and the other notices ride in the next real delivery', async t => {
  const r = rig({ knobs: { quietMs: 100 } });
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.match(await wait(r.home), /^ready /m);
  await cli(r.home, 'mute');
  await cli(r.home, 'unmute');
  const pending = wait(r.home);
  const early = await Promise.race([pending, tick(350).then(() => 'still waiting')]);
  assert.equal(early, 'still waiting', 'neither a mute notice nor 350 ms of quiet ends a wait');
  r.turn();
  const out = await pending;
  assert.match(out, /^Heard: "hello there"$/m);
  assert.match(out, /^quiet [1-9]\d*$/m, 'the quiet stretch is counted in the delivery');
  assert.match(out, /^mic-unmuted$/m);
  const stopping = wait(r.home);
  await tick(30);
  assert.equal(await ask(readChannel(r.home), 'stop', 3000), 'stopped\n');
  assert.equal(await stopping, 'stopped\n');
});

const levelsOf = home => readFileSync(join(runDir(home), 'levels'), 'utf8').trim();
const LEVELS_LINE = /^(\d{13}) (listening|hearing|thinking|speaking|muted) ([0-8]{24})$/;

test('T16: the levels file holds the stamp, the state word and 24 digits, numbers only, and goes when the listener does', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  assert.match(levelsOf(r.home), LEVELS_LINE);
  r.push(1000, 34);
  r.push(3163, 20); // voice for 600 ms: two buckets
  const m = LEVELS_LINE.exec(levelsOf(r.home));
  assert.equal(m[2], 'hearing');
  assert.match(m[3].slice(-4), /[1-8]/, 'the last buckets are loud');
  assert.ok(Math.abs(Number(m[1]) - Date.now()) < 5000, 'the stamp is the wall clock in ms');
  if (process.platform !== 'win32') assert.equal(statSync(join(runDir(r.home), 'levels')).mode & 0o777, 0o600);
  await l.stop();
  assert.equal(existsSync(join(runDir(r.home), 'levels')), false);
});

test('T16: a muted mic draws flat', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.equal(await cli(r.home, 'mute'), 'mic-muted\n');
  r.push(3163, 40);
  const m = LEVELS_LINE.exec(levelsOf(r.home));
  assert.equal(m[2], 'muted');
  assert.equal(m[3], '0'.repeat(24));
});

test('T16: a click file holding mute or unmute is read once, removed, and acts like the person\'s own mute', async t => {
  const r = rig({ knobs: { commandPollMs: 20 } });
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  const click = join(runDir(r.home), 'command');
  writeFileSync(click, 'mute');
  await tick(80);
  assert.equal(existsSync(click), false, 'read once and removed');
  assert.equal(statusOf(r.home), 'muted');
  writeFileSync(click, 'unmute\n');
  await tick(80);
  assert.equal(statusOf(r.home), 'listening');
  // The notice rides in the next delivery, as the voice mute's does; the last change wins.
  r.turn();
  await tick(80);
  const out = await wait(r.home);
  assert.match(out, /^mic-unmuted$/m);
});

test('T16: a click file that is anything else is removed and acts on nothing: wrong words, too big, stale, or a link', async t => {
  const r = rig({ knobs: { commandPollMs: 20, commandFreshMs: 1000 } });
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  const click = join(runDir(r.home), 'command');
  for (const body of ['stop', 'mute now', 'mute'.padEnd(40, ' ') + 'mute', '']) {
    writeFileSync(click, body);
    await tick(80);
    assert.equal(existsSync(click), false, `removed: ${JSON.stringify(body.slice(0, 8))}`);
    assert.equal(statusOf(r.home), 'listening');
  }
  writeFileSync(click, 'mute');
  const old = new Date(Date.now() - 60_000);
  utimesSync(click, old, old);
  await tick(80);
  assert.equal(existsSync(click), false);
  assert.equal(statusOf(r.home), 'listening', 'a stale click does nothing');
  const target = join(r.home, 'elsewhere.txt');
  writeFileSync(target, 'mute');
  try {
    symlinkSync(target, click);
  } catch {
    return; // no link rights on this machine
  }
  await tick(80);
  assert.equal(existsSync(click), false);
  assert.equal(statusOf(r.home), 'listening', 'a link is never followed');
});

// T18: the listener plays the replies itself.
const spoken = (r, text) => say(readChannel(r.home), text, 3000);

test('T18: say hands the text to the engine whole, plays the WAV it gets back, and answers once the player has started', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  const text = 'Got it: "check the run" $(not run) ; `nor this` \\ and a new\nline, café.';
  assert.equal(await spoken(r, text), 'speaking\n');
  assert.deepEqual(r.engine.synthesized, [text.replace('\n', '')], 'the control character is cleaned, nothing else is touched');
  assert.equal(r.player.plays.length, 1);
  assert.deepEqual(r.player.plays[0].wav, r.engine.wav);
});

test('T18: say needs the token, text, and a player; and it refuses text that is too long rather than cutting it', async t => {
  const r = rig({ knobs: { maxSayChars: 40 } });
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.equal(await say({ ...readChannel(r.home), token: '0'.repeat(64) }, 'Hello.', 1000), null, 'no say without the token');
  assert.equal(await spoken(r, ''), 'say-refused\n');
  assert.equal(await spoken(r, '\u0000​  '), 'say-refused\n', 'nothing left once control and invisible characters go');
  assert.equal(await spoken(r, 'x'.repeat(41)), 'say-refused\n');
  assert.equal(await spoken(r, 'x'.repeat(40)), 'speaking\n');
  assert.equal(r.engine.synthesized.length, 1, 'a refused say never reaches the engine');
  const none = rig({ player: fakePlayer({ available: false }) });
  t.after(none.cleanup);
  const l2 = await none.start();
  t.after(() => l2.stop());
  assert.equal(await spoken(none, 'Hello.'), 'say-no-player\n');
  assert.equal(none.engine.synthesized.length, 0, 'no generation when nothing could play it');
});

test('T18: a say whose audio fails is say-failed and plays nothing; a full queue is say-busy', async t => {
  const r = rig({ engineOptions: { synth: () => null }, knobs: { sayQueueMax: 2 } });
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.equal(await spoken(r, 'Hello.'), 'say-failed\n');
  assert.equal(r.player.plays.length, 0);
  assert.notEqual(statusOf(r.home), 'speaking');
  const q = rig({ knobs: { sayQueueMax: 2 } });
  t.after(q.cleanup);
  const l2 = await q.start();
  t.after(() => l2.stop());
  assert.equal(await spoken(q, 'One.'), 'speaking\n');
  const two = spoken(q, 'Two.');
  const three = spoken(q, 'Three.');
  await tick(40);
  assert.equal(await spoken(q, 'Four.'), 'say-busy\n', 'one playing, two waiting, the next is refused');
  q.player.plays[0].end();
  assert.equal(await two, 'speaking\n');
  q.player.plays[1].end();
  assert.equal(await three, 'speaking\n');
});

test('T18: the person muting the mic does not stop the session speaking to them', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.equal(await cli(r.home, 'mute'), 'mic-muted\n');
  assert.equal(await spoken(r, 'Still here.'), 'speaking\n');
  assert.equal(r.player.plays.length, 1);
});

test('T18: a player that fails after it started frees the line and rides a say-failed notice in the next delivery', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.match(await wait(r.home), /^ready /m);
  assert.equal(await spoken(r, 'Hello.'), 'speaking\n');
  r.player.plays[0].end('failed');
  await tick(30);
  assert.notEqual(statusOf(r.home), 'speaking');
  r.push(1000, 34);
  r.turn();
  assert.match(await wait(r.home), /^say-failed$/m);
});

test('T18: a reply that ends on its own is not an interruption, and the turn after it is "after reply" with no notice', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.match(await wait(r.home), /^ready /m);
  r.push(1000, 34);
  assert.equal(await spoken(r, 'A line.'), 'speaking\n');
  r.player.plays[0].end();
  await tick(30);
  r.push(1000, 12);
  r.push(3163, 15);
  r.push(1000, 15);
  await tick(80);
  const out = await wait(r.home);
  assert.match(out, /^Heard \(after reply\): "hello there"$/m);
  assert.doesNotMatch(out, /^interrupted$/m);
  assert.equal(r.player.stops, 0);
});

test('T18: stopping the listener kills a reply that is playing and drops the ones queued', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  assert.equal(await spoken(r, 'One.'), 'speaking\n');
  const two = spoken(r, 'Two.');
  await tick(30);
  await l.stop();
  assert.equal(r.player.stops, 1);
  assert.equal(r.player.plays.length, 1);
  assert.equal(await two, 'say-failed\n');
});

test('T18: the say command line reads the session\'s file, prints one fixed line, deletes the file whatever happens, and takes no text as an argument', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  const run = (home, args) =>
    new Promise(res => {
      const env = { ...process.env, HOME: home, USERPROFILE: home };
      execFile(process.execPath, [LISTEN, ...args], { env, encoding: 'utf8', timeout: 15_000 }, (e, stdout) => res(stdout));
    });
  const fileFor = (home, hex) => join(observeDir(home), `say-${hex}.txt`);
  writeFileSync(fileFor(r.home, 'abcd1234'), 'Hello from a file.');
  assert.equal(await run(r.home, ['say', 'abcd1234']), 'speaking\n');
  assert.deepEqual(r.engine.synthesized, ['Hello from a file.']);
  assert.equal(existsSync(fileFor(r.home, 'abcd1234')), false, 'read once, then gone');
  for (const args of [['say'], ['say', 'text as an argument'], ['say', 'abcd1234', 'extra'], ['say', 'ABCD1234'], ['say', '../abcd12']]) {
    assert.match(await run(r.home, args), /^usage: /, args.join(' '));
  }
  assert.equal(await run(r.home, ['say', 'ffff0000']), 'say-refused\n', 'no such file');
  writeFileSync(fileFor(r.home, 'abcd1235'), 'x'.repeat(5000));
  assert.equal(await run(r.home, ['say', 'abcd1235']), 'say-refused\n', 'a file over the cap');
  assert.equal(existsSync(fileFor(r.home, 'abcd1235')), false, 'and gone all the same');
  assert.equal(r.engine.synthesized.length, 1);
  if (process.platform !== 'win32') {
    const target = join(r.home, 'elsewhere.txt');
    writeFileSync(target, 'a link must not be followed');
    symlinkSync(target, fileFor(r.home, 'abcd1236'));
    assert.equal(await run(r.home, ['say', 'abcd1236']), 'say-refused\n');
    assert.equal(r.engine.synthesized.length, 1);
    assert.equal(existsSync(target), true, 'only the link goes');
  }
  const gone = makeHome();
  t.after(() => rmSync(gone, { recursive: true, force: true }));
  writeFileSync(fileFor(gone, 'abcd1237'), 'Hello.');
  assert.equal(await run(gone, ['say', 'abcd1237']), 'listener: not running\n');
  assert.equal(existsSync(fileFor(gone, 'abcd1237')), false);
});

test('T18: no file under the fixture home holds the reply text or its audio after a say', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  assert.equal(await spoken(r, 'A private sentence about the migration.'), 'speaking\n');
  r.player.plays[0].end();
  await tick(30);
  await l.stop();
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  for (const file of walk(r.home)) {
    const bytes = readFileSync(file);
    assert.equal(bytes.includes('private sentence'), false, file);
    assert.equal(bytes.includes('RIFF'), false, file);
  }
});

// ---- GRIM-36 ticket 2 (S5.1 to S5.7): the listener the prototype proved ----

const voiceOf = home => readFileSync(join(runDir(home), 'voice'), 'utf8').trim();
const raced = (promise, ms = 300) => Promise.race([promise, tick(ms).then(() => 'still waiting')]);
const live = async (t, options) => {
  const r = rig(options);
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.match(await wait(r.home), /^ready /m);
  return r;
};

test('claim 3: working, mute-voice and unmute-voice answer fixed lines, and the status word and the voice file follow', async t => {
  const r = await live(t);
  assert.equal(voiceOf(r.home), 'on');
  assert.equal(await cli(r.home, 'working'), 'working\n');
  assert.equal(await cli(r.home, 'status'), 'working\n');
  assert.equal(statusOf(r.home), 'working');
  assert.equal(await cli(r.home, 'mute-voice'), 'voice-muted\n');
  assert.equal(voiceOf(r.home), 'muted');
  assert.equal(await cli(r.home, 'unmute-voice'), 'voice-unmuted\n');
  assert.equal(voiceOf(r.home), 'on');
  assert.equal(await ask({ ...readChannel(r.home), token: '0'.repeat(64) }, 'mute-voice', 1000), null, 'no voice mute without the token');
});

test('claim 3: a working word lapses after workingMs, ends on a line spoken, and ends on a turn heard', async t => {
  const r = await live(t, { knobs: { workingMs: 300 } });
  assert.equal(await cli(r.home, 'working'), 'working\n');
  r.push(1000, 34); // 1 s on the fake clock: past workingMs
  assert.equal(await cli(r.home, 'status'), 'listening\n', 'lapsed');
  assert.equal(await cli(r.home, 'working'), 'working\n');
  assert.equal(await spoken(r, 'A line.'), 'speaking\n');
  r.player.plays[0].end();
  await tick(30);
  assert.notEqual(await cli(r.home, 'status'), 'working\n', 'a spoken line ends it');
  const again = await live(t);
  assert.equal(await cli(again.home, 'working'), 'working\n');
  again.turn();
  await tick(80);
  assert.notEqual(await cli(again.home, 'status'), 'working\n', 'a heard turn ends it');
});

test('claim 3: a muted voice makes no synthesis call and plays nothing, and the say still counts as played', async t => {
  const r = await live(t, { engineOptions: { text: 'Yes.' } });
  await tick(100); // the spinner words are made after ready: count only what comes after
  const before = r.engine.synthesized.length;
  assert.equal(await cli(r.home, 'mute-voice'), 'voice-muted\n');
  assert.equal(await spoken(r, 'Shall I go on?'), 'speaking\n');
  assert.equal(r.engine.synthesized.length, before, 'no generation for a muted line');
  assert.equal(r.player.plays.length, 0, 'nothing played');
  r.player.spinners.length = 0;
  r.turn(); // the person says yes
  await tick(80);
  const out = await wait(r.home);
  assert.match(out, /^Heard \(after reply\): "Yes\."$/m, 'a reply, though nobody heard the line');
  assert.match(out, /^plays 1$/m, 'the say is counted');
  assert.equal(r.player.spinners.length, 0, 'and no spinner word plays on a muted voice');
  assert.equal(await cli(r.home, 'unmute-voice'), 'voice-unmuted\n');
});

test('claim 3: a listener older than a command closes the connection, and the client says a restart is needed; with none running it says so', async t => {
  const home = makeHome();
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const token = '1'.repeat(64);
  const server = (await import('node:net')).createServer(socket => {
    socket.on('error', () => {});
    socket.once('data', d => {
      if (String(d).startsWith('ping ')) return void socket.end('alive\n');
      socket.destroy(); // a command this older listener does not know
    });
  });
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  t.after(() => server.close());
  writePrivate(join(runDir(home), 'listen.json'), JSON.stringify({ port: server.address().port, token }));
  const run = (h, command) =>
    new Promise(res => execFile(process.execPath, [LISTEN, command], { env: { ...process.env, HOME: h, USERPROFILE: h }, encoding: 'utf8', timeout: 15_000 }, (e, stdout) => res(stdout)));
  for (const command of ['working', 'mute-voice', 'unmute-voice']) assert.equal(await run(home, command), 'listener: restart needed for this command\n', command);
  const none = makeHome();
  t.after(() => rmSync(none, { recursive: true, force: true }));
  assert.equal(await run(none, 'working'), 'listener: not running\n');
});

test('claim 4: a kept turn plays one spinner word within 100 ms, never the same twice running over 50 turns, and it is not counted in plays', async t => {
  const r = await live(t, { engineOptions: { text: 'Run the tests.' } });
  await tick(120); // the ten words are made after ready
  const seen = [];
  for (let i = 0; i < 50; i++) {
    r.t += 1600; // a person's next sentence comes more than echoHoldMs after the last cue
    r.turn();
    await tick(70);
    assert.equal(r.player.spinners.length, i + 1, `turn ${i}: one word, within the pause`);
    seen.push(r.player.spinners[i].word);
  }
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1], 'never the same twice running');
  assert.equal(new Set(seen).size > 5, true, 'a spread of the ten words');
  assert.ok(seen.every(w => SPINNERS.includes(w)));
  assert.equal(r.player.plays.length, 0, 'a spinner is not a reply');
  const out = await wait(r.home);
  assert.match(out, /^plays 0$/m);
});

test('follow-up 1: the spinner word plays when the gate hears the end of speech, before the turn is transcribed', async t => {
  const r = await live(t, { engineOptions: { text: () => new Promise(res => setTimeout(() => res('Run the tests.'), 400)) } });
  await tick(120);
  r.turn();
  await tick(100); // well before the transcript is back
  assert.equal(r.player.spinners.length, 1, 'the cue came with the end of speech, not after the text');
  assert.equal(r.engine.calls, 1, 'and the engine is still working on the turn');
  const pending = wait(r.home);
  assert.equal(await raced(pending, 100), 'still waiting', 'nothing delivered yet');
  assert.match(await pending, /^Heard: "Run the tests\."$/m);
});

test('follow-up 1: a cue that turns out to be for a stop word, a mute word or a fragment is cut short; none for a muted mic or a muted voice, and one for a turn over a line', async t => {
  const words = ['stop', 'Mute.', 'Unmute.', 'you', 'Run the tests.'];
  const r = await live(t, { engineOptions: { text: texts(...words) } });
  await tick(120);
  const turn = () => {
    r.t += 1600; // each sentence comes more than echoHoldMs after the last sound
    r.turn();
  };
  turn(); // stop
  await tick(70);
  assert.equal(r.player.spinners.length, 1);
  assert.equal(r.player.spinners[0].stopped, true, 'a stop word: the stray cue is stopped as soon as the text says so');
  turn(); // mute
  await tick(70);
  assert.equal(r.player.spinners.length, 2);
  assert.equal(r.player.spinners[1].stopped, true, 'a mute word: stopped');
  turn(); // unmute, said while the mic is muted: heard for that word only, so no cue
  await tick(70);
  assert.equal(r.player.spinners.length, 2, 'none while the mic is muted');
  turn(); // a fragment
  await tick(70);
  assert.equal(r.player.spinners.length, 3);
  assert.equal(r.player.spinners[2].stopped, true, 'a fragment: stopped');
  // A person who talks over a line still gets the cue: it always plays when a turn ends.
  assert.equal(await spoken(r, 'First line.'), 'speaking\n');
  turn();
  await tick(70);
  assert.equal(r.player.spinners.length, 4, 'a cue over a line');
  // A muted voice plays nothing.
  assert.equal(await cli(r.home, 'mute-voice'), 'voice-muted\n');
  turn();
  await tick(70);
  assert.equal(r.player.spinners.length, 4, 'none while the voice is muted');
});

test('follow-up 1: a quick turn inside the echo window still gets a cue, and our own sound heard back is stopped and not delivered', async t => {
  const r = await live(t, { engineOptions: { text: texts('Run the tests.', 'One sec.') } });
  await tick(120);
  r.turn();
  await tick(70);
  assert.equal(r.player.spinners.length, 1);
  r.push(3163, 12); // the mic hears the spinner word's own tail, within echoHoldMs of its end
  r.push(1000, 15);
  await tick(150);
  assert.ok(r.player.spinners.length >= 1, 'the first cue played');
  const out = await wait(r.home);
  assert.match(out, /^Heard: "Run the tests."$/m);
  assert.doesNotMatch(out, /One sec/, 'our own word is not a turn');
});

test('follow-up 2: a say queued behind a playing line holds while a new turn is being heard, and plays when it is dropped or is held when a turn lands', async t => {
  const r = await live(t, { engineOptions: { text: texts('you', 'Hold on.') } });
  r.push(1000, 34);
  const channel = readChannel(r.home);
  assert.equal(await say(channel, 'First line.', 3000), 'speaking\n');
  let answered = null;
  const queued = say(channel, 'Second line.', 3000).then(v => ((answered = v), v));
  await tick(40);
  r.push(3163, 5); // the person begins a new turn, short of a barge-in
  assert.equal(r.player.stops, 0);
  r.player.plays[0].end(); // the first line ends: the queued one would start now
  await tick(250);
  assert.equal(answered, null, 'held while they talk');
  assert.equal(r.player.plays.length, 1, 'and not started');
  r.push(1000, 15); // a fragment: dropped
  assert.equal(await queued, 'speaking\n', 'played once they stopped');
  assert.equal(r.player.plays.length, 2);
  r.player.plays[1].end();
  await tick(30);
  // The same again, with a turn that lands.
  assert.equal(await say(channel, 'Third line.', 3000), 'speaking\n');
  const fourth = say(channel, 'Fourth line.', 3000);
  await tick(40);
  r.push(1000, 34);
  r.push(3163, 5);
  r.player.plays[2].end();
  await tick(150);
  assert.equal(r.player.plays.length, 3, 'held');
  r.push(3163, 5);
  r.push(1000, 15);
  assert.equal(await fourth, 'say-held\n', 'a turn landed: the line is stale');
  assert.equal(r.player.plays.length, 3);
});

test('claim 4: the 150 ms of silence in front of a spinner word keeps the WAV valid, and anything else is returned as it came', () => {
  const rate = 24000;
  const data = Buffer.alloc(2000, 5);
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + data.length, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(data.length, 40);
  const whole = Buffer.concat([wav, data]);
  const led = leadSilence(whole);
  const pad = Math.round(rate * 0.15) * 2;
  assert.equal(led.length, whole.length + pad);
  assert.equal(led.readUInt32LE(40), data.length + pad);
  assert.equal(led.readUInt32LE(4), 36 + data.length + pad);
  assert.ok(led.subarray(44, 44 + pad).every(b => b === 0), 'silence first');
  assert.ok(led.subarray(44 + pad).equals(data), 'then the word');
  const odd = Buffer.from('RIFF-made-up-audio');
  assert.equal(leadSilence(odd), odd);
  assert.equal(pickSpinner(10, 3, () => 0.999) !== 3, true);
  for (let i = 0; i < 200; i++) assert.notEqual(pickSpinner(10, 7), 7);
  assert.equal(pickSpinner(1, 0), 0, 'one word has no other to pick');
});

test('claim 5: with the status working and no line or turn for progressMs, a wait ends with progress-due, again after another progressMs, and not after a line or a turn', async t => {
  const r = await live(t, { knobs: { progressMs: 600 } });
  r.push(1000, 34);
  assert.equal(await cli(r.home, 'working'), 'working\n');
  const first = wait(r.home);
  r.push(1000, 19); // 570 ms on the fake clock
  assert.equal(await raced(first, 100), 'still waiting', 'not yet');
  r.push(1000, 2);
  assert.equal(await first, 'progress-due\n', 'a notice the session acts on ends the wait');
  const second = wait(r.home);
  r.push(1000, 21);
  assert.equal(await second, 'progress-due\n', 'and again after another beat');
  // A line spoken ends the working state: no more beats until the session says working again.
  assert.equal(await spoken(r, 'Still on it.'), 'speaking\n');
  r.player.plays[0].end();
  const third = wait(r.home);
  r.push(1000, 60);
  assert.equal(await raced(third, 150), 'still waiting');
  // Working again, then a heard turn: it ends the state and the turn is what the wait gets.
  assert.equal(await cli(r.home, 'working'), 'working\n');
  r.push(3163, 12);
  r.push(1000, 15);
  const out = await third;
  assert.match(out, /^Heard \(after reply\): "hello there"$/m, 'after the progress line the session spoke');
  assert.doesNotMatch(out, /progress-due/);
  const fourth = wait(r.home);
  r.push(1000, 80);
  assert.equal(await raced(fourth, 150), 'still waiting', 'no beat after a turn was heard');
});

test('claim 5: a repeat of working does not push the beat back', async t => {
  const r = await live(t, { knobs: { progressMs: 600 } });
  r.push(1000, 34);
  assert.equal(await cli(r.home, 'working'), 'working\n');
  const pending = wait(r.home);
  for (let i = 0; i < 4; i++) {
    r.push(1000, 6);
    assert.equal(await cli(r.home, 'working'), 'working\n');
  }
  r.push(1000, 2);
  assert.equal(await pending, 'progress-due\n');
});

test('claim 6: a kept turn during a line stops it, drops the lines queued behind it with say-held, and the next delivery says interrupted', async t => {
  const r = await live(t, { engineOptions: { text: 'Hold on.' } });
  r.push(1000, 34);
  const channel = readChannel(r.home);
  assert.equal(await say(channel, 'First line.', 3000), 'speaking\n');
  const queued = say(channel, 'Second line.', 3000);
  await tick(40);
  r.push(3163, 11); // a short turn: under the barge-in, so the kept turn itself is what moves on
  assert.equal(r.player.stops, 0, 'no barge-in yet');
  r.push(1000, 15);
  await tick(80);
  assert.equal(r.player.stops, 1, 'the line in the player is stopped');
  assert.equal(await queued, 'say-held\n', 'the queued line never plays');
  assert.equal(r.player.plays.length, 1);
  const out = await wait(r.home);
  assert.match(out, /^Heard \(after reply\): "Hold on\."$/m);
  assert.match(out, /^interrupted$/m);
});

test('claim 7: the saved mic is found by its digests, a changed list falls back to a mic that is not a loopback and names it before ready, and nothing is named otherwise', async t => {
  const dev = PARSED[process.platform] ?? PARSED.linux;
  // The saved mic, by the digest of its id.
  const home = makeHome({ device: { index: 5, stamp: '0123456789abcdef' } });
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const key = ensureKey(home);
  writePrivate(settingsPath(home), JSON.stringify({ engine: 'voicebox', port: 17493, profile: 'made-up-profile', device: { index: 5, stamp: '0123456789abcdef', id: deviceDigest(key, dev[0].id), name: deviceDigest(key, 'another name') }, recorder: RECORDER, endOfSpeechMs: 300 }));
  const saved = rig({ home });
  const sl = await saved.start();
  assert.doesNotMatch(await wait(home), /mic-fallback/);
  await sl.stop();
  // Settings from before (no id or name): by stamp and index.
  const old = rig({ settings: {} });
  t.after(old.cleanup);
  const ol = await old.start();
  assert.doesNotMatch(await wait(old.home), /mic-fallback/);
  await ol.stop();
  // The saved mic is gone: the first mic that is not a loopback, said before ready.
  const gone = rig({ settings: { device: { index: 0, stamp: '0123456789abcdef' } } });
  t.after(gone.cleanup);
  const gl = await gone.start();
  const out = await wait(gone.home);
  const lines = out.trim().split('\n');
  assert.equal(lines[lines.indexOf(`mic-fallback "${dev[0].name}"`) + 1].startsWith('ready '), true, 'named just before ready');
  assert.equal(gone.recorder.spawned.length, 1);
  await gl.stop();
  // Said once: the first delivery only.
  const again = rig({ settings: { device: { index: 0, stamp: '0123456789abcdef' } }, engineOptions: { text: 'hello there' } });
  t.after(again.cleanup);
  const al = await again.start();
  assert.match(await wait(again.home), /^mic-fallback /m);
  again.turn();
  await tick(80);
  assert.doesNotMatch(await wait(again.home), /mic-fallback/);
  await al.stop();
});

test('claim 7: a fallback name is printed cleaned (letters, digits, spaces and ()-_.), and wait lets the line through', () => {
  assert.equal(waitLines('mic-fallback "Desk Mic One (USB)"\n'), 'mic-fallback "Desk Mic One (USB)"\n');
  assert.equal(waitLines('mic-fallback "bad\\"quote"\nmic-fallback ""\n'), '', 'quotes and backslashes never pass, nor an empty name');
  assert.equal(waitLines('progress-due\n'), 'progress-due\n');
});

test('S5.7: a turn begun over a reply is flagged overlap, so a spinner word heard back by the mic is not delivered', async t => {
  const r = await live(t, { engineOptions: { text: texts('Pondering.', 'Run the tests.') } });
  await tick(120);
  r.push(1000, 34);
  assert.equal(await spoken(r, 'A line.'), 'speaking\n');
  r.player.plays[0].end();
  await tick(30);
  r.push(3163, 12); // the mic hears the speaker's own tail: a turn over the end of a reply
  r.push(1000, 15);
  await tick(60);
  assert.equal(await raced(wait(r.home), 150), 'still waiting', 'our own spinner word, heard back, is not a turn');
});

// The two bugs the owner hit (idle and say over a person mid-sentence; a long turn cut and its rest lost).

test('bug b: idle holds while a turn is being heard and returns once it has been settled', async t => {
  const r = await live(t, { engineOptions: { text: 'Run the tests.' } });
  r.push(1000, 34);
  r.push(3163, 5); // the person is mid-sentence
  assert.equal(statusOf(r.home), 'hearing');
  let settled = false;
  const pending = cli(r.home, 'idle').then(v => ((settled = true), v));
  await tick(200);
  assert.equal(settled, false, 'held while a turn is being heard');
  r.push(3163, 10);
  await tick(100);
  assert.equal(settled, false, 'and while the voice goes on');
  r.push(1000, 15); // the turn ends: its text must settle first
  assert.equal(await pending, 'idle\n');
  assert.equal(r.engine.calls, 1, 'idle came back after the text was settled, not before');
});

test('bug b: a say waits while the person is mid-sentence and then speaks when that turn was a fragment; when the turn is kept the line is stale and is held', async t => {
  const r = await live(t, { engineOptions: { text: texts('you', 'Hold on.') } });
  r.push(1000, 34);
  const channel = readChannel(r.home);
  r.push(3163, 5); // mid-sentence
  let answered = null;
  const line = say(channel, 'A reply that must not talk over them.', 3000).then(v => ((answered = v), v));
  await tick(250);
  assert.equal(answered, null, 'not answered while they talk');
  assert.equal(r.player.plays.length, 0, 'and nothing plays over them');
  r.push(1000, 15); // the turn is a fragment: dropped
  assert.equal(await line, 'speaking\n', 'the line goes on once the turn is settled and dropped');
  assert.equal(r.player.plays.length, 1);
  r.player.plays[0].end();
  await tick(30);
  // A turn that is kept: the line waiting is stale.
  r.push(1000, 34);
  r.push(3163, 5);
  const stale = say(channel, 'A second reply.', 3000);
  await tick(150);
  assert.equal(r.player.plays.length, 1);
  r.push(3163, 5);
  r.push(1000, 15);
  assert.equal(await stale, 'say-held\n', 'what they said is newer than the line');
  assert.equal(r.player.plays.length, 1, 'never played');
});

test('bug b: a line waits at most holdSayMs for the person to finish, then fails rather than speak over them', async t => {
  const r = await live(t, { knobs: { holdSayMs: 200 } });
  r.push(1000, 34);
  r.push(3163, 5);
  assert.equal(await say(readChannel(r.home), 'Too late.', 3000), 'say-failed\n');
  assert.equal(r.player.plays.length, 0);
});

const longTurn = r => {
  r.push(1000, 34);
  r.push(3163, 1010); // more than 30 s: cut at the limit, the rest goes on as the next turn
  r.push(1000, 15);
};

test('bug a: a turn cut at 30 s and its rest reach the session as one turn, in order, with nothing lost', async t => {
  const r = await live(t, { engineOptions: { text: texts('This is the first part of a long turn.', 'And this is the rest of it.') } });
  longTurn(r);
  await tick(150);
  const out = await wait(r.home);
  assert.match(out, /^Heard: "This is the first part of a long turn\. And this is the rest of it\."$/m);
  assert.equal(r.engine.calls, 2);
  assert.equal(r.player.spinners.length, 1, 'one cue for the whole turn, at its end, not one at the cut');
  assert.doesNotMatch(out, /stt-dropped/);
});

test('bug a: a cut turn that ends on no sentence mark still waits for its rest, and its rest that is lost is said at once', async t => {
  let calls = 0;
  const r = await live(t, { engineOptions: { text: () => (calls++ === 0 ? 'first part with no end' : null) } });
  longTurn(r);
  const out = await Promise.race([wait(r.home), tick(2000).then(() => 'never')]);
  assert.match(out, /^Heard: "first part with no end"$/m, 'the part we have is delivered, not held for ever');
  assert.match(out, /^stt-dropped$/m, 'and the loss is named in the same delivery, which ended the wait');
});

test('bug a: a cut turn whose rest is a fragment delivers the first part at once, and one with no rest at all is not held for the long bound', async t => {
  const r = await live(t, { engineOptions: { text: texts('only the first part', 'you') } });
  longTurn(r);
  assert.match(await Promise.race([wait(r.home), tick(2000).then(() => 'never')]), /^Heard: "only the first part"$/m);
  const lone = await live(t, { engineOptions: { text: 'a lone part with no rest' } });
  lone.push(1000, 34);
  lone.push(3163, 1000); // exactly the limit, then silence: nothing continues it
  lone.push(1000, 20);
  const out = await Promise.race([wait(lone.home), tick(2000).then(() => 'never')]);
  assert.match(out, /^Heard: "a lone part with no rest"$/m, 'the gate said no rest came');
});

test('bug a: a long heard text is split into several lines at word ends and none of it is cut', async t => {
  const words = Array.from({ length: 220 }, (_, i) => `word${i}`).join(' ');
  const r = await live(t, { engineOptions: { text: words } });
  r.turn();
  await tick(150);
  const out = await wait(r.home);
  const lines = out.split('\n').filter(l => l.startsWith('Heard'));
  assert.ok(lines.length >= 3);
  assert.equal(lines.map(l => l.replace(/^Heard(?: \(after reply\))?: "/, '').replace(/"$/, '')).join(' '), words);
});

test('S5.6: the voice file reads on or muted while a listener runs, and goes with it', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  assert.equal(voiceOf(r.home), 'on');
  await cli(r.home, 'mute-voice');
  assert.equal(voiceOf(r.home), 'muted');
  await l.stop();
  assert.equal(existsSync(join(runDir(r.home), 'voice')), false);
});

test('claim 12 (listener side): the click file accepts mute-voice and unmute-voice, read once and removed', async t => {
  const r = await live(t);
  const click = join(runDir(r.home), 'command');
  writeFileSync(click, 'mute-voice');
  await tick(400);
  assert.equal(voiceOf(r.home), 'muted');
  assert.equal(existsSync(click), false);
  writeFileSync(click, 'unmute-voice');
  await tick(400);
  assert.equal(voiceOf(r.home), 'on');
});

// GRIM-53: a line written before the session has seen a heard turn is not played over it.

test('GRIM-53: a say that lands while a kept turn is undelivered is held and plays nothing; once a wait delivers the turn, a say plays', async t => {
  const r = await live(t, { engineOptions: { text: 'Actually, make it the other file.' } });
  r.turn(); // kept and queued; no wait has delivered it
  await tick(80);
  const channel = readChannel(r.home);
  assert.equal(await say(channel, 'Running the tests now.', 3000), 'say-held\n', 'the line was written without the turn in hand');
  assert.equal(r.player.plays.length, 0, 'nothing plays');
  assert.equal(r.engine.synthesized.length, 0, 'and no audio is made');
  const out = await wait(r.home);
  assert.match(out, /^Heard: "Actually, make it the other file\."$/m, 'the turn is still delivered');
  assert.match(out, /^plays 0$/m, 'a held line is no play');
  assert.equal(await say(channel, 'Switching to the other file.', 3000), 'speaking\n', 'with the turn seen, the session may speak');
  assert.equal(r.player.plays.length, 1);
});

test('GRIM-53: a line already waiting when a kept turn lands is held, and a held line counts no play', async t => {
  const r = await live(t, { engineOptions: { text: 'Hold on, wrong branch.' } });
  const channel = readChannel(r.home);
  r.push(1000, 34);
  r.push(3163, 5); // the person is mid-sentence
  const line = say(channel, 'Merging it now.', 3000);
  await tick(150);
  assert.equal(r.player.plays.length, 0, 'nothing plays over them');
  r.push(3163, 5);
  r.push(1000, 15); // the turn is kept
  assert.equal(await line, 'say-held\n', 'the session is told the line was held');
  assert.equal(r.player.plays.length, 0);
  assert.match(await wait(r.home), /^plays 0$/m, 'a held line is no play');
});

test('GRIM-53: a line whose audio is still being made when a kept turn lands is held, and nothing plays', async t => {
  const slow = () => new Promise(res => setTimeout(() => res(Buffer.from('RIFF-slow-audio')), 300));
  const r = await live(t, { engineOptions: { text: 'Wait, not that one.', synth: slow } });
  const line = say(readChannel(r.home), 'Deleting it now.', 3000);
  await tick(60); // the engine is still making the audio
  r.turn(); // a turn is kept meanwhile
  assert.equal(await line, 'say-held\n');
  assert.equal(r.player.plays.length, 0);
});

test('GRIM-53: a say that lands while the first part of a turn waits for its rest is held at once', async t => {
  const r = await live(t, { engineOptions: { text: 'the first part with no end' }, knobs: { joinMs: 5000 } });
  r.turn(); // kept, but it ends on no sentence mark: held for its rest, so not yet queued
  await tick(150);
  assert.equal(await raced(say(readChannel(r.home), 'Running it now.', 3000), 500), 'say-held\n', 'held at once, not waiting for the rest');
  assert.equal(r.player.plays.length, 0);
});

test('GRIM-53: the say command prints say-held for a held line, and deletes its file', async t => {
  const r = await live(t, { engineOptions: { text: 'Actually, stop.' } });
  r.turn();
  await tick(80);
  const file = join(observeDir(r.home), 'say-abcd1236.txt');
  writeFileSync(file, 'A line the turn overtook.');
  const out = await new Promise(res => {
    const env = { ...process.env, HOME: r.home, USERPROFILE: r.home };
    execFile(process.execPath, [LISTEN, 'say', 'abcd1236'], { env, encoding: 'utf8', timeout: 15_000 }, (e, stdout) => res(stdout));
  });
  assert.equal(out, 'say-held\n', 'not "listener: not running"');
  assert.equal(existsSync(file), false);
  assert.equal(r.player.plays.length, 0);
});
