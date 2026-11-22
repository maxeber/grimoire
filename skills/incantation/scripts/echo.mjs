// The echo guard (docs/spec/0001, S5.8). On a laptop speaker the mic hears the
// listener's own voice. The layers here:
//
//   isEcho(text, spoken)  a heard turn that only repeats a line just spoken
//   makeLoopback          on Windows, everything the speaker plays (system
//                         sounds such as a notification bleep included) as
//                         the reference, so not only the listener's own voice
//                         is taken out; without it, what the player wrote
//   RefFeed, makeAec      acoustic echo cancellation: what the player plays is
//                         fed, at 16 kHz, as the reference to WebRTC's AEC3
//                         (the livekit package) in aec-worker.py, which takes
//                         it out of each mic frame before the gate hears it
//
// Each layer is optional: with no runtime, or a worker that fails, frames pass
// through as they came. Every worker is started with no shell, `-I` for Python,
// the runtime's own interpreter, stdin and stdout pipes only, stderr discarded,
// the state folder as its working folder and a named environment.

import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateDir } from './lib.mjs';
import { namedEnv, pythonExe, workerEnv } from './runtime/install.mjs';

const words = text =>
  String(text)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Is the heard text mostly words of a line just spoken? At least 70% of its
 *  words, and never on nothing. */
export function isEcho(text, spoken, share = 0.7) {
  const heard = words(text);
  if (!heard.length || !spoken?.length) return false;
  const said = new Set(spoken.flatMap(words));
  return heard.filter(w => said.has(w)).length / heard.length >= share;
}

/** A 16-bit mono PCM WAV as 16 kHz samples (linear resampling); empty for
 *  anything else. */
export function wavTo16k(wav) {
  if (!Buffer.isBuffer(wav) || wav.length < 44 || wav.toString('latin1', 0, 4) !== 'RIFF' || wav.toString('latin1', 8, 12) !== 'WAVE') return new Int16Array(0);
  if (wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 16) return new Int16Array(0);
  const rate = wav.readUInt32LE(24);
  const n = Math.floor((wav.length - 44) / 2);
  if (!rate || !n) return new Int16Array(0);
  const src = i => wav.readInt16LE(44 + Math.min(n - 1, i) * 2);
  const m = Math.floor((n * 16000) / rate);
  const out = new Int16Array(m);
  for (let j = 0; j < m; j++) {
    const x = (j * rate) / 16000;
    const i = Math.floor(x);
    out[j] = Math.round(src(i) + (src(i + 1) - src(i)) * (x - i));
  }
  return out;
}

/** What is playing now, as 16 kHz samples, handed out one mic frame at a time.
 *  A new line mixes in from the current point; a barge-in clears it. */
export class RefFeed {
  constructor() {
    this.buf = new Int16Array(0);
  }

  add(samples) {
    if (samples.length > this.buf.length) {
      const grown = new Int16Array(samples.length);
      grown.set(this.buf);
      this.buf = grown;
    }
    for (let i = 0; i < samples.length; i++) this.buf[i] = Math.max(-32768, Math.min(32767, this.buf[i] + samples[i]));
  }

  /** The continuous stream case: what the player wrote, in order. Kept to
   *  two seconds, so clock drift cannot grow it. */
  append(samples) {
    const joined = new Int16Array(this.buf.length + samples.length);
    joined.set(this.buf);
    joined.set(samples, this.buf.length);
    this.buf = joined.length > 32_000 ? joined.subarray(joined.length - 32_000) : joined;
  }

  take(n) {
    const out = Buffer.alloc(n * 2);
    const k = Math.min(n, this.buf.length);
    for (let i = 0; i < k; i++) out.writeInt16LE(this.buf[i], i * 2);
    this.buf = this.buf.subarray(k);
    return out;
  }

  /** Keep only the newest `max` samples: a reference captured live must stay
   *  close to now, or drift between two clocks would push it behind the echo. */
  trim(max) {
    if (this.buf.length > max) this.buf = this.buf.subarray(this.buf.length - max);
  }

  get empty() {
    return this.buf.length === 0;
  }

  clear() {
    this.buf = new Int16Array(0);
  }
}

export const AEC_WORKER = fileURLToPath(new URL('./engines/aec-worker.py', import.meta.url));

/** How a worker is started: no shell, pipes only, stderr discarded, the state
 *  folder as its working folder, a named environment. */
export const workerOptions = ({ home, env, platform, shellEnv = false }) => ({
  stdio: ['pipe', 'pipe', 'ignore'],
  windowsHide: true,
  shell: false,
  cwd: stateDir(home),
  env: shellEnv ? namedEnv(env, {}, platform) : workerEnv(home, env, platform),
});
const MAGIC = 'AEC1';
const FRAME = 960; // 30 ms at 16 kHz, 16-bit
const MAX_PENDING = 30; // about a second behind: give up and pass frames through

/** The echo canceller. `process(mic, ref)` resolves the cleaned frame, or the
 *  mic frame itself when the canceller is not running. */
export function makeAec({ home = homedir(), platform = process.platform, env = process.env, python = pythonExe(home, platform), worker = AEC_WORKER, spawn = nodeSpawn, exists = existsSync } = {}) {
  const off = { active: false, ready: Promise.resolve(false), process: mic => Promise.resolve(mic), close() {} };
  if (!exists(python) || !exists(worker)) return off;
  let child;
  try {
    child = spawn(python, ['-I', worker], workerOptions({ home, env, platform }));
  } catch {
    return off;
  }
  let up = false;
  let dead = false;
  let buf = Buffer.alloc(0);
  const pending = [];
  let markReady;
  const ready = new Promise(r => (markReady = r));
  const fail = () => {
    dead = true;
    up = false;
    markReady(false);
    while (pending.length) {
      const p = pending.shift();
      p.resolve(p.mic);
    }
  };
  child.on('error', fail);
  child.on('exit', fail);
  child.stdin.on('error', fail);
  child.stdout.on('data', d => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    if (!up && !dead) {
      if (buf.length < MAGIC.length) return;
      if (buf.toString('latin1', 0, MAGIC.length) !== MAGIC) return fail();
      buf = buf.subarray(MAGIC.length);
      up = true;
      markReady(true);
    }
    while (buf.length >= FRAME && pending.length) {
      pending.shift().resolve(Buffer.from(buf.subarray(0, FRAME)));
      buf = buf.subarray(FRAME);
    }
  });
  return {
    get active() {
      return up && !dead;
    },
    ready,
    process(mic, ref) {
      if (!up || dead || mic.length !== FRAME || ref.length !== FRAME) return Promise.resolve(mic);
      if (pending.length >= MAX_PENDING) {
        try {
          child.kill();
        } catch {}
        fail();
        return Promise.resolve(mic);
      }
      return new Promise(resolve => {
        pending.push({ mic, resolve });
        child.stdin.write(Buffer.concat([mic, ref]));
      });
    },
    close() {
      if (dead) return;
      try {
        child.stdin.end();
        child.kill();
      } catch {}
      fail();
    },
  };
}

export const LOOPBACK_SCRIPT = fileURLToPath(new URL('./engines/loopback.ps1', import.meta.url));
const LB_MAGIC = 'LBK1';

/** Windows PowerShell by its absolute path in the system folder, never one
 *  found on PATH. */
export const windowsPowerShell = env => join(env.SystemRoot ?? env.SYSTEMROOT ?? env.systemroot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe').replaceAll('/', '\\');

/** The speaker's own output, through engines/loopback.ps1, as 16 kHz samples
 *  handed to `onSamples`. Windows only; `active` once the capture runs and
 *  until it ends, so the caller can fall back to the player's samples. */
export function makeLoopback({ onSamples, home = homedir(), platform = process.platform, env = process.env, script = LOOPBACK_SCRIPT, spawn = nodeSpawn, exists = existsSync } = {}) {
  const off = { active: false, close() {} };
  if (platform !== 'win32' || !exists(script)) return off;
  let child;
  try {
    child = spawn(windowsPowerShell(env), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { ...workerOptions({ home, env, platform, shellEnv: true }), stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return off;
  }
  let up = false;
  let dead = false;
  let buf = Buffer.alloc(0);
  const end = () => {
    dead = true;
    up = false;
  };
  child.on('error', end);
  child.on('exit', end);
  child.stdout.on('data', d => {
    if (dead) return;
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    if (!up) {
      if (buf.length < LB_MAGIC.length) return;
      if (buf.toString('latin1', 0, LB_MAGIC.length) !== LB_MAGIC) {
        try {
          child.kill();
        } catch {}
        return end();
      }
      buf = buf.subarray(LB_MAGIC.length);
      up = true;
    }
    const n = buf.length >> 1;
    if (!n) return;
    const s = new Int16Array(n);
    for (let i = 0; i < n; i++) s[i] = buf.readInt16LE(i * 2);
    buf = buf.subarray(n * 2);
    onSamples(s);
  });
  return {
    get active() {
      return up && !dead;
    },
    close() {
      if (dead) return;
      try {
        child.kill();
      } catch {}
      end();
    },
  };
}
