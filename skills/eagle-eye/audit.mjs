#!/usr/bin/env node
// eagle-eye edge audit. Zero dependencies. Box file in, a ranking of its argued
// edges out: which `why` to reread first. Opt-in, and never run without a yes.
//
//   node audit.mjs <box.json> [--json <path>] [--dry-run]
//   node audit.mjs --probe
//
//   --probe    print `yes` when a key is in the environment and `no` when it is
//              not. Reads no box and opens no connection. The skill's offer to
//              run the audit hangs on this answer.
//   --dry-run  print the request body for the first argued edge, and send it
//              nowhere. On standard error, state how many requests a real run
//              sends and their rough size. Needs no key.
//   --json     also write the ranking to <path>. The box file is never written.
//
// Exit codes, each one tested in tests/audit.test.mjs:
//
//   0  a ranking, a probe answer, or a dry run
//   1  the box file cannot be read as a box
//   2  a usage error
//   3  no key in the environment. Nothing was sent.
//   4  the service failed or refused, or its answer did not have the pinned shape
//   5  the endpoint override is not a loopback address. Nothing was read or sent.
//
// **This is the one file under skills/ that names the service it calls.** The
// model is Jev, from TypeSafe: it takes a JSON `state` and typed questions and
// returns probabilities rather than text. A Noul is its yes/no question type,
// and the answer is the probability of yes. The request and response shapes
// below are pinned against its documented HTTP contract
// (docs.typesafe.ai/api), and anything else is refused rather than guessed at.
// The skill prose says "the model provider" and never this name; see
// docs/adr/0001-skills-own-their-vocabulary.md for why code may and prose may not.
//
// What it is for (issue #96): a ranking of a box's argued edges, by how well
// each `why` produces its relation, so the agent knows which to reread first.
// It calibrates against the box's own shuffled controls rather than a fixed
// cut-off. With MIN_CONTROLS or more, an argued edge that scores at or above
// the lowest control is flagged, including one above the highest. With fewer,
// the ranking prints as uncalibrated and flags nothing. A score is a place to
// reread first. It never moves a tier, and this file never writes a box.
//
// Environment:
//
//   TYPESAFE_API_KEY           the key. Read from here only, and never printed
//                              or written.
//   EAGLE_EYE_AUDIT_ENDPOINT   an endpoint override, for tests. Loopback only,
//                              because the URL it names receives the key and
//                              the box text.
//   EAGLE_EYE_AUDIT_CACHE      the cache directory. The default is a folder
//                              under the system temporary directory.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const KEY_VAR = 'TYPESAFE_API_KEY';
const ENDPOINT_VAR = 'EAGLE_EYE_AUDIT_ENDPOINT';
const CACHE_VAR = 'EAGLE_EYE_AUDIT_CACHE';

// Fewer shuffled controls than this and the box is not calibrated. The kept
// decisions box builds six and the example box three; the example is thin, and
// three points make a range nobody should flag against.
const MIN_CONTROLS = 4;

// The pattern the controls are built to show, and so the one the ranking and
// the flag read. A shuffled edge keeps a true `why` and points it at the wrong
// target, which is the definition of weakly connected. The other seven
// patterns have no control built for them, so they print unflagged.
const CALIBRATED = 'weakly connected';

const RETRY_DELAY_MS = 250;

// A rough size for the dry run's estimate, not a tokenizer. It is labelled as
// an estimate wherever it prints. Three, not the usual four, so the estimate
// errs high: that is the safe one to show before a yes.
const CHARS_PER_TOKEN = 3;

const EXIT = { ok: 0, box: 1, usage: 2, noKey: 3, service: 4, endpoint: 5 };

// The eight patterns from reference/writing-edges.md, each as one Noul. The
// model reads literally, so every boundary is written out in the criteria.
// State paths are backticked so the question can point into the state.
const PATTERNS = {
  wrong: {
    instructions: 'Does `edge.why` state something that is false, given `box.problem` and the two options?',
    criteria: {
      true: 'The why makes a factual claim that contradicts the stated context or is clearly untrue.',
      false: 'The why is true, or its truth cannot be decided from the state.',
    },
  },
  'weakly connected': {
    instructions:
      'Is `edge.why` a statement that may be true but does not actually produce the relation in `edge.claim` between `edge.source` and `edge.target`?',
    criteria: {
      true: 'Both options could be selected together without the stated problem (for a conflict), or the source works without the target (for a requirement). The two are independent, or the why describes a cost rather than a rule.',
      false: 'The why explains a mechanism that forces the conflict or the requirement.',
    },
  },
  'disconnected from context': {
    instructions: 'Does `edge.why` state a general truth that does not apply to the specific system described in `box.problem`?',
    criteria: {
      true: 'The why would hold for software in general, but nothing ties it to this system, or this system avoids it.',
      false: 'The why names something specific to this system, or clearly applies to it.',
    },
  },
  biased: {
    instructions:
      'Does `edge.why` exist because the author prefers one option, rather than because of a constraint between the two options?',
    criteria: {
      true: 'The why expresses a preference or taste. No mechanism links the two options.',
      false: 'The why describes a constraint that holds whatever the author prefers.',
    },
  },
  opinionated: {
    instructions: 'Does `edge.why` assert a value judgement as if it were a fact, instead of an observable consequence?',
    criteria: {
      true: 'The why says an option is right, wrong, better, cleaner or proper without stating what observably happens.',
      false: 'The why states an observable consequence.',
    },
  },
  disrespectful: {
    instructions: 'Does `edge.why` dismiss an option rather than describe its cost?',
    criteria: {
      true: 'The why belittles or waves away an option without naming a concrete cost.',
      false: 'The why names a concrete cost or mechanism, in neutral words.',
    },
  },
  insufficient: {
    instructions: 'Does `edge.why` need a second, unwritten reason before the relation in `edge.claim` holds?',
    criteria: {
      true: 'A step is missing. The why alone does not reach the conflict or requirement, and the missing step is not written.',
      false: 'The why reaches the conflict or requirement on its own.',
    },
  },
  vague: {
    instructions: 'Could `edge.why` reasonably mean two different things?',
    criteria: {
      true: 'A key term or reference in the why is ambiguous, and the two readings lead to different conclusions.',
      false: 'The why has one clear reading.',
    },
  },
};
const NAMES = Object.keys(PATTERNS);
const QUESTIONS = Object.fromEntries(NAMES.map(n => [n, { type: 'noul', ...PATTERNS[n] }]));

const CLAIMS = {
  conf: 'conflict: if both options are selected, the set of decisions does not hold',
  req: 'requirement: if the source option is selected and the target option is not, the set of decisions is incomplete',
};

function stop(code, message) {
  if (message) console.error(message);
  process.exit(code);
}

// --- arguments ---------------------------------------------------------------

const args = process.argv.slice(2);
const usage = () =>
  stop(EXIT.usage, 'usage: node audit.mjs <box.json> [--json <path>] [--dry-run]\n       node audit.mjs --probe');
const KNOWN = new Set(['--json', '--dry-run', '--probe']);
let boxPath;
let jsonPath;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--json') {
    jsonPath = args[++i];
    if (jsonPath === undefined || jsonPath.startsWith('--')) usage();
  } else if (a.startsWith('--')) {
    if (!KNOWN.has(a)) usage();
  } else if (boxPath === undefined) {
    boxPath = a;
  } else {
    usage();
  }
}
const probe = args.includes('--probe');
const dryRun = args.includes('--dry-run');

// --- the endpoint, before anything else is read ------------------------------
//
// Whatever URL the override names receives the bearer token and the box text.
// So it is checked first, before the key is read, before the probe answers, and
// before the box is opened. Only a loopback address literal passes. Not the
// name localhost: a name is resolved, and a hosts file can point it anywhere.
// A test fake needs nothing more, and anything more is a place the key could go.

function loopback(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === '::1') return url.href;
  if (isIP(host) === 4 && host.startsWith('127.')) return url.href;
  return null;
}

let endpoint = ENDPOINT;
const override = process.env[ENDPOINT_VAR];
if (override !== undefined && override !== '') {
  endpoint = loopback(override);
  if (!endpoint) {
    stop(
      EXIT.endpoint,
      `${ENDPOINT_VAR} names an address that is not loopback. Only an address in 127.0.0.0/8, or ::1, is accepted, because that URL would receive the key and the box text. Nothing was read or sent.`,
    );
  }
}

// --- the probe ---------------------------------------------------------------

const hasKey = () => typeof process.env[KEY_VAR] === 'string' && process.env[KEY_VAR].trim() !== '';

if (probe) {
  console.log(hasKey() ? 'yes' : 'no');
  process.exit(EXIT.ok);
}

if (!boxPath) usage();

// --- the box -----------------------------------------------------------------
//
// Read, never written. The renderer is the validator; this reads only the
// fields it sends, and refuses a file that lacks the shape to send them.

let box;
try {
  box = JSON.parse(readFileSync(boxPath, 'utf8'));
} catch (e) {
  stop(EXIT.box, `${boxPath}: cannot read it as JSON — ${e.message}`);
}
if (!box || typeof box !== 'object' || !Array.isArray(box.dims) || !box.rel || typeof box.rel !== 'object') {
  stop(EXIT.box, `${boxPath}: not a box file. It needs dims and rel. Run the renderer with --check to see what is wrong.`);
}

// Keyed by option id, which comes from the file. A map with no prototype, so
// an id such as `constructor` is a key like any other.
const options = new Map();
for (const dim of box.dims) {
  for (const o of dim.opts ?? []) {
    const entry = Object.hasOwn(box.rel, o.id) ? box.rel[o.id] : {};
    options.set(o.id, {
      row: dim.id,
      state: {
        option: o.label,
        row: dim.name,
        question: dim.question,
        why: entry.why,
        notes: entry.notes,
        src: o.src,
      },
      name: `${dim.name}: ${o.short ?? o.label}`,
    });
  }
}

const edges = [];
for (const [source, entry] of Object.entries(box.rel)) {
  for (const [target, kind, why, tier = 'argued'] of entry?.rel ?? []) {
    if (!options.has(source) || !options.has(target) || !Object.hasOwn(CLAIMS, kind)) {
      stop(EXIT.box, `${boxPath}: the edge ${source} ${kind} ${target} does not resolve. Run the renderer with --check.`);
    }
    edges.push({ source, target, kind, why, tier });
  }
}
const argued = edges.filter(e => e.tier === 'argued');

// Shuffled controls, written by nobody: keep a sourced or measured edge's
// source and `why`, and point it at another such edge's target in a third row.
// The `why` stays true and stays about this system. It no longer produces the
// relation. The pair must not already be an edge, in either direction.
function shuffle() {
  const real = new Set(edges.map(e => `${e.source}>${e.target}`));
  const good = edges.filter(e => e.tier !== 'argued');
  const out = [];
  good.forEach((e, i) => {
    for (let k = 1; k < good.length; k++) {
      const target = good[(i + k) % good.length].target;
      const rows = new Set([options.get(e.source).row, options.get(e.target).row, options.get(target).row]);
      if (rows.size === 3 && !real.has(`${e.source}>${target}`) && !real.has(`${target}>${e.source}`)) {
        out.push({ ...e, target, from: e.target });
        return;
      }
    }
  });
  return { controls: out, good: good.length };
}

function bodyFor(e) {
  return {
    model: MODEL,
    state: {
      box: { problem: box.problem },
      edge: {
        source: options.get(e.source).state,
        target: options.get(e.target).state,
        claim: CLAIMS[e.kind],
        why: e.why,
      },
    },
    questions: QUESTIONS,
  };
}

// Every request a real run would send: the argued edges, then the controls.
const { controls, good } = shuffle();

// The cache holds answers only: no state, no key, no usage. It is keyed by a
// hash of the endpoint and the body, so answers from a test fake never serve a
// real run, and a changed box asks again.
const cacheDir = process.env[CACHE_VAR] || join(tmpdir(), 'eagle-eye-audit');

// The dry run states the size of a real run, and never a price. The skill's
// offer to the user repeats this count: a price is the provider's to change,
// and a count stays true. Standard output keeps one parseable request body, so
// the size goes to standard error.
if (dryRun) {
  if (!argued.length) {
    console.log(`${boxPath}: no argued edge, so there is no request to show.`);
    process.exit(EXIT.ok);
  }
  const bodies = [...argued, ...controls].map(bodyFor);
  const waiting = bodies.filter(b => !cached(cacheFileFor(b)));
  const done = bodies.length - waiting.length;
  const tokens = waiting.reduce((n, b) => n + Math.ceil(JSON.stringify(b).length / CHARS_PER_TOKEN), 0);
  console.log(JSON.stringify(bodies[0], null, 2));
  console.error(
    waiting.length
      ? `A real run sends ${waiting.length} requests: ${argued.length} argued edges and ${controls.length} controls, ${done ? `${done} already cached` : 'none cached'}. ` +
          `That is about ${tokens.toLocaleString('en-US')} input tokens, estimated at ${CHARS_PER_TOKEN} characters a token. Nothing was sent.`
      : `A real run sends nothing: all ${bodies.length} requests are already cached. Nothing was sent.`,
  );
  process.exit(EXIT.ok);
}

if (!argued.length) {
  console.log(`${box.title ?? boxPath}\nNo argued edge. There is nothing to audit, and nothing was sent.`);
  process.exit(EXIT.ok);
}

// --- the key -----------------------------------------------------------------

// The absent-key message doubles as the setup guide. The skill prose may not
// name the provider or this variable, so this is the one place a user can
// learn them. The agent passes it on; the user sets the key. An agent that
// took the key in chat would put it in a transcript, so the guide says not to.
const SETUP = [
  `No ${KEY_VAR} in the environment. Nothing was sent.`,
  '',
  'The audit is optional. It sends a box\'s text to TypeSafe, the provider of the Jev model.',
  'To turn it on, get a key from TypeSafe (docs.typesafe.ai) and set it yourself, once,',
  'where every new session reads it:',
  '',
  `  - your agent's settings, if it can set environment variables for every session`,
  `  - your shell profile: setx ${KEY_VAR} <key> on Windows, or an export line in ~/.zshrc or ~/.bashrc`,
  '',
  `A key in a project .env is not read. Start a new session after you set ${KEY_VAR}.`,
  'Never paste the key into a chat. The agent does not need to see it.',
].join('\n');

if (!hasKey()) stop(EXIT.noKey, SETUP);
const key = process.env[KEY_VAR].trim();

// --- the service -------------------------------------------------------------

// The pinned response shape: `answers`, holding every pattern asked, each a
// Noul with a probability. Returns the scores or a reason it is refused.
function scoresFrom(json) {
  if (!json || typeof json !== 'object' || !json.answers || typeof json.answers !== 'object') {
    return { refused: 'the response has no answers field' };
  }
  const scores = {};
  for (const n of NAMES) {
    const a = json.answers[n];
    if (!a || a.type !== 'noul' || typeof a.noul !== 'number' || !(a.noul >= 0 && a.noul <= 1)) {
      return { refused: `the answer for "${n}" is not a Noul with a probability between 0 and 1` };
    }
    scores[n] = a.noul;
  }
  return { scores };
}

function cacheFileFor(body) {
  const hash = createHash('sha256').update(`${endpoint}\n${JSON.stringify(body)}`).digest('hex').slice(0, 32);
  return join(cacheDir, `${hash}.json`);
}

function cached(file) {
  try {
    const { scores } = scoresFrom(JSON.parse(readFileSync(file, 'utf8')));
    return scores;
  } catch {
    return undefined;
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// One request. One retry on a network error or a 5xx, and never on anything
// else: a 4xx is an answer about the request, and asking again changes nothing.
// An error message never carries the request, so the header cannot leak here.
async function post(body) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (attempt < 2) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      return { refused: `the service could not be reached twice (${e.cause?.code ?? e.message})` };
    }
    // A body left unread holds its socket open, and process.exit with a socket
    // open crashed node on Windows (0xC0000409) in the test for a second 5xx.
    if (!res.ok) await res.arrayBuffer().catch(() => {});
    if (res.status >= 500 && attempt < 2) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    if (!res.ok) {
      const hint = res.status === 401 ? ' The key was refused.' : '';
      return { refused: `the service answered HTTP ${res.status}${attempt > 1 ? ' twice' : ''}.${hint}` };
    }
    let json;
    try {
      json = await res.json();
    } catch {
      return { refused: 'the response is not JSON' };
    }
    return scoresFrom(json);
  }
}

async function score(e) {
  const body = bodyFor(e);
  const file = cacheFileFor(body);
  const hit = cached(file);
  if (hit) return hit;
  const { scores, refused } = await post(body);
  if (refused) throw new Refused(refused);
  const answers = Object.fromEntries(NAMES.map(n => [n, { type: 'noul', noul: scores[n] }]));
  // Owner-only where the platform honours a mode. The default folder sits in a
  // directory other local accounts may share; SECURITY.md states what is left.
  // A cache that cannot be written costs a request next time, nothing more. The
  // request has already gone out, so a throw here would lose a paid answer and
  // exit 1, which means an unreadable box.
  try {
    mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify({ answers }));
  } catch {
    // a miss next time
  }
  return scores;
}

// Thrown once a request has gone out. From there on the process ends by
// running out of work rather than by process.exit, so no connection is cut
// from under node.
class Refused extends Error {}

const ranked = [];
const scoredControls = [];
try {
  for (const e of argued) ranked.push({ ...e, scores: await score(e) });
  for (const c of controls) scoredControls.push({ ...c, scores: await score(c) });
  report();
} catch (e) {
  if (!(e instanceof Refused)) throw e;
  console.error(`Refused: ${e.message}. Nothing was guessed, and no ranking is printed.`);
  process.exitCode = EXIT.service;
}

// --- the ranking -------------------------------------------------------------

function report() {
  const calibrated = scoredControls.length >= MIN_CONTROLS;
  const controlScores = scoredControls.map(c => c.scores[CALIBRATED]);
  const threshold = calibrated ? Math.min(...controlScores) : null;
  const top = scores => NAMES.reduce((best, n) => (scores[n] > scores[best] ? n : best), NAMES[0]);
  for (const e of ranked) {
    e.flagged = calibrated && e.scores[CALIBRATED] >= threshold;
    e.top = top(e.scores);
  }
  ranked.sort((a, b) => b.scores[CALIBRATED] - a.scores[CALIBRATED]);

  // Names, never ids, the way the renderer prints them: the agent reads this
  // out, and an id names nothing to the user. The --json sidecar keeps ids.
  const f2 = p => p.toFixed(2);
  const verb = { conf: 'rules out', req: 'requires' };
  const lines = [box.title ?? boxPath, `${ranked.length} argued edges, ranked by the ${CALIBRATED} score.`];
  if (calibrated) {
    lines.push(
      `Calibrated: ${scoredControls.length} shuffled controls score ${f2(threshold)} to ${f2(Math.max(...controlScores))} on ${CALIBRATED}. An edge at ${f2(threshold)} or above is flagged. The floor is ${MIN_CONTROLS} controls.`,
    );
  } else {
    lines.push(
      `Uncalibrated: ${scoredControls.length} shuffled controls from ${good} sourced or measured edges, and the floor is ${MIN_CONTROLS}. No edge is flagged.`,
    );
  }
  lines.push('A flag says which edge to reread first. It is not a verdict, and no score changes a tier.', '');
  for (const e of ranked) {
    lines.push(
      `${e.flagged ? 'FLAG' : '    '}  ${options.get(e.source).name} ${verb[e.kind]} ${options.get(e.target).name}`,
      `      ${NAMES.map(n => `${n} ${f2(e.scores[n])}`).join(', ')}`,
      `      top: ${e.top} ${f2(e.scores[e.top])}`,
      `      why: ${e.why}`,
      '',
    );
  }
  console.log(lines.join('\n'));

  if (jsonPath) {
    const edge = e => ({ source: e.source, kind: e.kind, target: e.target, why: e.why, scores: e.scores });
    const out = {
      box: boxPath,
      pattern: CALIBRATED,
      calibrated,
      floor: MIN_CONTROLS,
      threshold,
      edges: ranked.map(e => ({ ...edge(e), top: e.top, flagged: e.flagged })),
      controls: scoredControls.map(c => ({ ...edge(c), shuffledFrom: c.from })),
    };
    writeFileSync(jsonPath, `${JSON.stringify(out, null, 2)}\n`);
  }
}
