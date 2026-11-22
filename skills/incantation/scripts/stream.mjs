// The steady output and the speech detector (docs/spec/0001, S5.8).
//
//   makeStreamPlayer  one ffplay for the whole session, fed silence between
//                     lines. A new ffplay per line landed the speaker delay
//                     somewhere new each time (391 to 466 ms), and the echo
//                     canceller leaked the first second of every line while it
//                     found it again. Every sample written is also handed to
//                     `onWrite` at 16 kHz: the canceller's reference.
//   makeSpeech        Silero VAD through sherpa-onnx: is this frame speech? A
//                     keyboard or a click is loud but is not.
//
// Both are optional: with no ffplay the listener keeps its old player, and with
// no model every frame counts as speech, as before.

import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runtimeDir } from './runtime/install.mjs';

export const OUT_RATE = 24_000;

/** Samples of a 16-bit mono WAV, and its rate; null for anything else. */
export function wavSamples(wav) {
  if (!Buffer.isBuffer(wav) || wav.length < 44 || wav.toString('latin1', 0, 4) !== 'RIFF') return null;
  if (wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 16) return null;
  const n = Math.floor((wav.length - 44) / 2);
  const s = new Int16Array(n);
  for (let i = 0; i < n; i++) s[i] = wav.readInt16LE(44 + i * 2);
  return { samples: s, rate: wav.readUInt32LE(24) };
}

/** Linear resampling between any two rates. */
export function resample(samples, from, to) {
  if (from === to) return samples;
  const m = Math.floor((samples.length * to) / from);
  const out = new Int16Array(m);
  for (let j = 0; j < m; j++) {
    const x = (j * from) / to;
    const i = Math.floor(x);
    const a = samples[i] ?? 0;
    const b = samples[i + 1] ?? a;
    out[j] = Math.round(a + (b - a) * (x - i));
  }
  return out;
}

const FFPLAY_STREAM = ['-hide_banner', '-nodisp', '-loglevel', 'quiet', '-f', 's16le', '-ar', String(OUT_RATE), '-ch_layout', 'mono', '-i', 'pipe:0'];

/** One player for the session. `play(wav)` queues a line and returns
 *  { done, stop } like the old player; `done` resolves 'ended' once the line
 *  has been written and `latencyMs` more have passed, 'killed' on stop, or
 *  'failed' if ffplay is gone. Time comes from `now`, and `tick` is driven by
 *  the caller's timer (or a test). */
export function makeStreamPlayer({ ffplay, cwd, spawn = nodeSpawn, exists = existsSync, now = () => Date.now(), onWrite = () => {}, latencyMs = 400, leadMs = 100, tickMs = 20, timers = true } = {}) {
  if (!ffplay || !exists(ffplay)) return null;
  let child;
  try {
    // `cwd` is the state folder (never the session's folder, where a planted DLL could be found by name).
    child = spawn(ffplay, FFPLAY_STREAM, { shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'], ...(cwd ? { cwd } : {}) });
  } catch {
    return null;
  }
  let dead = false;
  const lines = [];
  const t0 = now();
  let written = 0; // samples at OUT_RATE written since t0
  let released = 0; // of those, handed to onWrite as due to play
  const pending = [];
  const finishing = new Set();
  const die = () => {
    if (dead) return;
    dead = true;
    for (const l of lines.splice(0)) l.settle('failed');
  };
  child.on('error', die);
  child.on('exit', die);
  child.stdin.on('error', die);
  // Writes up to `ms` of stream time plus the lead. Driven by the mic (`pump`),
  // the player and the reference share the sound card's clock; the timer is
  // only for a player nobody pumps.
  let micMs = null;
  const tick = () => {
    if (dead) return;
    const at = micMs ?? now() - t0;
    const due = Math.floor(((at + leadMs) * OUT_RATE) / 1000) - written;
    if (due <= 0) return;
    const out = new Int16Array(due);
    let k = 0;
    while (k < due && lines.length) {
      const l = lines[0];
      const take = Math.min(due - k, l.samples.length - l.pos);
      out.set(l.samples.subarray(l.pos, l.pos + take), k);
      l.pos += take;
      k += take;
      if (l.pos >= l.samples.length) {
        lines.shift();
        // its last sample is heard about latencyMs after its place in the stream
        l.endAt = Math.round(((written + k) * 1000) / OUT_RATE) + latencyMs;
        finishing.add(l);
      }
    }
    written += due;
    child.stdin.write(Buffer.from(out.buffer, out.byteOffset, out.byteLength));
    // The reference gets each sample when it is due to play, not when it is
    // written ahead: written ahead, it ran the lead's length early.
    pending.push(out);
    const dueRef = Math.floor((at * OUT_RATE) / 1000) - released;
    if (dueRef > 0) {
      const all = pending.length === 1 ? pending[0] : Int16Array.from(pending.flatMap(a => [...a]));
      const give = all.subarray(0, Math.min(dueRef, all.length));
      pending.length = 0;
      if (give.length < all.length) pending.push(all.subarray(give.length));
      released += give.length;
      onWrite(resample(give, OUT_RATE, 16_000));
    }
    for (const l of finishing) if (at >= l.endAt) {
      finishing.delete(l);
      l.settle('ended');
    }
  };
  const timer = timers ? setInterval(tick, tickMs) : null;
  timer?.unref?.();
  return {
    available: true,
    name: ffplay,
    tick,
    /** One mic frame more: the stream advances by exactly its length. */
    pump(frameMs = 30) {
      if (micMs === null) {
        micMs = Math.round((written * 1000) / OUT_RATE) - leadMs; // carry on where the timer left off
        clearInterval(timer);
      }
      micMs += frameMs;
      tick();
    },
    play(wav) {
      if (dead) return null;
      const w = wavSamples(wav);
      if (!w) return null;
      let resolve;
      const done = new Promise(r => (resolve = r));
      const line = { samples: resample(w.samples, w.rate, OUT_RATE), pos: 0, settled: false };
      line.settle = outcome => {
        if (line.settled) return;
        line.settled = true;
        resolve(outcome);
      };
      lines.push(line);
      return {
        done,
        stop() {
          const i = lines.indexOf(line);
          if (i >= 0) lines.splice(i, 1);
          finishing.delete(line);
          line.settle('killed');
        },
      };
    },
    close() {
      clearInterval(timer);
      try {
        child.stdin.end();
        child.kill();
      } catch {}
      die();
    },
  };
}

/** `(frame) => boolean` for 16 kHz 16-bit frames, or null when the model or
 *  the addon is missing. */
export function makeSpeech({ home = homedir(), model = join(runtimeDir(home), 'vad', 'silero_vad.onnx'), sherpaDir = join(runtimeDir(home), 'node_modules', 'sherpa-onnx-node'), exists = existsSync, load } = {}) {
  if (!exists(model)) return null;
  let vad;
  try {
    const sherpa = load ? load() : createRequire(import.meta.url)(sherpaDir);
    vad = new sherpa.Vad(
      { sileroVad: { model, threshold: 0.5, minSilenceDuration: 0.3, minSpeechDuration: 0.1, windowSize: 512 }, sampleRate: 16_000, numThreads: 1, provider: 'cpu', debug: false },
      30,
    );
  } catch {
    return null;
  }
  return frame => {
    const n = frame.length / 2;
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = frame.readInt16LE(i * 2) / 32768;
    vad.acceptWaveform(f);
    while (!vad.isEmpty()) vad.pop();
    return vad.isDetected();
  };
}
