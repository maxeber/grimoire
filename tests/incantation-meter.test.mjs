// Tests of meter.mjs (docs/spec/incantation.md, T16): the mic's loudness as a
// row of digits, numbers only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METER, Meter, digit, levelsLine } from '../skills/incantation/scripts/meter.mjs';

test('a level is a digit from 0 to 8 on the scale from -60 to -15 dBFS, and silence is 0', () => {
  assert.equal(digit(-100), 0);
  assert.equal(digit(-60), 0);
  assert.equal(digit(NaN), 0);
  assert.equal(digit(undefined), 0);
  assert.equal(digit(-15), 8);
  assert.equal(digit(0), 8);
  assert.equal(digit(-37.5), 4);
  const seen = new Set();
  for (let db = -70; db <= 0; db += 0.5) seen.add(digit(db));
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('a bucket closes every 250 ms with its loudest frame, and the row keeps the last 24', () => {
  const m = new Meter();
  assert.equal(m.digits, '0'.repeat(24));
  let closed = 0;
  for (let t = 0; t < 1000; t += 30) if (m.add(t === 90 ? -15 : -100, t)) closed++;
  assert.equal(closed, 3, 'buckets close at 270, 540 and 810 ms');
  assert.equal(m.digits.length, METER.bars);
  assert.match(m.digits, /^0{21}800$/, 'the loud frame was in the first bucket');
  for (let t = 1000; t < 10_000; t += 30) m.add(-20, t);
  assert.equal(m.digits.length, METER.bars);
  assert.match(m.digits, /^[0-8]{24}$/);
});

test('frames that arrive in a burst with one time still fill a bucket every 250 ms (#638)', () => {
  // The mic hands the listener about 500 ms of audio at once, and every 30 ms
  // frame in it is stamped with the same clock reading. Each frame is still
  // 30 ms of sound, so 10 s of it is 40 buckets, not 20.
  const m = new Meter();
  let closed = 0;
  let level = -100;
  for (let chunk = 1; chunk <= 20; chunk++) {
    const t = chunk * 500;
    for (let i = 0; i < 500 / 30; i++) {
      level = level === -100 ? -15 : -100;
      if (m.add(level, t)) closed++;
    }
  }
  assert.ok(closed >= 38 && closed <= 40, `40 buckets in 10 s of bursts, got ${closed}`);
});

test('a real gap in the audio closes the buckets it spans as silence', () => {
  const m = new Meter();
  for (let t = 0; t < 1000; t += 30) m.add(-15, t);
  m.add(-15, 3000);
  assert.match(m.digits, /8{3,4}0{7,8}8?$/, 'the two silent seconds read as about eight zero buckets');
});

test('a muted mic reads 0 in every bucket', () => {
  const m = new Meter();
  for (let t = 0; t < 3000; t += 30) m.add(-15, t, true);
  assert.equal(m.digits, '0'.repeat(24));
});

test('the line holds the stamp, the word and the digits, and nothing else', () => {
  assert.equal(levelsLine(1700000000000, 'hearing', '000012345678000012345678'), '1700000000000 hearing 000012345678000012345678\n');
});
