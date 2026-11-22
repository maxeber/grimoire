// Tests of gate.mjs (docs/spec/incantation.md, S6; claims 4, 7 and 9), from
// #622's listener tests with the sound server taken out. The turn logic is
// driven with scripted frames and scripted playback, tones and silence only,
// never recorded speech.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gate, HeardQueue, Joiner, KNOBS, formatHeard, heardLines, isComplete, isFragment, isMuteWord, isStopWord, isUnmuteWord } from '../skills/incantation/scripts/gate.mjs';


// Frames: 30 ms of a square wave, so its level is exactly the amplitude.
const frame = amp => {
  const b = Buffer.alloc(960);
  for (let i = 0; i < 480; i++) b.writeInt16LE(i % 2 ? amp : -amp, i * 2);
  return b;
};
const QUIET = 1000;
const VOICE = 3163; // 10.0006 dB over QUIET
const JUST_UNDER = 3162; // 9.9996 dB over QUIET
const OVER_6 = 1996; // 6.003 dB over QUIET: voice at the 6 dB the gate asks (T17)
const UNDER_6 = 1995; // 5.999 dB over QUIET

// A gate and a clock that feeds it: each call advances 30 ms.
function rig(options = {}) {
  const gate = new Gate({ silenceMs: 300, ...options });
  const r = { gate, t: options.t ?? 0, turns: [], barges: 0, ends: [] };
  r.feed = (amp, n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const e of gate.frame(frame(amp), r.t)) {
        if (e.type === 'turn') r.turns.push(e);
        else if (e.type === 'cut-over') r.ends.push(e);
        else r.barges++;
      }
      r.t += 30;
    }
  };
  r.calibrate = () => r.feed(QUIET, 34);
  r.play = n => gate.playback(n, r.t);
  r.skip = ms => (r.t += ms);
  return r;
}

// Claim 19: the turn logic.

test('T17: a frame 6 dB over the floor is voice and one just under is not; the person\'s own noise cancelling, not this gate, is the main filter', () => {
  const over = rig();
  over.calibrate();
  over.feed(OVER_6, 14);
  over.feed(QUIET, 12);
  assert.equal(over.turns.length, 1);
  const under = rig();
  under.calibrate();
  under.feed(UNDER_6, 10);
  under.feed(QUIET, 12);
  assert.equal(under.turns.length, 0);
  assert.equal(KNOBS.voiceDb, 6);
});

test('a turn ends after the end-of-speech wait, not before', () => {
  const r = rig({ silenceMs: 300 });
  r.calibrate();
  r.feed(VOICE, 14);
  r.feed(QUIET, 9);
  assert.equal(r.turns.length, 0);
  r.feed(QUIET, 1);
  assert.equal(r.turns.length, 1);
  assert.equal(r.turns[0].silenceMs, 300);
});

test('T17: a 0.12 s turn, a clipped "yes", is delivered and a 0.09 s click is dropped, after a reply or not', () => {
  for (const afterReply of [false, true]) {
    const r = rig();
    r.calibrate();
    if (afterReply) {
      r.play(1);
      r.skip(60);
      r.play(0);
    }
    r.feed(VOICE, 4); // 0.12 s
    r.feed(QUIET, 12);
    r.feed(VOICE, 3); // 0.09 s
    r.feed(QUIET, 12);
    assert.equal(r.turns.length, 1, afterReply ? 'after a reply' : 'with no reply before it');
  }
  assert.equal(KNOBS.minVoiceMs, 120);
});

test('T5 and T17: a headset that gates the room to zero: a room at -70 dBFS opens no turn, a quiet word at -50 dBFS does, and speech does', () => {
  const r = rig();
  r.feed(0, 34); // noise cancelling: the room reads as silence, so the relative floor is meaningless
  r.feed(10, 40); // -70 dBFS: a headset's own hiss
  r.feed(0, 12);
  assert.equal(r.turns.length, 0, 'a quiet room is not a turn');
  r.feed(33, 20); // -60 dBFS, under the absolute floor
  r.feed(0, 12);
  assert.equal(r.turns.length, 0, 'nor is a sound under the floor');
  r.feed(100, 8); // -50 dBFS: a quiet word, over a near-zero floor
  r.feed(0, 12);
  assert.equal(r.turns.length, 1, 'a quiet word is a turn: the canceller in front of the mic is trusted to keep the rest out');
  r.feed(VOICE, 15); // speech, -20 dBFS
  r.feed(0, 12);
  assert.equal(r.turns.length, 2, 'speech still is');
  assert.ok(KNOBS.minVoiceDbfs <= -45 && KNOBS.minVoiceDbfs >= -65);
  assert.equal(KNOBS.minVoiceDbfs, -55);
});

test('a turn is cut at 30 s and the rest goes on as the next turn, marked as its continuation', () => {
  const r = rig();
  r.calibrate();
  r.feed(VOICE, 1100); // 33 s of voice
  r.feed(QUIET, 12);
  assert.equal(r.turns.length, 2);
  assert.ok(r.turns[0].pcm.length >= 960 * 990 && r.turns[0].pcm.length <= 960 * 1000);
  assert.equal(r.turns[0].cut, true, 'the first part says it was cut');
  assert.equal(r.turns[1].cut, false);
  assert.equal(r.turns[1].continued, true, 'the rest says it continues a cut turn');
  assert.equal(r.turns[0].chain, r.turns[1].chain, 'and both name the same chain');
  assert.equal(r.turns[0].continued, false);
});

test('a turn nears its limit: the cut waits for a lull between words, not the middle of one, and the hard limit still holds', () => {
  const r = rig();
  r.calibrate();
  r.feed(VOICE, 840); // 25.2 s of voice, past the soft limit, with no lull yet
  assert.equal(r.turns.length, 0, 'a word is not cut for the soft limit alone');
  r.feed(QUIET, 1); // a lull between words
  assert.equal(r.turns.length, 1);
  assert.equal(r.turns[0].cut, true);
  r.feed(VOICE, 30);
  r.feed(QUIET, 12);
  assert.equal(r.turns[1].continued, true);
  // Without any lull the hard limit cuts at 30 s as before.
  const hard = rig();
  hard.calibrate();
  hard.feed(VOICE, 1000);
  assert.equal(hard.turns.length, 1);
});

test('a turn that begins after the cut by more than the end-of-speech wait is not a continuation, and the gate says the chain is over', () => {
  const r = rig({ silenceMs: 300 });
  r.calibrate();
  r.feed(VOICE, 1000); // cut at the hard limit
  r.feed(QUIET, 15);
  assert.deepEqual(r.ends.map(e => e.chain), [r.turns[0].chain], 'one end-of-chain event, once');
  r.feed(VOICE, 20);
  r.feed(QUIET, 12);
  assert.equal(r.turns[1].continued, false);
  assert.equal(r.turns[1].chain, undefined);
});

test('claim 6 (gate): a turn that begins while a reply plays, or within echoHoldMs of one, is flagged overlap; a later one is not', () => {
  const r = rig();
  r.calibrate();
  r.play(1);
  r.feed(VOICE, 10); // the person talks over a reply
  r.play(0);
  r.feed(QUIET, 12);
  assert.equal(r.turns[0].overlap, true);
  r.feed(QUIET, 5);
  r.feed(VOICE, 10); // within 1.5 s of the reply's end
  r.feed(QUIET, 12);
  assert.equal(r.turns[1].overlap, true);
  r.skip(KNOBS.echoHoldMs + 100);
  r.feed(VOICE, 10);
  r.feed(QUIET, 12);
  assert.equal(r.turns[2].overlap, false);
  assert.equal(KNOBS.echoHoldMs, 1500);
  assert.equal(KNOBS.preRollFrames, 20, 'about 0.6 s kept from before a voice is confirmed');
});

test('T11: the mic is never closed to the session\'s own speech: a turn is heard while a reply plays, and right after it', () => {
  const r = rig();
  r.calibrate();
  r.play(1);
  r.feed(VOICE, 20);
  r.feed(QUIET, 12);
  assert.equal(r.turns.length, 1, 'heard while a reply plays');
  r.play(0);
  r.feed(VOICE, 15); // no tail: it is heard at once
  r.feed(QUIET, 12);
  assert.equal(r.turns.length, 2, 'heard the moment it ends');
  assert.equal(rig({ playing: 1 }).gate.playing, true, 'one already playing at start is known');
});

test('T8: voice over a playing reply is a barge-in, once per turn, at 360 ms of voice; none when nothing plays', () => {
  const r = rig();
  r.calibrate();
  r.feed(VOICE, 30);
  r.feed(QUIET, 12);
  assert.equal(r.barges, 0, 'no reply playing: no barge');
  r.play(1);
  r.feed(VOICE, 11); // 330 ms
  assert.equal(r.barges, 0, 'a cough is not enough');
  r.feed(VOICE, 1); // 360 ms
  assert.equal(r.barges, 1);
  r.feed(VOICE, 20);
  assert.equal(r.barges, 1, 'once for the turn');
  r.feed(QUIET, 12);
  assert.equal(r.turns.at(-1).barged, true, 'the turn says it cut a reply off');
  r.feed(VOICE, 20);
  assert.equal(r.barges, 2, 'a new turn over the same reply cuts again');
});

test('a turn is marked after reply once any playback began after the last delivery, even a turn that began over the reply', () => {
  const r = rig();
  r.calibrate();
  r.feed(VOICE, 14);
  r.feed(QUIET, 12);
  assert.equal(r.turns[0].afterReply, false, 'no playback yet');
  r.gate.delivered(r.t);
  // A yes said after the delivery but before the say-back plays is not marked.
  r.feed(VOICE, 14);
  r.feed(QUIET, 12);
  assert.equal(r.turns[1].afterReply, false);
  r.gate.delivered(r.t);
  r.skip(30);
  r.play(1);
  r.skip(900);
  r.play(0);
  r.feed(VOICE, 14);
  r.feed(QUIET, 12);
  assert.equal(r.turns[2].afterReply, true);
  assert.equal(r.turns[2].firstAfterReply, true);
  r.feed(VOICE, 14);
  r.feed(QUIET, 12);
  assert.equal(r.turns[3].afterReply, true);
  assert.equal(r.turns[3].firstAfterReply, false, 'only the first after each playback');
  r.gate.delivered(r.t);
  r.feed(VOICE, 14);
  r.feed(QUIET, 12);
  assert.equal(r.turns[4].afterReply, false, 'a delivery clears the mark until the next playback');
  r.play(1);
  r.feed(VOICE, 14); // over the reply
  r.feed(QUIET, 12);
  assert.equal(r.turns[5].afterReply, true, 'a turn over a playing reply is a reply to it');
});

test('hearing is true while a turn is open', () => {
  const r = rig();
  r.calibrate();
  assert.equal(r.gate.hearing, false);
  r.feed(VOICE, 3);
  assert.equal(r.gate.hearing, true);
  r.feed(QUIET, 12);
  assert.equal(r.gate.hearing, false);
});

test('the queue keeps 20 turns, drops the oldest, and ages out a turn after 5 minutes', () => {
  const q = new HeardQueue();
  for (let i = 0; i < 25; i++) q.push({ text: `t${i}`, at: 0 });
  assert.equal(q.items.length, 20);
  assert.equal(q.items[0].text, 't5');
  assert.equal(q.dropped, 5);
  assert.equal(q.ready(KNOBS.ageMs + 1), false);
  assert.equal(q.dropped, 25);
});

test('deliveries are held to 4 a minute, except the turns that are never held', () => {
  const q = new HeardQueue();
  const put = (text, extra = {}) => q.push({ text, at: 0, ...extra });
  for (let i = 0; i < 4; i++) {
    put(`a${i}`);
    assert.equal(q.ready(i * 1000), true);
    q.take(i * 1000);
  }
  put('held');
  assert.equal(q.ready(10_000), false);
  assert.equal(q.nextAt(10_000), 60_000);
  assert.equal(q.ready(60_001), true);
  q.take(60_001);
  put('hold-again');
  put('stop', { exempt: isStopWord('Stop.') });
  assert.equal(q.ready(61_000), true);
  const taken = q.take(61_000);
  assert.deepEqual(taken.turns.map(t => t.text), ['hold-again', 'stop'], 'a never-held turn lets the whole queue go, in order');
  assert.equal(q.deliveries.length, 4, 'and does not count toward the cap');
  q.push({ text: 'first marked', at: 0, exempt: true });
  assert.equal(q.ready(62_000), true);
  q.take(62_000);
  q.push({ text: 'second marked', at: 0, exempt: false });
  q.deliveries = [61_000, 61_100, 61_200, 61_300];
  assert.equal(q.ready(62_100), false, 'a second marked turn after the same playback is held');
});

test('stop, that is all and wait, as a whole turn, are never held', () => {
  for (const yes of ['Stop.', 'stop', "That's all!", 'thats all', 'Wait', 'wait.']) assert.equal(isStopWord(yes), true, yes);
  for (const no of ['stop that now', 'wait for the build', 'please stop', '']) assert.equal(isStopWord(no), false, no);
});

test('T5: a turn whose whole text is a silence phrase or a filler is dropped, each one named; a word a person could mean is not', () => {
  for (const junk of ['you', 'You.', 'Thank you.', 'thank you', 'Thanks for watching.', 'Thank you for watching!', 'Uh', 'Um...', 'hmm', '[BLANK_AUDIO]', '(silence)', '...', '', '  ']) assert.equal(isFragment(junk), true, JSON.stringify(junk));
  for (const real of ['yes', 'No.', 'stop', 'wait', 'you should rename it', 'thank you, run the tests', 'okay', 'mute', 'Got it']) assert.equal(isFragment(real), false, real);
});

test('T11: mute and unmute, as a whole turn, are the person\'s mic words', () => {
  for (const w of ['Mute.', 'mute', 'Mute the mic!', 'mute microphone']) assert.equal(isMuteWord(w), true, w);
  for (const w of ['Unmute.', 'un-mute', 'Unmute the mic', 'unmute microphone']) assert.equal(isUnmuteWord(w), true, w);
  for (const w of ['mute the build', 'please mute', 'unmute the volume on the video', 'mute mute', '']) assert.equal(isMuteWord(w) || isUnmuteWord(w), false, w);
  assert.equal(isMuteWord('unmute'), false);
  assert.equal(isUnmuteWord('mute'), false);
});

test('a turn that was cut is held for its continuation and joined to it, whatever its punctuation; nothing is lost and nothing waits for ever', () => {
  const item = (text, extra = {}) => ({ text, at: 0, afterReply: false, exempt: false, ...extra });
  const j = new Joiner();
  // The first part ends a sentence, and is still held: its continuation is coming.
  assert.deepEqual(j.offer(item('That is the first part.', { cut: true, chain: 1 }), 0), []);
  assert.equal(j.nextAt(), KNOBS.cutJoinMs);
  const out = j.offer(item('and here is the rest.', { continued: true, chain: 1 }), 5000);
  assert.deepEqual(out.map(i => i.text), ['That is the first part. and here is the rest.']);
  assert.equal(j.nextAt(), null);
  // A reply to the session's speech is held too when it was cut, and its continuation joins it though it is marked afterReply.
  assert.deepEqual(j.offer(item('first', { cut: true, chain: 2, afterReply: true }), 0), []);
  const reply = j.offer(item('second.', { continued: true, chain: 2, afterReply: true }), 10);
  assert.deepEqual(reply.map(i => [i.text, i.afterReply]), [['first second.', true]]);
  // A chain of several cuts is one turn.
  j.offer(item('one', { cut: true, chain: 3 }), 0);
  assert.deepEqual(j.offer(item('two', { cut: true, continued: true, chain: 3 }), 10), []);
  assert.deepEqual(j.offer(item('three.', { continued: true, chain: 3 }), 20).map(i => i.text), ['one two three.']);
  // A continuation that never arrives: the held part goes when the chain is over, or at the bound.
  j.offer(item('lonely part', { cut: true, chain: 4 }), 0);
  assert.deepEqual(j.flush(5).map(i => i.text), ['lonely part'], 'the gate said the chain is over');
  assert.equal(j.flush(6).length, 0);
  j.offer(item('another', { cut: true, chain: 5 }), 0);
  assert.deepEqual(j.due(KNOBS.cutJoinMs - 1), []);
  assert.deepEqual(j.due(KNOBS.cutJoinMs).map(i => i.text), ['another']);
  // A flush for another chain leaves a held part alone.
  j.offer(item('held', { cut: true, chain: 6 }), 0);
  assert.deepEqual(j.flush(5, 7), []);
  assert.deepEqual(j.flush(5, 6).map(i => i.text), ['held']);
});

test('heard text longer than one line is split at word ends into several lines, none lost and none cut', () => {
  const words = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
  const lines = heardLines(words, true);
  assert.ok(lines.length >= 3);
  assert.match(lines[0], /^Heard \(after reply\): "/);
  for (const l of lines.slice(1)) assert.match(l, /^Heard: "/);
  const back = lines.map(l => l.replace(/^Heard(?: \(after reply\))?: "/, '').replace(/"$/, '')).join(' ');
  assert.equal(back, words, 'every word, in order');
  for (const l of lines) assert.ok(l.length <= KNOBS.maxText + 30);
  assert.deepEqual(heardLines('short', false), ['Heard: "short"']);
  assert.deepEqual(heardLines('say "hi"', false), ['Heard: "say \\"hi\\""']);
  // One unbroken run longer than a line is cut at the line, and the rest goes on as its own line.
  const run = heardLines('x'.repeat(1100), false);
  assert.equal(run.map(l => l.length - 'Heard: ""'.length).reduce((a, b) => a + b, 0), 1100);
});

test('T10: a turn that stops mid-sentence is held and joined to the next; one that ends a sentence goes at once', () => {
  assert.equal(isComplete('Run the tests.'), true);
  assert.equal(isComplete('Is it done?'), true);
  assert.equal(isComplete('and then rename the'), false);
  const j = new Joiner();
  const item = (text, extra = {}) => ({ text, at: 0, afterReply: false, exempt: false, ...extra });
  assert.deepEqual(j.offer(item('Run the tests.'), 0).map(i => i.text), ['Run the tests.']);
  assert.deepEqual(j.offer(item('and then rename the'), 0), []);
  assert.equal(j.nextAt(), KNOBS.joinMs);
  assert.deepEqual(j.due(KNOBS.joinMs - 1), []);
  const joined = j.offer(item('parse helper, please.'), 1000);
  assert.deepEqual(joined.map(i => i.text), ['and then rename the parse helper, please.']);
  assert.equal(j.nextAt(), null);
  // A held turn goes on its own when nothing joins it.
  j.offer(item('so I was thinking'), 0);
  assert.deepEqual(j.due(KNOBS.joinMs).map(i => i.text), ['so I was thinking']);
  // A stop word and a reply to the session's speech are never held, and let a held turn go first.
  j.offer(item('so I was thinking'), 0);
  assert.deepEqual(j.offer(item('stop', { exempt: true }), 10).map(i => i.text), ['so I was thinking', 'stop']);
  j.offer(item('so I was thinking'), 0);
  assert.deepEqual(j.offer(item('yes', { afterReply: true }), 10).map(i => i.text), ['so I was thinking', 'yes']);
  assert.deepEqual(j.offer(item('yes', { afterReply: true }), 20).map(i => i.text), ['yes'], 'a reply is not held for a sentence mark');
  // At most four turns join.
  let out = [];
  for (let i = 0; i < 6 && !out.length; i++) out = j.offer(item(`part ${i}`), i);
  assert.equal(out.length, 1);
  assert.equal(out[0].joins, KNOBS.maxJoins);
});

// Claim 21: what `wait` prints.

test('heard text is printed with hidden characters removed, quotes escaped and cut at 500', () => {
  assert.equal(formatHeard('hello', false), 'Heard: "hello"');
  assert.equal(formatHeard('hello', true), 'Heard (after reply): "hello"');
  assert.equal(formatHeard('a\u0007b‮c d​e\u0000f\ng', false), 'Heard: "abcdefg"');
  assert.equal(formatHeard('say "hi" \\ now', false), 'Heard: "say \\"hi\\" \\\\ now"');
  const long = formatHeard('x'.repeat(900), false);
  assert.equal(long, `Heard: "${'x'.repeat(500)}"`);
});
