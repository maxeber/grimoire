// The always-on listener (docs/spec/incantation.md, S6, and its trial
// amendments). Node built-ins only.
//
//   node listen.mjs start   holds the mic open until its session ends or it is stopped
//   node listen.mjs wait    prints what was heard, once a turn is waiting
//   node listen.mjs stop    stops the running listener, through its own channel
//   node listen.mjs mute    the person's mic mute (T11); unmute undoes it
//   node listen.mjs working the session is acting now: the status word shows working until the next line is spoken or turn heard
//   node listen.mjs mute-voice | unmute-voice   incantation's own voice, apart from the mic: while muted a say counts as played and makes no audio
//   node listen.mjs idle    returns once no reply is playing and no turn is being heard (T12)
//   node listen.mjs status  prints listening, hearing, thinking, working, speaking or muted
//   node listen.mjs say <8 hex>  speaks the text in observe/say-<8 hex>.txt, in the person's voice (T18)
//
// It reaches the engine only through the seam (S5): synthesize() for each reply,
// which it plays itself through a player it owns (so it knows when a reply
// starts and ends, and can kill it), playback() to count replies that other
// callers speak, and transcribe() for each turn, in memory, on 127.0.0.1. The mic is never muted by the session: only the person
// mutes it, by voice or through the channel (T11). It writes no audio and no
// heard text to any file or log. Its status file holds one fixed word. Every
// line it prints is fixed text, or the heard text a waiter asked for.

import { execFile, spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { captureArgs, fallbackName, listDevices, pickDevice, resolveRecorder } from './capture/ffmpeg.mjs';
import { isEngine, loadEngine } from './engines/index.mjs';
import { Gate, HeardQueue, Joiner, KNOBS, frameBytes, heardLines, isFragment, isMuteWord, isStopWord, isUnmuteWord } from './gate.mjs';
import { checkFile, cleanText, commandPath, deviceDigest, levelsPath, observeDir, readKey, readSettings, readText, runDir, secureState, statusPath, voicePath, writePrivate } from './lib.mjs';
import { METER, Meter, levelsLine } from './meter.mjs';
import { findPlayer, makePlayer } from './player.mjs';
import { RefFeed, isEcho, makeAec, makeLoopback, wavTo16k } from './echo.mjs';
import { makeSpeech, makeStreamPlayer } from './stream.mjs';
import { TurnHold, makeTurnJudge } from './turn.mjs';

class Stop extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}
const stop = reason => {
  throw new Stop(reason);
};

export const REASONS = ['recorder', 'device', 'mic', 'playback', 'engine', 'settings', 'state', 'session', 'stt', 'busy', 'warm', 'ended', 'waiting', 'relay'];

const listenFile = home => join(runDir(home), 'listen.json');

// The channel's address, from listen.json, or null. Never printed.
export function readChannel(home, options = {}) {
  try {
    if (!checkFile(listenFile(home), options)) return null;
    const given = JSON.parse(readText(listenFile(home)));
    if (!Number.isInteger(given?.port) || given.port < 1 || given.port > 65535 || typeof given.token !== 'string' || !/^[0-9a-f]{64}$/.test(given.token)) return null;
    return given;
  } catch {
    return null;
  }
}

// One exchange on the channel: sends `<command> <token>`, resolves the reply
// (until the listener closes the connection), or null when nothing answers.
export function ask(channel, command, timeoutMs = 0) {
  return new Promise(resolve => {
    if (!channel) return resolve(null);
    const socket = connect({ host: '127.0.0.1', port: channel.port });
    let out = '';
    let timer = null;
    if (timeoutMs) timer = setTimeout(() => socket.destroy(), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${command} ${channel.token}\n`));
    socket.on('data', d => {
      if (out.length < 1_000_000) out += d;
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(timer);
      resolve(out || null);
    });
  });
}

const sameToken = (given, token) => {
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  return timingSafeEqual(Buffer.from(given, 'hex'), token);
};

// A device listing through the recorder: stdout and stderr joined, or null.
// ffmpeg prints the Windows and macOS listings on stderr, the Linux one on stdout.
export const runListing = (cwd, run = execFile) => (file, args) =>
  new Promise(resolve =>
    run(file, args, { cwd, shell: false, windowsHide: true, timeout: 15_000, maxBuffer: 1_000_000, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error && (error.code === 'ENOENT' || error.killed)) return resolve(null);
      resolve(`${stdout ?? ''}\n${stderr ?? ''}`);
    }),
  );

// What `wait` may print: only lines in the listener's own grammar (S6). Any
// other line, from whatever answers on the port listen.json names, is dropped.
const WAIT_LINE = new RegExp(
  [
    '^(?:',
    'Heard(?: \\(after reply\\))?: "(?:[^"\\\\\\n]|\\\\["\\\\])*"',
    '|timing: wait \\d{1,5} stt \\d{1,6}',
    '|plays \\d{1,4}',
    '|ready \\d{1,6} voice [A-Za-z0-9-]{1,64}',
    '|mic-fallback "[^"\\\\\\n]{1,64}"',
    '|dropped \\d{1,4}',
    '|stt-dropped|say-failed|mic-muted|mic-unmuted|interrupted|progress-due|quiet \\d{1,4}|stopped',
    `|listener error (?:${REASONS.join('|')})`,
    ')$',
  ].join(''),
);
export const waitLines = out =>
  String(out)
    .split('\n')
    .filter(l => WAIT_LINE.test(l))
    .map(l => `${l}\n`)
    .join('');

// One `say` on the channel: `say <token> <byte count>` and then that many bytes
// of UTF-8 text. Resolves the listener's one fixed line, or null when nothing
// answers. The text goes to the listener in memory, over 127.0.0.1, and nowhere else.
export const SAY_REPLIES = ['speaking', 'say-failed', 'say-refused', 'say-busy', 'say-no-player'];

// The instant acknowledgement (W3, W6, S5.2): one of these, in the person's
// voice, the moment a turn is heard and kept, a different one each time. Made
// once by the engine after `ready`. They stand in for the session's own "got it".
export const SPINNERS = Object.freeze(['Combobulating.', 'One sec.', 'Looking into it.', 'Percolating.', 'Noodling on it.', 'Pondering.', 'Clauding.', 'Julienning.', 'Let me see.', 'On it.']);
const SPINNER_KEYS = new Set(SPINNERS.map(s => s.toLowerCase().replace(/[^a-z ]/g, '')));
/** An index into `n` spinner words, never `last` again while there is another. */
export function pickSpinner(n, last, rand = Math.random) {
  if (n <= 1) return 0;
  const skip = last >= 0 && last < n;
  const i = Math.min(Math.floor(rand() * (skip ? n - 1 : n)), skip ? n - 2 : n - 1);
  return skip && i >= last ? i + 1 : i;
}
// Is this heard text one of the spinner words, as the mic picks up our own speaker?
export const isSpinnerEcho = text => SPINNER_KEYS.has(String(text).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim());
// A WAV with `ms` of silence in front (the player loses its first moment while it
// opens the device). Anything that is not a plain 44-byte-header PCM WAV is returned as it came.
export function leadSilence(wav, ms = 150) {
  if (!Buffer.isBuffer(wav) || wav.length <= 44 || wav.toString('latin1', 0, 4) !== 'RIFF' || wav.toString('latin1', 36, 40) !== 'data') return wav;
  const pad = Buffer.alloc(Math.round((wav.readUInt32LE(24) * ms) / 1000) * wav.readUInt16LE(22) * 2);
  const data = Buffer.concat([pad, wav.subarray(44)]);
  const head = Buffer.from(wav.subarray(0, 44));
  head.writeUInt32LE(36 + data.length, 4);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
function sendSay(channel, text, timeoutMs = 0) {
  return new Promise(resolve => {
    if (!channel) return resolve(null);
    const body = Buffer.from(String(text), 'utf8');
    if (body.length > 99_999) return resolve('say-refused\n');
    const socket = connect({ host: '127.0.0.1', port: channel.port });
    let out = '';
    let timer = null;
    if (timeoutMs) timer = setTimeout(() => socket.destroy(), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(Buffer.concat([Buffer.from(`say ${channel.token} ${body.length}\n`, 'latin1'), body])));
    socket.on('data', d => {
      if (out.length < 1000) out += d;
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(timer);
      resolve(out || null);
    });
  });
}

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref())]);

// The listener. Everything a test replaces comes in through `options`: the
// engine, the recorder (its listing and its spawn), the parent, a clock and
// the knobs. The command line passes only `home`. Resolves { done, stop } once
// it is listening; rejects with { reason } when it cannot start. `done`
// resolves with the reason it ended.
export async function startListener(options = {}) {
  const { home } = options;
  const platform = options.platform ?? process.platform;
  const knobs = { ...KNOBS, ...options.knobs };
  const clock = options.clock ?? (() => performance.now());
  const fsOptions = { platform };
  let finished = false;
  let finish = async () => {};

  try {
    if (typeof home !== 'string' || !home) stop('settings');
    let settings;
    try {
      settings = readSettings(home, fsOptions);
    } catch (e) {
      return stop(e.message === 'state' ? 'state' : 'settings');
    }
    if (!isEngine(settings.engine)) stop('engine');
    try {
      secureState(home, fsOptions);
    } catch {
      stop('state');
    }
    const run = runDir(home);

    // The recorder: resolved again by the platform rule, and it must be the one setup pinned.
    const recorder = options.recorder ?? {
      path: resolveRecorder({ platform, pathValue: process.env.PATH ?? process.env.Path, startDir: process.cwd() }),
      list: runListing(run),
      spawn: (file, args) => spawn(file, args, { cwd: run, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }),
    };
    if (!recorder.path || recorder.path !== settings.recorder) stop('recorder');

    // The device: the saved mic, wherever it sits in the list now (found by the
    // digest of its id, then of its name), or another when it is gone, named in
    // the first delivery so the session says so (S5.5). With no key the digests
    // match nothing, and settings from before (no id or name) match by stamp and index.
    const listing = await listDevices({ recorder: recorder.path, platform, run: recorder.list });
    if (listing.row < 0) stop('device');
    const key = readKey(home, fsOptions);
    const { device, how } = pickDevice(listing.devices, settings.device, text => (key ? deviceDigest(key, text) : ''));
    if (!device) stop('device');
    const micNotice = how === 'fallback' ? `mic-fallback "${fallbackName(device.name)}"` : null;

    // One listener at a time.
    const live = readChannel(home, fsOptions);
    if (live && (await ask(live, 'ping', 1000)) === 'alive\n') stop('busy');

    let engine;
    try {
      engine = options.engine ?? (await loadEngine(settings.engine, settings));
    } catch {
      return stop('engine');
    }
    if (!(await engine.health())) stop('engine');
    const tailMs = Math.min(Math.max(engine.tailMs ?? knobs.tailMs, 0), 1500);
    const gateKnobs = { ...knobs, tailMs };

    const gate = new Gate({ silenceMs: settings.endOfSpeechMs, knobs: gateKnobs, t: clock() });
    const queue = new HeardQueue(gateKnobs);
    const joiner = new Joiner(gateKnobs);
    const notices = new Map();
    const token = randomBytes(32);
    const parentPid = options.parentPid ?? process.ppid;
    const currentPpid = options.ppid ?? (() => process.ppid);
    const parentAlive =
      options.parentAlive ??
      (pid => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (e) {
          return e.code === 'EPERM';
        }
      });
    let waiter = null;
    let feed = null;
    let child = null;
    let childExited = null;
    let server;
    let lastDeliveryAt = Date.now();
    let rateTimer = null;
    let idleTimer = null;
    let noWaiterTimer = null;
    // No wait connects within relayWaitMs of ready: the mod that relays heard turns is not running (S4.7).
    let relayTimer = null;
    let everWaited = false;
    let parentTimer = null;
    let sttMs = 0;
    let sttFails = 0;
    let transcribing = Promise.resolve();
    let playing = 0;
    let plays = 0;
    let userMuted = false; // the person's mute, by voice or through the channel, and nobody else's (T11)
    let thinkingUntil = 0;
    let workingUntil = null; // the session said it is acting now (clock time it lapses); a spoken line or a heard turn ends it
    let progressFrom = 0; // the clock time the progress beat counts from
    let voiceMuted = false; // incantation's own voice, apart from the mic: a say counts as played and makes no audio
    let unheard = 0; // turns the gate handed over whose text is not settled yet
    const endedChains = new Set(); // cut turns whose continuation did not come
    const spinnerClips = [];
    let lastSpinner = -1;
    let spinner = null; // the handle of the spinner word playing now
    let lastPlayEvent = 0;
    let joinTimer = null;
    let heartbeat = null;
    let commandTimer = null;
    let lastState = '';
    // The replies this listener plays itself (T18): the one playing, the says
    // accepted and not yet finished, and a count that a barge-in or a stop moves on,
    // so a say that was waiting behind a cut reply is dropped with it.
    const rawPlayer = options.player ?? makePlayer({ platform, recorder: settings.recorder, tempDir: run });
    // The echo stack (S5.8), each layer optional: a missing part or a failed worker
    // leaves frames and turns as they were. A test that gives its own player gets no
    // layer unless it gives one too.
    const own = !!options.player;
    const off = { active: false, close() {} };
    // Every line played is also the canceller's reference, and the last lines spoken
    // are what a heard echo is matched against (text kept in memory only).
    const refFeed = new RefFeed();
    const aec = options.aec ?? (own ? { ...off, process: async frame => frame } : makeAec({ home, platform }));
    // What the speaker really plays, notification sounds included, is the better
    // reference; while it runs, the player's own samples are not added again.
    const loopback =
      options.loopback ??
      (own
        ? off
        : makeLoopback({
            home,
            platform,
            onSamples: s => {
              refFeed.append(s);
              refFeed.trim(1600); // 100 ms: the reference stays just ahead of its echo
            },
          }));
    // One ffplay for the session when there is one, so the speaker delay stays put
    // and the canceller converges once; every sample it is given is the reference.
    const ffplay = own ? null : findPlayer({ platform, recorder: settings.recorder });
    const stream = ffplay && /ffplay(\.exe)?$/i.test(ffplay.file) ? makeStreamPlayer({ ffplay: ffplay.file, cwd: run, onWrite: s => loopback.active || refFeed.append(s), leadMs: 300, timers: false }) : null;
    const speech = options.speech === undefined ? (own ? null : makeSpeech({ home })) : options.speech;
    const turnJudge = options.turnJudge ?? (own ? { ...off, done: () => Promise.resolve(null) } : makeTurnJudge({ home, platform }));
    const spoken = [];
    const noteSpoken = text => {
      if (!text) return;
      spoken.push({ text, at: Date.now() });
      while (spoken.length > 3) spoken.shift();
    };
    const recentSpoken = () => spoken.filter(s => Date.now() - s.at < 30_000).map(s => s.text);
    const player = {
      available: rawPlayer.available,
      name: rawPlayer.name,
      play(wav) {
        if (stream) return stream.play(wav);
        const handle = rawPlayer.play(wav);
        if (!handle) return handle;
        if (!loopback.active) refFeed.add(wavTo16k(wav));
        return {
          done: handle.done,
          stop() {
            if (!loopback.active) refFeed.clear();
            handle.stop();
          },
        };
      },
    };
    let current = null;
    let inSay = 0;
    let speechTail = Promise.resolve();
    let speechEpoch = 0;
    const idlers = new Set(); // connections waiting for no reply to be playing (T12)
    let idlePoll = null;

    // Is the session acting now (`working`), and has the status word not lapsed?
    const isWorking = () => workingUntil !== null && clock() < workingUntil;
    // The one word on screen (T9): muted, hearing, speaking, working, thinking or listening.
    const stateWord = () => (userMuted ? 'muted' : gate.hearing ? 'hearing' : playing > 0 ? 'speaking' : isWorking() ? 'working' : Date.now() < thinkingUntil ? 'thinking' : 'listening');
    const writeStatus = (force = false) => {
      const word = stateWord();
      writeLevels(force);
      if (!force && word === lastState) return;
      lastState = word;
      try {
        writePrivate(voicePath(home), voiceMuted ? 'muted\n' : 'on\n', fsOptions);
      } catch {
        // A convenience, like the status word.
      }
      try {
        writePrivate(statusPath(home), `${word}\n`, fsOptions);
      } catch {
        // The status line is a convenience: a file that will not write never stops the listener.
      }
    };
    // The mic's loudness for the band (T16): the stamp, the word and 24 digits, written when
    // the digits or the word change, and on the heartbeat so a reader can tell a gone listener.
    const meter = new Meter({ ...METER, frameMs: knobs.frameMs });
    let lastLevels = '';
    let wroteLevels = false;
    function writeLevels(force = false) {
      const body = `${stateWord()} ${meter.digits}`;
      if (!force && body === lastLevels) return;
      lastLevels = body;
      try {
        writePrivate(levelsPath(home), levelsLine(Date.now(), stateWord(), meter.digits), fsOptions);
        wroteLevels = true;
      } catch {
        // A convenience, like the status word.
      }
    }
    // The band's click (T16): a file holding exactly `mute` or `unmute`, written to the private
    // run folder, read once and removed. A link, a big file or a stale one is removed unread.
    const pollCommand = () => {
      const path = commandPath(home);
      let st;
      try {
        st = lstatSync(path);
      } catch {
        return;
      }
      let word = '';
      try {
        if (st.isFile() && !st.isSymbolicLink() && st.size <= 16 && Date.now() - st.mtimeMs <= knobs.commandFreshMs) word = readFileSync(path, 'utf8').trim();
      } catch {
        // Unreadable: removed below, unread.
      }
      rmSync(path, { force: true });
      if (word === 'mute' || word === 'unmute') setMuted(word === 'mute');
      // The band's second button: the listener's own voice, apart from the mic.
      if (word === 'mute-voice' || word === 'unmute-voice') setVoiceMuted(word === 'mute-voice');
    };

    let resolveDone;
    const done = new Promise(r => (resolveDone = r));
    finish = async reason => {
      if (finished) return;
      finished = true;
      for (const t of [rateTimer, idleTimer, noWaiterTimer, joinTimer, relayTimer]) clearTimeout(t);
      clearInterval(parentTimer);
      clearInterval(heartbeat);
      clearInterval(idlePoll);
      for (const s of idlers) s.end('idle-timeout\n');
      idlers.clear();
      clearInterval(commandTimer);
      if (lastState) rmSync(statusPath(home), { force: true });
      if (lastState) rmSync(voicePath(home), { force: true });
      spinner?.stop();
      spinner = null;
      if (wroteLevels) rmSync(levelsPath(home), { force: true });
      queue.items = [];
      joiner.take();
      speechEpoch++;
      current?.stop();
      current = null;
      feed?.close?.();
      aec.close?.();
      loopback.close?.();
      turnJudge.close?.();
      stream?.close();
      if (child && childExited) {
        child.kill();
        await Promise.race([childExited, new Promise(r => setTimeout(r, 2000).unref())]);
      }
      if (waiter) {
        // A stop the person asked for is no error.
        waiter.end(reason === 'stopped' ? 'stopped\n' : `listener error ${reason}\n`);
        waiter = null;
      }
      server?.close();
      server?.closeAllConnections?.();
      const mine = readChannel(home, fsOptions);
      if (mine && mine.token === token.toString('hex')) rmSync(listenFile(home), { force: true });
      resolveDone(reason);
    };

    const armNoWaiter = () => {
      clearTimeout(noWaiterTimer);
      noWaiterTimer = setTimeout(() => finish('ended'), knobs.noWaiterMs);
    };

    const serve = () => {
      if (!waiter || finished) return;
      const now = Date.now();
      // A wait ends only on a real heard turn, the first ready line, a stop or an
      // error (T14), and on two notices the session must act on: a progress line
      // that is due, and a turn lost out of a cut one (nothing the person said
      // goes missing unsaid). Every other notice, a quiet stretch and a dropped
      // count included, rides in the next such delivery, so silence costs the
      // session no turn.
      if (!queue.ready(now) && !notices.has('ready') && !notices.has('progress-due') && notices.get('stt-dropped') !== 'urgent') {
        clearTimeout(rateTimer);
        const at = queue.nextAt(now);
        if (at !== null) rateTimer = setTimeout(serve, Math.max(at - now, 0) + 5);
        return;
      }
      const lines = [];
      let dropped = 0;
      if (queue.ready(now)) {
        const taken = queue.take(now);
        for (const t of taken.turns) lines.push(...heardLines(t.text, t.afterReply, knobs.maxText));
        lines.push(`timing: wait ${settings.endOfSpeechMs} stt ${Math.round(sttMs)}`);
        // Playbacks since the last delivery, from any caller: the skill counts a
        // heard yes only when exactly one, its own say-back, came between.
        lines.push(`plays ${Math.min(plays, 9999)}`);
        plays = 0;
        dropped = taken.dropped;
        gate.delivered(clock());
        const quiet = Math.floor((now - lastDeliveryAt) / knobs.quietMs);
        if (quiet > 0) lines.push(`quiet ${Math.min(quiet, 9999)}`);
        lastDeliveryAt = now;
      }
      if (notices.has('ready')) {
        if (micNotice) lines.push(micNotice); // a fallback mic is said before ready, once
        lines.push(notices.get('ready'));
      }
      if (dropped) lines.push(`dropped ${dropped}`);
      for (const n of ['stt-dropped', 'say-failed', 'mic-muted', 'mic-unmuted', 'interrupted', 'progress-due']) if (notices.has(n)) lines.push(n);
      notices.clear();
      const w = waiter;
      waiter = null;
      clearTimeout(rateTimer);
      armNoWaiter();
      w.end(`${lines.join('\n')}\n`);
    };

    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = userMuted ? null : setTimeout(() => finish('ended'), knobs.idleMs);
    };

    // The person's mute, and nobody else's (T11). The mic stays open either way:
    // while muted a turn is still transcribed here, on this machine, only to
    // catch "unmute", and nothing else reaches the session.
    const setMuted = muted => {
      if (muted === userMuted) return;
      userMuted = muted;
      notices.delete(muted ? 'mic-unmuted' : 'mic-muted');
      notices.set(muted ? 'mic-muted' : 'mic-unmuted', true);
      if (muted) {
        queue.items = [];
        joiner.take();
      }
      armIdle();
      writeStatus();
      serve();
    };

    // Held turns go to the queue once their wait is over (T10).
    const armJoin = () => {
      clearTimeout(joinTimer);
      const at = joiner.nextAt();
      if (at === null) return;
      joinTimer = setTimeout(() => {
        for (const item of joiner.due(Date.now())) queue.push(item);
        armJoin();
        serve();
      }, Math.max(at - Date.now(), 0) + 5);
    };

    // The listener's own voice, apart from the mic (S5.1): while muted a say
    // counts as played and makes and plays no audio.
    const setVoiceMuted = muted => {
      voiceMuted = muted;
      if (muted) {
        spinner?.stop();
        spinner = null;
      }
      writeStatus(true);
    };

    // The held part of a cut turn goes on now: its continuation will not come, or was lost.
    const releaseHeld = chain => {
      for (const out of joiner.flush(Date.now(), chain)) queue.push(out);
      armJoin();
    };

    // The gate says no continuation came for a cut turn: it goes as it is, now or when its text settles.
    const endChain = chain => {
      endedChains.add(chain);
      if (endedChains.size > 50) endedChains.delete(endedChains.values().next().value);
      releaseHeld(chain);
      serve();
    };

    // The progress beat (L5): while the session is working, with no line spoken and no
    // turn heard, `progress-due` is raised once per progressMs. A line spoken or a turn
    // heard ends the working state, so the beat ends with it. Called on every frame;
    // the fake clock of a test moves with its frames.
    const checkProgress = () => {
      if (!isWorking() || userMuted || hearingTurn()) return;
      const now = clock();
      if (now - progressFrom < knobs.progressMs) return;
      progressFrom = now;
      notices.set('progress-due', true);
      serve();
    };

    // Is a turn being heard now: one open in the gate, one waiting for its text, or a held part waiting for its rest?
    const hearingTurn = () => gate.hearing || unheard > 0 || !!joiner.hold || turnHold.holding;

    // The spinner word (S5.2): one of the ten, the moment a turn ends. None on
    // a muted voice, and it never counts in `plays`. `early` (the end of speech) plays it over a line.
    const playSpinner = (early = false) => {
      if (voiceMuted || !player.available || spinner || !spinnerClips.length) return;
      if (!early && (current || playing > 0 || inSay > 0)) return;
      lastSpinner = pickSpinner(spinnerClips.length, lastSpinner);
      let handle = null;
      try {
        handle = player.play(spinnerClips[lastSpinner]);
      } catch {
        handle = null;
      }
      if (!handle) return;
      spinner = handle;
      gate.sound(true, clock());
      handle.done.then(() => {
        if (spinner !== handle) return;
        spinner = null;
        gate.sound(false, clock());
      });
    };

    // A turn that sounds unfinished waits for what follows (S5.8, turn.mjs); with no
    // judge running, turns pass straight to `heard`. It only waits, never ends sooner.
    const turnHold = new TurnHold({ judge: turnJudge, release: turn => heard(turn) });

    // The cue plays at the gate's end of speech, before the turn is transcribed, so the
    // person hears it at once and not seconds later where it would sound like a reply (S5.2).
    // That is before the text says whether the turn counts, so a stray cue is possible:
    // `settle` stops it where it stands for a mute word, a stop word, a fragment, a
    // failed transcript, or our own sound heard back. It always plays when a turn ends,
    // whatever began the turn (a quick answer inside the echo window, talk over a line,
    // a turn the gate cut), by the owner's word; only a muted mic skips it (and a muted
    // voice, which plays nothing).
    const earlyCue = () => {
      if (userMuted) return;
      playSpinner(true);
    };

    const heard = turn => {
      unheard++;
      transcribing = transcribing
        .then(() => settle(turn))
        .catch(() => {})
        .finally(() => unheard--);
    };

    // One turn's text, and what it does (the body of `heard`, after the turns before it).
    const settle = async turn => {
      if (finished) return;
      // A turn the gate cut for length, or the rest of one: the two are joined, and
      // if either is lost the session is told at once, not left to wonder (S5.7, bug fix).
      const chained = !!turn.cut || !!turn.continued;
      const began = clock();
      const text = await engine.transcribe(turn.pcm);
      sttMs = clock() - began;
      if (finished) return;
      if (text === null) {
        spinner?.stop(); // nothing was understood: no cue for it
        if (userMuted) return;
        sttFails++;
        if (sttFails >= knobs.sttFailures) return finish('stt');
        if (notices.get('stt-dropped') !== 'urgent') notices.set('stt-dropped', chained ? 'urgent' : true);
        if (turn.continued) releaseHeld(turn.chain);
        return serve();
      }
      sttFails = 0;
      if (userMuted) {
        if (isUnmuteWord(text)) setMuted(false);
        return;
      }
      if (isMuteWord(text)) {
        spinner?.stop();
        return setMuted(true);
      }
      // Our own spinner word, or a line we just spoke, picked up again by the mic: not a turn.
      // The cue was played at the end of speech, before this text existed: stop it where it stands.
      if (isFragment(text) || (turn.overlap && !isStopWord(text) && (isSpinnerEcho(text) || isEcho(text, recentSpoken())))) {
        spinner?.stop();
        if (turn.continued) releaseHeld(turn.chain);
        return serve();
      }
      if (isStopWord(text)) spinner?.stop();
      // A real turn heard moves the reply on (W8): a line still playing stops,
      // every say that has not started is dropped (its caller gets say-failed),
      // and the next delivery says `interrupted`.
      if (current) {
        const cut = current;
        current = null;
        playing = 0;
        gate.playback(0, clock());
        notices.set('interrupted', true);
        cut.stop();
      }
      speechEpoch++;
      armIdle();
      thinkingUntil = Date.now() + knobs.thinkingMs;
      workingUntil = null;
      const item = {
        text,
        afterReply: turn.afterReply,
        exempt: turn.firstAfterReply || isStopWord(text),
        at: Date.now(),
        cut: !!turn.cut && !endedChains.has(turn.chain),
        continued: !!turn.continued,
        chain: turn.chain,
      };
      for (const out of joiner.offer(item, Date.now())) queue.push(out);
      armJoin();
      writeStatus();
      serve();
    };

    // A person who talks over a reply cuts it off (T8). The mic was never shut,
    // so the turn goes on as any other; the session is told its reply was cut.
    // The player is killed, and a reply that was waiting behind it never plays (T18).
    const bargeIn = () => {
      if (userMuted) return;
      const cut = current;
      current = null;
      speechEpoch++;
      playing = 0;
      gate.playback(0, clock());
      notices.set('interrupted', true);
      cut?.stop();
      writeStatus();
      serve();
    };

    // One reply, start to end (T18): generated by the engine, played by the player
    // this listener owns, so the status word and the idle wait follow the audio
    // itself. `reply` answers the one `say` that asked, once, with a fixed line.
    const speakOne = async (text, epoch, reply) => {
      const gone = () => finished || epoch !== speechEpoch;
      if (gone()) return reply('say-failed');
      let wav = null;
      try {
        wav = await engine.synthesize(text);
      } catch {
        wav = null;
      }
      if (gone() || !wav) return reply('say-failed');
      // Never over the person (bug fix): while a turn is being heard, or its text
      // is not settled, the line waits. If that turn is kept the line is stale and
      // is dropped (gone); if it is dropped the line goes on. A person who talks
      // past holdSayMs fails the line rather than have it spoken over them.
      const waitedFrom = Date.now();
      while (!gone() && (hearingTurn() || spinner)) {
        if (Date.now() - waitedFrom > knobs.holdSayMs) return reply('say-failed');
        await new Promise(r => setTimeout(r, knobs.holdPollMs));
      }
      if (gone()) return reply('say-failed');
      const handle = player.play(wav);
      if (!handle) return reply('say-failed');
      current = handle;
      noteSpoken(text);
      playing = 1;
      plays++;
      thinkingUntil = 0;
      workingUntil = null;
      lastPlayEvent = Date.now();
      gate.playback(1, clock());
      writeStatus();
      reply('speaking');
      const outcome = await handle.done;
      if (current !== handle) return; // cut off, or the listener stopped: already settled
      current = null;
      playing = 0;
      lastPlayEvent = Date.now();
      gate.playback(0, clock());
      if (outcome === 'failed') notices.set('say-failed', true);
      writeStatus();
    };

    const sayText = (socket, raw) => {
      const answer = line => {
        if (!socket.destroyed) socket.end(`${line}\n`);
      };
      const text = cleanText(raw, knobs.maxSayChars + 1);
      if (!text || [...text].length > knobs.maxSayChars) return answer('say-refused');
      if (voiceMuted) {
        // A muted voice: the line counts as said (the play count and the reply mark
        // stay true, so a spoken yes still counts) but nothing is synthesized or played.
        plays++;
        thinkingUntil = 0;
        workingUntil = null;
        gate.playback(1, clock());
        gate.playback(0, clock());
        writeStatus();
        return answer('speaking');
      }
      if (!player.available) return answer('say-no-player');
      if (inSay >= 1 + knobs.sayQueueMax) return answer('say-busy');
      inSay++;
      const epoch = speechEpoch;
      speechTail = speechTail
        .then(() => speakOne(text, epoch, answer))
        .catch(() => answer('say-failed'))
        .finally(() => inSay--);
    };

    // The text of one say: the bytes the header counted, within the handshake time.
    const takeSay = (socket, have, count) => {
      if (count > knobs.maxSayChars * 4) return void socket.end('say-refused\n');
      const parts = [have];
      let size = have.length;
      const timer = setTimeout(() => socket.destroy(), knobs.handshakeMs);
      const more = d => {
        parts.push(d);
        size += d.length;
        if (size >= count) enough();
      };
      const enough = () => {
        clearTimeout(timer);
        socket.off('data', more);
        sayText(socket, Buffer.concat(parts).subarray(0, count).toString('utf8'));
      };
      socket.once('close', () => clearTimeout(timer));
      if (size >= count) return enough();
      socket.on('data', more);
    };

    // Replies still playing or waiting, or ended less than the tail ago, hold an
    // idle wait (T12), and so does a turn being heard: the person is mid-sentence
    // and a reply now would be spoken over them (bug fix).
    const checkIdle = () => {
      if (playing > 0 || inSay > 0 || spinner || hearingTurn() || Date.now() - lastPlayEvent < tailMs) return;
      for (const s of idlers) s.end('idle\n');
      idlers.clear();
      clearInterval(idlePoll);
      idlePoll = null;
    };

    // A connection says `wait`, `stop`, `ping` and the other one-word commands, or
    // `say` with its byte count and text, with the token, within 2 s, or it is
    // closed. Until then it holds no slot.
    server = createServer(socket => {
      socket.on('error', () => {});
      const idle = setTimeout(() => socket.destroy(), knobs.handshakeMs);
      let pending = '';
      const onData = d => {
        pending += d.toString('latin1');
        const nl = pending.indexOf('\n');
        if (nl < 0 || nl > 256) {
          if (pending.length > 256) socket.destroy();
          return;
        }
        socket.off('data', onData);
        clearTimeout(idle);
        const head = /^say ([0-9a-f]{64}) (\d{1,5})\r?$/.exec(pending.slice(0, nl));
        if (head) {
          if (!sameToken(head[1], token)) return socket.destroy();
          return void takeSay(socket, Buffer.from(pending.slice(nl + 1), 'latin1'), Number(head[2]));
        }
        const m = /^(wait|stop|ping|mute|unmute|idle|status|working|mute-voice|unmute-voice) ([0-9a-f]{64})\r?$/.exec(pending.slice(0, nl));
        if (!m || !sameToken(m[2], token)) return socket.destroy();
        if (m[1] === 'ping') return void socket.end('alive\n');
        if (m[1] === 'status') return void socket.end(`${stateWord()}\n`);
        if (m[1] === 'mute' || m[1] === 'unmute') {
          setMuted(m[1] === 'mute');
          return void socket.end(m[1] === 'mute' ? 'mic-muted\n' : 'mic-unmuted\n');
        }
        if (m[1] === 'working') {
          // The session is acting now. The word shows until the next line is spoken or
          // turn heard, or workingMs after the last call. A repeat call extends the word;
          // the progress beat counts from when work began, not from the repeat (S5.3).
          const now = clock();
          if (!isWorking()) progressFrom = now;
          thinkingUntil = 0;
          workingUntil = now + knobs.workingMs;
          writeStatus();
          return void socket.end('working\n');
        }
        if (m[1] === 'mute-voice' || m[1] === 'unmute-voice') {
          setVoiceMuted(m[1] === 'mute-voice');
          return void socket.end(voiceMuted ? 'voice-muted\n' : 'voice-unmuted\n');
        }
        if (m[1] === 'idle') {
          if (idlers.size >= 4) return void socket.end('idle-timeout\n');
          idlers.add(socket);
          const gaveUp = setTimeout(() => {
            if (idlers.delete(socket)) socket.end('idle-timeout\n');
          }, knobs.idleWaitMs);
          socket.once('close', () => {
            clearTimeout(gaveUp);
            idlers.delete(socket);
          });
          idlePoll ??= setInterval(checkIdle, 50);
          return void checkIdle();
        }
        if (m[1] === 'stop') return void finish('stopped').then(() => socket.end('stopped\n'));
        // A second wait while one is live is not the listener failing: it says a wait is already running (T13).
        if (waiter) return void socket.end('listener error waiting\n');
        waiter = socket;
        clearTimeout(noWaiterTimer);
        everWaited = true;
        clearTimeout(relayTimer);
        socket.on('close', () => {
          if (waiter === socket) {
            waiter = null;
            if (!finished) armNoWaiter();
          }
        });
        serve();
      };
      socket.on('data', onData);
      socket.once('close', () => clearTimeout(idle));
    });
    await new Promise((res, rej) => {
      server.once('error', rej);
      server.listen(0, '127.0.0.1', res);
    });
    writePrivate(listenFile(home), JSON.stringify({ port: server.address().port, token: token.toString('hex') }), fsOptions);

    // The playback feed first: nothing is captured until it answers, so no
    // playback can begin unseen while the mic is open.
    feed = engine.playback();
    const opened = new Promise((resolve, reject) => {
      feed.once('open', resolve);
      feed.once('error', reject);
    });
    // A reply another caller speaks through Voicebox itself is counted and no
    // more: Voicebox ends it on this feed within a second of its start, long
    // before the audio ends, so it says nothing about what is playing (T18).
    // The listener's own replies never appear here.
    feed.on('start', () => {
      plays++;
    });
    feed.on('error', () => finish('playback'));
    try {
      await withTimeout(opened, knobs.feedOpenMs);
    } catch {
      stop('playback');
    }

    // Warm in the background; `ready` goes to the next waiter.
    // After `ready`, in the background, the engine makes the ten spinner words once,
    // each with 150 ms of silence in front. Until they exist nothing plays (L3).
    const makeSpinners = async () => {
      for (const line of SPINNERS) {
        if (finished) return;
        const wav = await Promise.resolve(engine.synthesize(line)).catch(() => null);
        if (wav) spinnerClips.push(leadSilence(wav));
      }
    };
    withTimeout(engine.warm(), knobs.warmMs).then(
      ms => {
        notices.set('ready', `ready ${ms} voice ${settings.profile}`);
        if (!everWaited && !finished) relayTimer = setTimeout(() => finish('relay'), knobs.relayWaitMs);
        serve();
        makeSpinners().catch(() => {});
      },
      () => finish('warm'),
    );

    child = recorder.spawn(recorder.path, captureArgs(platform, listing.row, device.id));
    childExited = new Promise(r => child.once('exit', r));
    child.on('error', () => finish('recorder'));
    child.on('exit', () => finish('recorder'));
    const size = frameBytes(knobs);
    const silentFrames = Math.ceil(knobs.silentStartMs / knobs.frameMs);
    let framesSeen = 0;
    let anySound = false;
    let carry = Buffer.alloc(0);
    // Frames reach the gate in order, through the echo canceller while it runs
    // (`clean` is the cleaned frame, `raw` the one the mic gave).
    let aecChain = Promise.resolve();
    let aecPending = 0;
    const onFrame = (clean, raw) => {
      if (finished) return;
      for (const e of gate.frame(clean, clock(), aec.active ? raw : null, speech ? speech(clean) : true)) {
        if (e.type === 'turn') {
          earlyCue();
          turnHold.offer(e, clock());
        }
        else if (e.type === 'barge') bargeIn();
        else if (e.type === 'cut-over') endChain(e.chain);
      }
      turnHold.tick(clock(), gate.hearing);
      checkProgress();
      meter.add(gate.level, clock(), userMuted);
      writeStatus();
    };
    child.stdout.on('data', d => {
      carry = carry.length ? Buffer.concat([carry, d]) : d;
      while (carry.length >= size && !finished) {
        const frame = Buffer.from(carry.subarray(0, size));
        carry = carry.subarray(size);
        if (!anySound) {
          framesSeen++;
          if (frame.some(b => b !== 0)) anySound = true;
          else if (framesSeen >= silentFrames) return void finish('mic');
        }
        stream?.pump(knobs.frameMs); // the mic's clock paces the player and the reference
        const ref = refFeed.take(frame.length / 2);
        // Without a canceller the frame goes straight on, in the same turn of the loop, as before.
        if (!aec.active && aecPending === 0) {
          onFrame(frame, frame);
          continue;
        }
        aecPending++;
        aecChain = aecChain
          .then(() => aec.process(frame, ref))
          .then(clean => onFrame(clean, frame), () => onFrame(frame, frame))
          .finally(() => aecPending--);
      }
    });

    parentTimer = setInterval(() => {
      if (currentPpid() !== parentPid || !parentAlive(parentPid)) finish('ended');
    }, knobs.parentPollMs);
    armIdle();
    armNoWaiter();
    writeStatus(true);
    // The status file is touched on a beat, so a reader can tell a listener that has gone from one that is quiet.
    heartbeat = setInterval(() => writeStatus(true), knobs.heartbeatMs);
    heartbeat.unref?.();
    commandTimer = setInterval(pollCommand, knobs.commandPollMs);
    commandTimer.unref?.();

    return { done, stop: reason => finish(reason ?? 'ended'), port: server.address().port };
  } catch (e) {
    await finish('settings');
    throw e instanceof Stop ? { reason: e.reason } : { reason: 'settings' };
  }
}

async function main(argv, home = homedir()) {
  const say = text => process.stdout.write(`${text}\n`);
  const command = argv[2];
  if (command === 'start') {
    let listener;
    try {
      listener = await startListener({ home });
    } catch (e) {
      return say(`listener error ${REASONS.includes(e?.reason) ? e.reason : 'settings'}`), 1;
    }
    const end = () => listener.stop('ended');
    process.on('SIGTERM', end);
    process.on('SIGINT', end);
    const reason = await listener.done;
    if (reason === 'stopped') return say('listener stopped'), 0;
    return say(`listener error ${REASONS.includes(reason) ? reason : 'ended'}`), 1;
  }
  if (command === 'wait') {
    // The first wait can start before the listener is up: look for its channel
    // for a few seconds before saying it is not running.
    let channel = readChannel(home);
    for (let i = 0; !channel && i < 30; i++) {
      await new Promise(r => setTimeout(r, 100));
      channel = readChannel(home);
    }
    const out = waitLines((await ask(channel, 'wait')) ?? '');
    if (!out) return say('listener error ended'), 1;
    process.stdout.write(out);
    return /^listener error /m.test(out) ? 1 : 0;
  }
  if (command === 'stop') {
    const out = await ask(readChannel(home), 'stop', 5000);
    if (out === 'stopped\n') return say('listener stopped'), 0;
    return say('listener: not running'), 0;
  }
  // The session's speech: the text comes on stdin, never as an argument, so no
  // shell ever sees it. One fixed line comes back.
  if (command === 'say') {
    const hex = argv[3];
    if (argv.length !== 4 || !/^[0-9a-f]{8}$/.test(hex)) return say('usage: listen.mjs say <8 hex>'), 2;
    // The session's own words, in a file it wrote with its file tool: read once,
    // then deleted whatever the result. A link, a folder or a file over the cap is refused.
    const path = join(observeDir(home), `say-${hex}.txt`);
    let text = null;
    try {
      const st = lstatSync(path);
      if (st.isFile() && !st.isSymbolicLink() && st.size <= KNOBS.maxSayChars * 4) text = readFileSync(path, 'utf8');
    } catch {
      // not there
    }
    rmSync(path, { force: true });
    if (text === null) return say('say-refused'), 0;
    const out = ((await sendSay(readChannel(home), text, KNOBS.sayWaitMs)) ?? '').trim();
    return say(SAY_REPLIES.includes(out) ? out : 'listener: not running'), 0;
  }
  // The person's mute, the idle wait and the status word: each answers one fixed line.
  const ONE = { mute: ['mic-muted'], unmute: ['mic-unmuted'], idle: ['idle', 'idle-timeout'], status: ['listening', 'hearing', 'thinking', 'working', 'speaking', 'muted'] };
  if (Object.hasOwn(ONE, command)) {
    const out = ((await ask(readChannel(home), command, KNOBS.idleWaitMs + 2000)) ?? '').trim();
    return say(ONE[command].includes(out) ? out : 'listener: not running'), 0;
  }
  // `working` and the voice mute are newer than the first listener build. A listener
  // started before them closes the connection on the command; the client then says a
  // restart is needed, not that nothing is running (S5.1).
  const NEWER = { working: ['working'], 'mute-voice': ['voice-muted'], 'unmute-voice': ['voice-unmuted'] };
  if (Object.hasOwn(NEWER, command)) {
    const channel = readChannel(home);
    const out = ((await ask(channel, command, 5000)) ?? '').trim();
    if (NEWER[command].includes(out)) return say(out), 0;
    const alive = (await ask(channel, 'ping', 2000)) === 'alive\n';
    return say(alive ? 'listener: restart needed for this command' : 'listener: not running'), 0;
  }
  say('usage: listen.mjs start | wait | stop | mute | unmute | mute-voice | unmute-voice | working | idle | status | say <8 hex>');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let code;
  try {
    code = await main(process.argv);
  } catch {
    process.stdout.write('listener error settings\n');
    code = 1;
  }
  process.exit(code);
}

export { main, sendSay as say };
