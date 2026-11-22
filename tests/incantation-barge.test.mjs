// Tests of the gate's echo-stack knobs (docs/spec/0001, S5.8; claim 9): with the
// canceller running, only a frame well over the voice level, left mostly alone
// by the canceller, and past the settle time counts toward a barge-in; without
// it the plain rule holds. Scripted tones and silence only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gate, KNOBS } from '../skills/incantation/scripts/gate.mjs';

const frame = amp => {
  const b = Buffer.alloc(960);
  for (let i = 0; i < 480; i++) b.writeInt16LE(i % 2 ? amp : -amp, i * 2);
  return b;
};
const QUIET = 1000;
const VOICE = 3163; // 10 dB over QUIET: voice, but under the 16 dB a canceller-era barge-in needs
const LOUD = 7000; // 16.9 dB over QUIET

function rig() {
  const gate = new Gate({ silenceMs: 300 });
  const r = { gate, t: 0, barges: 0, turns: [] };
  r.feed = (amp, n, raw = null, speech = true) => {
    for (let i = 0; i < n; i++) {
      for (const e of gate.frame(frame(amp), r.t, raw === null ? null : frame(raw), speech)) {
        if (e.type === 'barge') r.barges++;
        if (e.type === 'turn') r.turns.push(e);
      }
      r.t += 30;
    }
  };
  r.feed(QUIET, 34); // the room's level
  return r;
}

test('claim 9: the barge knobs are the trial\'s numbers', () => {
  assert.deepEqual([KNOBS.bargeGraceMs, KNOBS.bargeExtraDb, KNOBS.bargeRemovedDb, KNOBS.bargeWarmMs, KNOBS.echoHoldMs], [1500, 10, 9, 3000, 1500]);
});

test('claim 9: without the canceller, 360 ms of voice over a reply is still a barge-in, at once', () => {
  const r = rig();
  r.gate.playback(1, r.t);
  r.feed(VOICE, 12);
  assert.equal(r.barges, 1);
});

test('claim 9: with the canceller, voice that is not 10 dB over the voice level never cuts a reply', () => {
  const r = rig();
  r.gate.playback(1, r.t);
  r.feed(QUIET, 10);
  r.feed(VOICE, 150, VOICE);
  assert.equal(r.barges, 0);
});

test('claim 9: with the canceller, nothing counts in the grace time, or before 3 s of playback has been heard this session', () => {
  const r = rig();
  r.gate.playback(1, r.t);
  r.feed(LOUD, 70, LOUD); // 2.1 s of loud voice: over the grace, under the warm-up
  assert.equal(r.barges, 0, 'the canceller has not converged yet');
  r.feed(LOUD, 50, LOUD); // past 3 s, 12 loud frames are enough: 3 s is frame 100, the barge comes at frame 112
  assert.equal(r.barges, 1);
  // The warm-up is once per session: a second reply counts after its own grace only.
  r.feed(QUIET, 40);
  r.gate.playback(0, r.t);
  r.feed(QUIET, 20);
  r.gate.playback(1, r.t);
  r.feed(LOUD, 40, LOUD);
  assert.equal(r.barges, 1, 'inside the grace of the second reply: no new barge');
  r.feed(LOUD, 30, LOUD);
  assert.equal(r.barges, 2, 'after it: a barge');
});

test('claim 9: with the canceller, a frame it took 9 dB or more out of is echo and does not count', () => {
  const r = rig();
  r.gate.playback(1, r.t);
  r.feed(QUIET, 110);
  r.feed(LOUD, 40, LOUD * 3); // the mic gave 9.5 dB more than what is left: removed, so echo
  assert.equal(r.barges, 0);
  r.feed(LOUD, 40, LOUD * 2); // 6 dB removed: a person over the reply
  assert.equal(r.barges, 1);
});

test('claim 9: a frame the speech detector says is no voice is not voice, so a cough or typing opens no turn', () => {
  const r = rig();
  r.feed(LOUD, 20, null, false);
  r.feed(QUIET, 20);
  assert.equal(r.turns.length, 0);
  r.feed(LOUD, 20, null, true);
  r.feed(QUIET, 20);
  assert.equal(r.turns.length, 1);
});
