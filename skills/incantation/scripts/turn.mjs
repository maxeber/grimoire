// End of turn (docs/spec/0001, S5.8). The gate ends a turn after a
// stretch of silence; a pause mid-thought did that too, and the session answered
// half a sentence. Here Pipecat's Smart Turn (engines/turn-worker.py) hears from
// the voice whether the person sounds finished. A turn that sounds unfinished is
// held a little longer: speech that follows joins it, and silence lets it go.
// The hold only ever waits longer than the gate; it never ends a turn sooner.
// With no model, turns pass straight through.

import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerOptions } from './echo.mjs';
import { pythonExe, runtimeDir } from './runtime/install.mjs';

export const TURN_WORKER = fileURLToPath(new URL('./engines/turn-worker.py', import.meta.url));
const MAGIC = 'TRN1';
const LAST = 16000 * 8 * 2; // the model hears the last 8 seconds

/** The judge: `done(pcm)` resolves the chance (0 to 1) that the turn is over,
 *  or null when the model is not running. */
export function makeTurnJudge({ home = homedir(), platform = process.platform, env = process.env, python = pythonExe(home, platform), worker = TURN_WORKER, model = join(runtimeDir(home), 'smart-turn', 'smart-turn-v3.2-cpu.onnx'), spawn = nodeSpawn, exists = existsSync } = {}) {
  const off = { get active() { return false; }, done: () => Promise.resolve(null), close() {} };
  if (!exists(python) || !exists(worker) || !exists(model)) return off;
  let child;
  try {
    child = spawn(python, ['-I', worker, model], workerOptions({ home, env, platform }));
  } catch {
    return off;
  }
  let up = false;
  let dead = false;
  let buf = Buffer.alloc(0);
  const pending = [];
  const fail = () => {
    dead = true;
    up = false;
    while (pending.length) pending.shift()(null);
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
    }
    while (buf.length >= 4 && pending.length) {
      const p = buf.readFloatLE(0);
      buf = buf.subarray(4);
      pending.shift()(Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : null);
    }
  });
  return {
    get active() {
      return up && !dead;
    },
    done(pcm) {
      if (!up || dead || pending.length > 4) return Promise.resolve(null);
      const tail = pcm.length > LAST ? pcm.subarray(pcm.length - LAST) : pcm;
      const head = Buffer.alloc(4);
      head.writeUInt32LE(tail.length >> 1, 0);
      return new Promise(resolve => {
        pending.push(resolve);
        child.stdin.write(Buffer.concat([head, tail.subarray(0, tail.length & ~1)]));
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

/** Holds a turn that sounds unfinished. `offer(turn)` with each turn the gate
 *  ends; `tick(now, hearing)` with each frame. `release(turn)` gets each turn
 *  to deliver, a held one joined with what followed it. */
export class TurnHold {
  constructor({ judge, release, holdMs = 2500, threshold = 0.5, maxJoins = 3 }) {
    Object.assign(this, { judge, release, holdMs, threshold, maxJoins });
    this.held = null;
    this.quietSince = 0;
    this.chain = Promise.resolve();
    this.offered = 0; // turns offered and not yet released or held
  }

  offer(turn, now) {
    this.offered++;
    // One failed decision must not block the turns after it.
    this.chain = this.chain.then(() => this.decide(turn, now)).catch(() => {}).finally(() => this.offered--);
    return this.chain;
  }

  async decide(turn, now) {
    let t = turn;
    if (this.held) {
      const h = this.held;
      this.held = null;
      t = { ...turn, pcm: Buffer.concat([h.turn.pcm, turn.pcm]), afterReply: h.turn.afterReply, firstAfterReply: h.turn.firstAfterReply, overlap: h.turn.overlap || turn.overlap, barged: h.turn.barged || turn.barged, joins: (h.turn.joins ?? 0) + 1 };
    }
    // A turn the gate cut for length is unfinished by construction and is joined
    // with its continuation downstream (S5.7): it is never held here, and the
    // chain flags go through as the gate set them.
    const p = t.cut || (t.joins ?? 0) >= this.maxJoins ? null : await this.judge.done(t.pcm);
    if (p === null || p >= this.threshold) return this.release(t);
    this.held = { turn: t };
    this.quietSince = now;
  }

  tick(now, hearing) {
    if (!this.held) return;
    if (hearing) {
      this.quietSince = now;
      return;
    }
    if (now - this.quietSince >= this.holdMs) {
      const t = this.held.turn;
      this.held = null;
      this.release(t);
    }
  }

  // A turn is held, or offered and not yet decided: either way one is on its way.
  get holding() {
    return this.held !== null || this.offered > 0;
  }
}
