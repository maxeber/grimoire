// The gate and the heard queue (docs/spec/incantation.md, S6, and its trial
// amendments), from #622's listener with the engine seam in place of the sound
// server. Pure: time comes in with each call, so a test drives it with scripted
// frames and scripted playback, and nothing here reads a clock, a file or the
// network. The mic is never closed to the session's own speech: only the person
// mutes it (T11), and a person who talks over a reply cuts it off (T8).

import { cleanText } from './lib.mjs';

// The listener's own numbers, in one place. Each is a starting point.
export const KNOBS = {
  frameMs: 30,
  floorMs: 1000, // how long the room's level is measured at start
  voiceDb: 6, // a frame is voice at this many dB over the floor (T17; was 10)
  minVoiceDbfs: -55, // ...and at least this loud in absolute terms, so a near-silent headset room (hiss, -70) cannot make a turn (T5; T17: was -45)
  minVoiceMs: 120, // a turn with less voice is dropped: under a clipped "yes", over a click (T17; T5 had 400, and before it 250)
  maxTurnMs: 30_000, // a longer turn is cut, and the rest goes on as its continuation: the two are joined again before they reach the session
  softTurnMs: 25_000, // ...at the first lull between words once a turn is this long, so a word is not split; maxTurnMs cuts wherever it is
  cutJoinMs: 60_000, // a cut turn waits at most this long for its continuation
  echoHoldMs: 1500, // a turn that starts this soon after a reply ends may be its echo (646 trial)
  workingMs: 10 * 60_000, // "working" shows this long after the session says it is acting, at most
  progressMs: 90_000, // working, with no line spoken and no turn heard this long: a progress line is due (L5)
  holdSayMs: 45_000, // a line waits at most this long for the person to finish talking, then fails
  holdPollMs: 50, // and looks this often whether they have
  tailMs: 300, // a reply counts as ended this long after its last playback ends (F2 may raise it, at most 1500)
  bargeMs: 360, // this much voice while a reply plays cuts the reply off
  // The next four apply only while the echo canceller runs (frame gets `raw`); without it the rule above is the whole rule (S5.8).
  bargeExtraDb: 10, // ...counting only frames this much louder than voice, so the reply's own echo does not cut it (646 trial)
  bargeGraceMs: 1500, // no barge-in counts this soon after a reply starts, while the canceller settles (646 trial)
  bargeRemovedDb: 9, // ...and only frames the canceller took less than this much out of: echo is mostly removed, a person talking over the reply is not (646 trial)
  bargeWarmMs: 3000, // no barge-in at all until this much has played this session: the canceller converges once (646 trial)
  joinMs: 2000, // a turn that stops mid-sentence waits this long for the next to join it
  maxJoins: 4, // at most this many turns join into one
  heartbeatMs: 2000, // the status file is touched this often
  commandPollMs: 250, // the band's click file is looked for this often (T16)
  commandFreshMs: 5000, // and a click older than this is dropped unread
  thinkingMs: 60_000, // "thinking" shows this long after a turn, at most
  idleWaitMs: 60_000, // an idle wait gives up after this long
  maxSayChars: 800, // one spoken reply, at most; a longer text is refused and goes to chat (T18)
  sayQueueMax: 3, // replies waiting behind the one playing; the next is refused as busy (T18)
  sayWaitMs: 90_000, // the say command waits this long for its answer: a generation can be slow (T18)
  queueMax: 20,
  ageMs: 5 * 60_000,
  perMinute: 4,
  idleMs: 30 * 60_000, // no heard turn this long ends the listener
  quietMs: 10 * 60_000, // a wait with nothing this long prints quiet
  noWaiterMs: 5 * 60_000, // no wait connected this long ends the listener
  relayWaitMs: 60_000, // no wait connected this long after ready: the relay is not running, and the listener ends
  maxText: 500,
  sttFailures: 3,
  sttTimeoutMs: 15_000,
  parentPollMs: 500,
  preRollFrames: 20, // about 0.6 s kept from before a voice is confirmed, so a first word is not lost (was 3)
  silentStartMs: 3000, // all-zero frames this long at start: the OS mic permission is off
  warmMs: 60_000,
  handshakeMs: 2000,
  feedOpenMs: 5000, // the playback feed must answer before the mic opens
};

export const SAMPLE_RATE = 16_000;
export const frameBytes = (knobs = KNOBS) => (SAMPLE_RATE * 2 * knobs.frameMs) / 1000;
const STOP_WORDS = new Set(['stop', 'thats all', 'wait']);

// Heard text as a waiter prints it: control, invisible and line-separator
// characters removed, inner quotes escaped, cut at 500 characters.
export function formatHeard(text, afterReply, max = KNOBS.maxText) {
  const clean = cleanText(text, max).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `Heard${afterReply ? ' (after reply)' : ''}: "${clean}"`;
}

// The lines of one heard turn, in order: the text split at word ends into pieces
// of at most `max` characters, so a long turn, a joined cut turn included, loses
// nothing to the cap. The first piece carries the after-reply mark. A sanity cap
// of 16 pieces keeps one turn from filling a delivery.
export function heardLines(text, afterReply, max = KNOBS.maxText) {
  let rest = cleanText(text, max * 16);
  const lines = [];
  do {
    let cut = rest.length;
    if (cut > max) {
      const space = rest.lastIndexOf(' ', max);
      cut = space > max / 2 ? space : max;
    }
    lines.push(formatHeard(rest.slice(0, cut), afterReply && !lines.length, max));
    rest = rest.slice(cut).trim();
  } while (rest);
  return lines;
}

// Does the whole turn say stop, that's all, or wait?
export function isStopWord(text) {
  return STOP_WORDS.has(String(text).toLowerCase().replace(/['’.,!?]/g, '').replace(/\s+/g, ' ').trim());
}

const levelDb = buf => {
  let sum = 0;
  const n = Math.floor(buf.length / 2);
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2);
    sum += s * s;
  }
  const rms = Math.sqrt(sum / Math.max(n, 1));
  return rms < 1 ? -100 : 20 * Math.log10(rms / 32768);
};

// Turns out of frames. Pure: time comes in with each call, so a test drives it
// with scripted frames and scripted playback, and nothing here reads a clock.
// Every frame is heard, a reply playing or not. While a reply plays and a turn
// holds enough voice, the gate says so once ({ type: 'barge' }), so the
// listener can cut the reply off.
export class Gate {
  constructor({ silenceMs = 1500, knobs = KNOBS, playing = 0, t = 0 } = {}) {
    this.k = knobs;
    this.silenceMs = silenceMs;
    this.count = playing;
    this.playStart = playing > 0 ? t : null;
    this.playEnd = null;
    this.playedMs = 0; // playback heard so far this session
    this.playId = playing > 0 ? 1 : 0;
    this.exemptPlay = 0;
    this.deliveredAt = -Infinity;
    this.floor = null;
    this.calib = [];
    this.roll = [];
    this.turn = null;
    this.chains = 0; // the last cut turn's chain number
    this.cutAt = null; // when the last turn was cut and its continuation may still come
    this.cutChain = null;
  }

  // Is a reply playing now?
  get playing() {
    return this.count > 0;
  }

  // The number of streams now playing, at time t.
  playback(count, t) {
    if (count > 0 && this.count === 0) {
      this.playStart = t;
      this.playId++;
    } else if (count === 0 && this.count > 0) {
      this.playEnd = t;
      this.playedMs += t - this.playStart;
    }
    this.count = count;
  }

  delivered(t) {
    this.deliveredAt = t;
  }

  // The listener's own short sounds that are not a reply (a spinner word): a turn
  // that begins while one plays, or soon after, is flagged `overlap` like one over
  // a reply. They do not mark a turn as after a reply.
  sound(on, t) {
    this.soundOn = on;
    if (!on) this.soundEnd = t;
  }

  // Is a turn open, with voice in it, now?
  get hearing() {
    return !!this.turn;
  }

  // One frame; returns the events it caused: { type: 'turn', ... } or { type: 'barge' }.
  // `raw`, when an echo canceller ran, is the frame as the mic gave it (`buf` is the
  // cleaned one); `speech`, when a speech detector ran, whether the frame holds a voice.
  frame(buf, t, raw = null, speech = true) {
    const k = this.k;
    const events = [];
    const level = levelDb(buf);
    const removed = raw ? levelDb(raw) - level : 0;
    this.level = level; // the last frame's loudness, for the meter (T16)
    if (this.floor === null) {
      this.calib.push(level);
      if (this.calib.length * k.frameMs >= k.floorMs) this.floor = this.calib.reduce((a, b) => a + b, 0) / this.calib.length;
      return events;
    }
    const voice = speech !== false && level >= this.floor + k.voiceDb && level >= k.minVoiceDbfs;
    if (!this.turn) {
      if (!voice) {
        this.floor = this.floor * 0.98 + level * 0.02;
        this.roll.push(buf);
        if (this.roll.length > k.preRollFrames) this.roll.shift();
        // No voice came back after a cut: the turn was not cut mid-speech, and its chain is over.
        if (this.cutAt !== null && t - this.cutAt > this.silenceMs) {
          events.push({ type: 'cut-over', chain: this.cutChain });
          this.cutAt = null;
        }
        return events;
      }
      // A turn is a reply to the session once any playback began after the last delivery.
      const afterReply = this.playStart !== null && this.playStart > this.deliveredAt;
      // A turn that begins over a reply, or soon after one ends, may be its echo.
      const overlap = this.count > 0 || (this.playEnd !== null && t - this.playEnd < k.echoHoldMs) || !!this.soundOn || (this.soundEnd != null && t - this.soundEnd < k.echoHoldMs);
      // The rest of a cut turn: it begins within the end-of-speech wait of the cut.
      const continued = this.cutAt !== null && t - this.cutAt <= this.silenceMs;
      this.turn = { frames: [...this.roll, buf], voice: 1, loud: 0, silent: 0, afterReply, overlap, playId: this.playId, barged: false, continued, chain: continued ? this.cutChain : undefined };
      this.cutAt = null;
      this.roll = [];
    } else {
      this.turn.frames.push(buf);
      if (voice) {
        this.turn.voice++;
        this.turn.silent = 0;
      } else {
        this.turn.silent++;
        this.floor = this.floor * 0.98 + level * 0.02;
      }
    }
    const turn = this.turn;
    // With the canceller running, only a frame well above the voice level, that the
    // canceller left mostly alone, and past the settle time, counts toward a barge-in.
    if (raw !== null) {
      if (this.count > 0 && t - this.playStart >= k.bargeGraceMs && this.playedMs + (t - this.playStart) >= k.bargeWarmMs && voice && removed < k.bargeRemovedDb && level >= this.floor + k.voiceDb + k.bargeExtraDb) turn.loud++;
    } else if (voice) turn.loud = turn.voice;
    if (this.count > 0 && !turn.barged && turn.loud * k.frameMs >= k.bargeMs) {
      turn.barged = true;
      events.push({ type: 'barge' });
    }
    const length = turn.frames.length * k.frameMs;
    const ended = turn.silent * k.frameMs >= this.silenceMs;
    // A long turn is cut: at the first lull between words once it is past softTurnMs, anywhere at maxTurnMs.
    const cut = !ended && (length >= k.maxTurnMs || (length >= k.softTurnMs && !voice));
    if (ended || cut) {
      this.turn = null;
      if (cut) {
        this.cutAt = t;
        this.cutChain = turn.chain ?? ++this.chains;
      }
      if (turn.voice * k.frameMs >= k.minVoiceMs) {
        const keep = turn.frames.length - Math.max(0, turn.silent - 10);
        let first = false;
        if (turn.afterReply && this.exemptPlay !== turn.playId) {
          first = true;
          this.exemptPlay = turn.playId;
        }
        events.push({
          type: 'turn',
          pcm: Buffer.concat(turn.frames.slice(0, keep)),
          afterReply: turn.afterReply,
          overlap: turn.overlap,
          firstAfterReply: first,
          barged: turn.barged,
          silenceMs: this.silenceMs,
          cut,
          continued: turn.continued,
          chain: cut ? this.cutChain : turn.chain,
        });
      }
    }
    return events;
  }
}

// The words of a turn, lowercased, with punctuation taken out.
const words = text =>
  String(text)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// What the speech-to-text model delivers out of silence or room noise (T5): a
// lone "you", a filler, a sound tag such as [BLANK_AUDIO], or nothing but
// punctuation. Such a turn is dropped before it is queued. A word a person
// could mean, yes and no and a stop word included, is never in this set.
const FRAGMENTS = new Set(['you', 'uh', 'um', 'uhm', 'er', 'erm', 'hmm', 'hm', 'mm', 'huh', 'ah', 'thank you', 'thanks for watching', 'thank you for watching']);
export function isFragment(text) {
  const t = String(text).trim();
  if (!t) return true;
  if (/^[\[(][^\])]{0,40}[\])]$/.test(t)) return true;
  const w = words(t);
  return w === '' || FRAGMENTS.has(w);
}

// The person's own mic words (T11): the whole turn says mute or unmute.
const MUTE = new Set(['mute', 'mute mic', 'mute the mic', 'mute microphone', 'mute the microphone']);
const UNMUTE = new Set(['unmute', 'un mute', 'unmute mic', 'unmute the mic', 'unmute microphone', 'unmute the microphone']);
export const isMuteWord = text => MUTE.has(words(text));
export const isUnmuteWord = text => UNMUTE.has(words(text));

// Does the text end a sentence? A turn that does not may be a turn cut at a breath.
export const isComplete = text => /[.?!…]["')\]]*$/.test(String(text).trim());

// At most this many parts of one cut turn are joined (about three minutes of talk).
const MAX_CUT_JOINS = 6;

// A turn cut at a breath is joined to the next one (T10). Pure: time comes in
// with each call. A turn that ends a sentence, a stop word and a reply to the
// session's own speech are never held, and any of them lets a held turn go first.
// A turn the gate cut for length (`cut`) is always held for its continuation
// (`continued`, same `chain`), whatever its punctuation, and the two are one turn
// when they go: nothing the person said is split off or lost. The held part goes
// when the gate says the chain is over (`flush`) or at cutJoinMs.
export class Joiner {
  constructor(knobs = KNOBS) {
    this.k = knobs;
    this.hold = null;
    this.deadline = null;
  }

  take() {
    const held = this.hold;
    this.hold = null;
    this.deadline = null;
    return held;
  }

  // Items to queue now, in order.
  offer(item, now) {
    const chained = !!item.continued && !!this.hold?.cut;
    if (!chained && !item.cut && (item.exempt || item.afterReply)) return [...(this.hold ? [this.take()] : []), item];
    const merged = this.hold ? { ...this.hold, text: `${this.hold.text} ${item.text}`, joins: this.hold.joins + 1, at: item.at, cut: !!item.cut, chain: item.chain ?? this.hold.chain } : { ...item, joins: 0, cut: !!item.cut };
    if (item.cut && merged.joins < MAX_CUT_JOINS) {
      this.hold = merged;
      this.deadline = now + this.k.cutJoinMs;
      return [];
    }
    if (isComplete(merged.text) || merged.joins >= this.k.maxJoins || merged.text.length >= this.k.maxText - 100) {
      this.hold = null;
      this.deadline = null;
      return [merged];
    }
    this.hold = merged;
    this.deadline = now + this.k.joinMs;
    return [];
  }

  // The held turn, once its wait is over.
  due(now) {
    return this.hold && now >= this.deadline ? [this.take()] : [];
  }

  // The held turn now, when it is for `chain` (any, when none is named): its
  // continuation will not come, or has failed.
  flush(now, chain) {
    return this.hold && (chain === undefined || this.hold.chain === chain) ? [this.take()] : [];
  }

  nextAt() {
    return this.hold ? this.deadline : null;
  }
}

// Heard text waiting for a waiter: at most 20 turns, none older than 5 minutes,
// deliveries held to 4 a minute except for the turns that are never held.
export class HeardQueue {
  constructor(knobs = KNOBS) {
    this.k = knobs;
    this.items = [];
    this.dropped = 0;
    this.deliveries = [];
  }

  push(item) {
    this.items.push(item);
    while (this.items.length > this.k.queueMax) {
      this.items.shift();
      this.dropped++;
    }
  }

  age(now) {
    const before = this.items.length;
    this.items = this.items.filter(i => now - i.at <= this.k.ageMs);
    this.dropped += before - this.items.length;
  }

  held(now) {
    this.deliveries = this.deliveries.filter(d => now - d < 60_000);
    return this.deliveries.length >= this.k.perMinute;
  }

  // Can a delivery go now? A turn that is never held lets the whole queue go.
  ready(now) {
    this.age(now);
    if (!this.items.length) return false;
    return this.items.some(i => i.exempt) || !this.held(now);
  }

  // When the cap lifts, for a waiter that is waiting on it; null when it is not the cap.
  nextAt(now) {
    this.age(now);
    if (!this.items.length || !this.held(now)) return null;
    return Math.min(...this.deliveries) + 60_000;
  }

  take(now) {
    const exempt = this.items.some(i => i.exempt);
    const turns = this.items;
    const dropped = this.dropped;
    this.items = [];
    this.dropped = 0;
    if (!exempt) this.deliveries.push(now);
    return { turns, dropped };
  }
}
