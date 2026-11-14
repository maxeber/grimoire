// The mic's loudness as a short row of digits, for a band that draws bars
// (#208, T16). Numbers only: no audio, no text, and nothing from which words
// could be rebuilt. One digit, 0 to 8, is the loudest frame of a 250 ms bucket
// on a scale from -60 to -15 dBFS; the row holds the last 24 buckets, 6 s.

// frameMs is one audio frame's length (gate.mjs reads the mic in 30 ms frames);
// lagMs is how far the meter's own clock may stray from the wall clock before
// it takes the wall clock's word, as after a real gap in the audio.
export const METER = { bars: 24, bucketMs: 250, frameMs: 30, lagMs: 1000, loDb: -60, hiDb: -15, steps: 8 };

// A level in dBFS as a digit. Silence, a gap and NaN are 0.
export const digit = (db, m = METER) => {
  if (!(db > m.loDb)) return 0;
  return Math.min(m.steps, Math.round(((Math.min(db, m.hiDb) - m.loDb) / (m.hiDb - m.loDb)) * m.steps));
};

// The row the file holds: the stamp in epoch ms, the state word, the digits.
export const levelsLine = (ms, word, digits) => `${ms} ${word} ${digits}\n`;

export class Meter {
  constructor(m = METER) {
    this.m = m;
    this.digits = '0'.repeat(m.bars);
    this.peak = -Infinity;
    this.since = null;
    this.at = null;
  }

  // One frame's level, `t` the wall clock when it was read (ms, any clock).
  // The mic hands frames over in bursts that share one reading of the clock,
  // so each frame is timed by the meter's own clock instead: one frame length
  // after the last, or the wall clock once the two are more than lagMs apart (a
  // real gap, whose buckets read as silence). Buckets sit on a fixed 250 ms grid, so
  // every 250 ms of sound gives one digit. While muted a bucket reads 0, so a
  // muted mic draws flat. Returns true when a bucket closed.
  add(db, t, muted = false) {
    const m = this.m;
    this.at = this.at === null || Math.abs(t - this.at) > m.lagMs ? t : this.at + m.frameMs;
    if (this.since === null) this.since = this.at;
    let closed = false;
    while (this.at - this.since >= m.bucketMs) {
      this.digits = this.digits.slice(1) + (muted ? '0' : String(digit(this.peak, m)));
      this.peak = -Infinity;
      this.since += m.bucketMs;
      closed = true;
    }
    if (db > this.peak) this.peak = db;
    return closed;
  }
}
