#!/usr/bin/env node
// eagle-eye edge audit. Zero dependencies. Box file in, a ranking of its argued
// edges out: which `why` to reread first. Opt-in, and never run without a yes.
//
//   node audit.mjs <box.json> [--sel <restore code>] [--json <path>] [--dry-run]
//   node audit.mjs --probe
//   node audit.mjs --provider
//
//   --sel     audit one configuration ("eagle-eye: opt-id, opt-id"), read the
//              way the renderer's --sel reads it. Only the edges that make it
//              fail are active: its conflicts and its requirements not met.
//              The argued ones are scored against the full run's controls and
//              flagged by the full run's rule. A sourced or measured one is
//              listed and never sent. A set that holds sends nothing.
//   --probe    print `yes` when a usable key is in the environment and `no`
//              when none is. A key in the wrong variable is not usable. Reads no box and opens no connection. The skill's offer to
//              run the audit hangs on this answer, so it stays one word.
//   --provider print the provider a run would use, or `none`. Reads no box and
//              opens no connection.
//   --dry-run  print the request body for the first argued edge, and send it
//              nowhere. On standard error, state how many requests a real run
//              sends, to which provider, that each is charged to the key, and
//              their rough size. Needs no key.
//   --json     also write the ranking to <path>. The box file is never written.
//
// Exit codes, each one tested in tests/audit.test.mjs:
//
//   0  a ranking, a probe answer, a dry run, or a --sel set with nothing to send
//   1  the box file cannot be read as a box
//   2  a usage error, including an unknown option id in --sel
//   3  no usable key in the environment. Nothing was sent.
//   4  the service failed or refused, its answer did not have the pinned shape,
//      or two answers in one run named different models
//   5  the endpoint override is not a loopback address. Nothing was read or sent.
//
// **This is the one file under skills/ that names the services it calls.** The
// model is Jev, from TypeSafe: it takes a JSON `state` and typed questions and
// returns probabilities rather than text. A Noul is its yes/no question type,
// and the answer is the probability of yes. The request and response shapes
// below are pinned against its documented HTTP contract
// (docs.typesafe.ai/api), and anything else is refused rather than guessed at.
// The skill prose says "the model provider" and never these names; see
// docs/adr/0001-skills-own-their-vocabulary.md for why code may and prose may not.
//
// **Two routes to one model** (issue #117). OpenRouter also serves Jev, on an
// endpoint it labels alpha, with the same request and answer shapes. The key
// picks the route: TYPESAFE_API_KEY first, because that route has the
// documented contract and no middleman, then OPENROUTER_API_KEY. A run never
// falls back from one route to the other: that would send one box to two
// companies, and the two name the same model differently, so #104 would stop
// it anyway. The OpenRouter request pins TypeSafe as its only upstream.
//
// An OpenRouter key in TYPESAFE_API_KEY is refused before anything is sent. One
// was, on 2026-09-23: the service refused it, but the key had already reached
// the wrong company as a bearer token. The probe says `no` for it.
//
// What it is for (issue #96): a ranking of a box's argued edges, by how well
// each `why` produces its relation, so the agent knows which to reread first.
// It calibrates against the box's own shuffled controls rather than a fixed
// cut-off. With MIN_CONTROLS or more, an argued edge that scores at or above
// the lowest control is flagged, including one above the highest. With fewer,
// the ranking prints as uncalibrated and flags nothing. A score is a place to
// reread first. It never moves a tier, and this file never writes a box.
//
// **Every request is charged to the user's key** (issue #106). So the dry run
// says so before a yes, and a real run ends by saying how many it sent and
// which model version answered. Nothing is cached: each run asks for every
// edge and every control anew, and a --sel run sends every control beside its
// active argued edges (issue #99 assumed a cache here). Whether a cache should
// come back is issue #107.
//
// **One run, one model** (issue #104). `jev-latest` is an alias, and every
// answer must name the model that gave it. The report names that model. The
// alias can move mid-run, and then the calibration would compare one model's
// edges with another's controls. So the first answer that names a second
// model stops the run with exit 4, and no ranking prints.
//
// OpenRouter's answer also carries `usage.cost`. It is read nowhere: its unit
// is not documented for this endpoint, and only one route returns it.
//
// Environment:
//
//   TYPESAFE_API_KEY           a TypeSafe key. Never printed or written.
//   OPENROUTER_API_KEY         an OpenRouter key, used when TYPESAFE_API_KEY is
//                              not set. Never printed or written.
//   EAGLE_EYE_AUDIT_ENDPOINT   an endpoint override, for tests. Loopback only,
//                              because the URL it names receives the key and
//                              the box text.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The renderer's analysis module, for --sel. One parser and one analysis, so
// the audit's active edges are the renderer's conflicts and unmet requirements.
const EagleEye = createRequire(import.meta.url)(resolve(dirname(fileURLToPath(import.meta.url)), 'lib/eagle-eye.js'));

// The two routes, in the order a key picks them. `extra` joins every request
// body. OpenRouter names its upstreams by slug, and `typesafe` is TypeSafe's in
// its public provider list (openrouter.ai/api/v1/providers).
const PROVIDERS = [
  {
    name: 'TypeSafe',
    keyVar: 'TYPESAFE_API_KEY',
    endpoint: 'https://api.typesafe.ai/v1/systemone',
    model: 'jev-latest',
    extra: {},
  },
  {
    name: 'OpenRouter',
    keyVar: 'OPENROUTER_API_KEY',
    endpoint: 'https://openrouter.ai/api/alpha/decisions',
    model: '~typesafe/jev-latest',
    extra: { provider: { only: ['typesafe'], allow_fallbacks: false } },
    alpha: true,
    // The company the box text reaches after this one. A user agrees to send
    // it to both, so the dry run names both.
    upstream: 'TypeSafe',
  },
];
const [TYPESAFE, OPENROUTER] = PROVIDERS;
const ENDPOINT_VAR = 'EAGLE_EYE_AUDIT_ENDPOINT';

// Every OpenRouter key begins with this. TypeSafe documents no shape for its
// keys, so a check can only say what a TypeSafe key is not.
const OPENROUTER_PREFIX = 'sk-or-v1-';

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
  stop(
    EXIT.usage,
    'usage: node audit.mjs <box.json> [--sel "eagle-eye: ids"] [--json <path>] [--dry-run]\n       node audit.mjs --probe\n       node audit.mjs --provider',
  );
const KNOWN = new Set(['--json', '--dry-run', '--probe', '--provider', '--sel']);
let boxPath;
let jsonPath;
let selCode;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--json') {
    jsonPath = args[++i];
    if (jsonPath === undefined || jsonPath.startsWith('--')) usage();
  } else if (a === '--sel') {
    // A restore code never begins with --, so a following flag is a missing
    // value, as it is in the renderer.
    // A second --sel is refused, in both scripts: the renderer would read the
    // first and this loop the last, so each would name a different set.
    if (selCode !== undefined) usage();
    selCode = args[++i];
    if (selCode === undefined || selCode.startsWith('--')) usage();
  } else if (a.startsWith('--')) {
    if (!KNOWN.has(a)) usage();
  } else if (boxPath === undefined) {
    boxPath = a;
  } else {
    usage();
  }
}
const probe = args.includes('--probe');
const which = args.includes('--provider');
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

let override = process.env[ENDPOINT_VAR];
if (override !== undefined && override !== '') {
  override = loopback(override);
  if (!override) {
    stop(
      EXIT.endpoint,
      `${ENDPOINT_VAR} names an address that is not loopback. Only an address in 127.0.0.0/8, or ::1, is accepted, because that URL would receive the key and the box text. Nothing was read or sent.`,
    );
  }
}

// --- the provider, from the key -----------------------------------------------

const keyIn = p => (typeof process.env[p.keyVar] === 'string' ? process.env[p.keyVar].trim() : '');

// An OpenRouter key where the TypeSafe key belongs. It wins over everything,
// even a correct OPENROUTER_API_KEY beside it: the user has made a mistake,
// and a run that quietly worked around it would leave the mistake in place.
const misplaced = keyIn(TYPESAFE).startsWith(OPENROUTER_PREFIX);

// The route this run uses, or undefined when no usable key is set.
const provider = misplaced ? undefined : PROVIDERS.find(p => keyIn(p) !== '');

if (probe) {
  console.log(provider ? 'yes' : 'no');
  process.exit(EXIT.ok);
}
if (which) {
  console.log(provider ? provider.name : 'none');
  process.exit(EXIT.ok);
}

if (!boxPath) usage();

// Before the box is read and before the dry run: a dry run would name a
// provider this key can never reach.
if (misplaced) {
  stop(
    EXIT.noKey,
    `${TYPESAFE.keyVar} holds an OpenRouter key: it starts with ${OPENROUTER_PREFIX}. Nothing was sent.\n\n` +
      `Set that key as ${OPENROUTER.keyVar} instead, and unset ${TYPESAFE.keyVar}. ` +
      'Then start a new session. Never paste the key into a chat.',
  );
}

// The route named in every line a user reads. With no key, the one a first key
// would most likely pick: the dry run needs no key, and still names a recipient.
const route = provider ?? TYPESAFE;
const endpoint = override || route.endpoint;

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
// The edges this run scores. A full run scores every argued edge. Under --sel,
// only the active ones: the conflicts and the requirements not met that the
// library's analysis finds for that set, which are the edges the renderer's
// --sel prints. A sourced or measured active edge is listed and never scored:
// the controls are built from those edges, so scoring one against them is
// circular, and the fix for a doubtful one is its source, not its wording.
//
// One difference, and it is display against evidence. A conflict drawn from
// both ends prints once in the renderer, whichever end it met first. Here each
// direction is its own edge with its own `why` and tier, so both count: an
// argued mirror of a sourced conflict is scored, not hidden behind it. The
// selected set, and so which pairs conflict, is still the library's.
let argued = edges.filter(e => e.tier === 'argued');
let unscored = [];
let holds;
if (selCode !== undefined) {
  try {
    EagleEye.index(box);
  } catch {
    stop(EXIT.box, `${boxPath}: a row has no chosen option. Run the renderer with --check.`);
  }
  let parsed;
  try {
    parsed = EagleEye.parseSel(box, selCode);
  } catch (e) {
    stop(EXIT.usage, `--sel: ${e.message}`);
  }
  const { selected, unmet } = EagleEye.analyse(box, parsed.sel, parsed.touched);
  const conflicts = edges.filter(
    e => e.kind === 'conf' && selected.has(e.source) && selected.has(e.target) && options.get(e.source).row !== options.get(e.target).row,
  );
  const active = [...conflicts, ...unmet.map(e => ({ source: e.from, target: e.to, kind: e.kind, why: e.why, tier: e.tier }))];
  argued = active.filter(e => e.tier === 'argued');
  unscored = active.filter(e => e.tier !== 'argued');
  holds = !active.length;
}

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
    model: route.model,
    ...route.extra,
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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const requests = n => plural(n, 'request');

// Names, never ids, the way the renderer prints them: the agent reads this
// out, and an id names nothing to the user. The --json sidecar keeps ids.
const verb = { conf: 'rules out', req: 'requires' };
const edgeName = e => `${options.get(e.source).name} ${verb[e.kind]} ${options.get(e.target).name}`;

// The --sel lines that come before any ranking: which set, and whether it holds.
function selHeader() {
  if (holds) return [`Configuration: ${selCode}`, 'The set holds. There is nothing to audit, and nothing was sent.'];
  return [
    `Configuration: ${selCode}`,
    `The set does not hold on ${plural(argued.length + unscored.length, 'active edge')}: ${argued.length} argued, ${unscored.length} sourced or measured.`,
  ];
}

// An active sourced or measured edge, listed so the reader still meets it.
const unscoredLines = () =>
  unscored.flatMap(e => [`not scored: ${e.tier} — recheck its src`, `      ${edgeName(e)}`, `      why: ${e.why}`, '']);

// The --json sidecar. Under --sel it also carries the code, whether the set
// holds, and each active edge's tier and whether it was scored. A full run's
// shape is what it was. `model` is absent when nothing was sent.
function writeReport({ model, calibrated, threshold, ranked, controls }) {
  const sel = selCode !== undefined;
  const edge = e => ({
    source: e.source,
    kind: e.kind,
    target: e.target,
    why: e.why,
    ...(sel ? { tier: e.tier } : {}),
    ...(e.scores ? { scores: e.scores } : {}),
  });
  const out = {
    box: boxPath,
    ...(model !== undefined ? { model } : {}),
    ...(sel ? { sel: selCode, holds } : {}),
    pattern: CALIBRATED,
    calibrated,
    floor: MIN_CONTROLS,
    threshold,
    edges: [
      ...ranked.map(e => ({ ...edge(e), top: e.top, flagged: e.flagged, ...(sel ? { scored: true } : {}) })),
      ...unscored.map(e => ({ ...edge(e), scored: false })),
    ],
    controls: controls.map(c => ({ ...edge(c), shuffledFrom: c.from })),
  };
  writeFileSync(jsonPath, `${JSON.stringify(out, null, 2)}\n`);
}

// A --sel set with no argued active edge has nothing to send: it holds, or it
// fails only on sourced or measured edges. Say which, before the dry run and
// before the key, and send nothing. Not even the controls: with no edge to
// compare they calibrate nothing.
if (selCode !== undefined && !argued.length) {
  const lines = [box.title ?? boxPath, ...selHeader()];
  if (!holds) lines.push('', ...unscoredLines(), 'No active edge is argued, so nothing was sent.');
  console.log(lines.join('\n'));
  if (jsonPath && !dryRun) writeReport({ calibrated: false, threshold: null, ranked: [], controls: [] });
  process.exit(EXIT.ok);
}

// The dry run states the size of a real run and who pays for it, and never a
// price. The skill's offer to the user repeats this line: a price is the
// provider's to change, and a count stays true. Standard output keeps one
// parseable request body, so the size goes to standard error.
if (dryRun) {
  if (!argued.length) {
    console.log(`${boxPath}: no argued edge, so there is no request to show.`);
    process.exit(EXIT.ok);
  }
  const bodies = [...argued, ...controls].map(bodyFor);
  const tokens = bodies.reduce((n, b) => n + Math.ceil(JSON.stringify(b).length / CHARS_PER_TOKEN), 0);
  console.log(JSON.stringify(bodies[0], null, 2));
  console.error(
    `A real run sends ${requests(bodies.length)} to ${route.name}` +
      (route.upstream ? `, which passes them on to ${route.upstream}` : '') +
      `: ${argued.length} argued edges and ${controls.length} controls. ` +
      `Each request is charged to your key, at ${route.name}'s price. ` +
      (route.alpha ? `${route.name} serves this model on an endpoint it labels alpha, so its shape can change. ` : '') +
      `That is about ${tokens.toLocaleString('en-US')} input tokens, estimated at ${CHARS_PER_TOKEN} characters a token. Nothing was sent.`,
  );
  process.exit(EXIT.ok);
}

if (!argued.length) {
  console.log(`${box.title ?? boxPath}\nNo argued edge. There is nothing to audit, and nothing was sent.`);
  process.exit(EXIT.ok);
}

// --- the key -----------------------------------------------------------------

// The absent-key message doubles as the setup guide. The skill prose may not
// name a provider or a variable, so this is the one place a user can learn
// them. The agent passes it on; the user sets the key. An agent that took the
// key in chat would put it in a transcript, so the guide says not to.
const SETUP = [
  `No ${TYPESAFE.keyVar} or ${OPENROUTER.keyVar} in the environment. Nothing was sent.`,
  '',
  'The audit is optional. It sends a box\'s text to a provider of the Jev model, which',
  'scores each argued edge. Each request it sends is charged to your key, at that provider\'s price.',
  'Set one of two keys:',
  '',
  `  - ${TYPESAFE.keyVar}: a key from TypeSafe, which makes Jev (docs.typesafe.ai).`,
  `  - ${OPENROUTER.keyVar}: a key from OpenRouter, which passes requests on to TypeSafe.`,
  '    OpenRouter serves Jev on an endpoint it labels alpha, so its shape can change.',
  '    OpenRouter keeps no request text unless your account opts in to logging, or to',
  '    letting OpenRouter use your inputs and outputs.',
  '',
  `When both are set, ${TYPESAFE.keyVar} is used. Set the key yourself, once, where every new session reads it:`,
  '',
  `  - your agent's settings, if it can set environment variables for every session`,
  `  - your shell profile: setx <NAME> <key> on Windows, or an export line in ~/.zshrc or ~/.bashrc`,
  '',
  'A key in a project .env is not read. Start a new session after you set the key.',
  'Never paste the key into a chat. The agent does not need to see it.',
].join('\n');

if (!provider) stop(EXIT.noKey, SETUP);
const key = keyIn(provider);

// --- the service -------------------------------------------------------------

// The pinned response shape: `answers`, holding every pattern asked, each a
// Noul with a probability, and `model`, naming the version that answered.
// The service documents `model` as required. Returns the scores, or a reason
// it is refused. `post` records the model, so a refused answer still names it.
// A model name the report can print: a string with something besides spaces.
const named = model => typeof model === 'string' && model.trim() !== '';

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
  if (!named(json.model)) {
    return { refused: 'the response names no model, so the report could not say what scored it' };
  }
  return { scores };
}

// What the run has spent, for the closing line. A request counts once the
// service answered it with any status, because that is a request it received.
// A connection that never reached the service counts for nothing. `models`
// holds each version the service said answered, in the order it said them:
// `jev-latest` is an alias, and the answer is the only place the real version
// shows. A run that ranks holds exactly one.
let sent = 0;
const models = new Set();

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
    sent++;
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
    if (json && named(json.model)) models.add(json.model);
    return scoresFrom(json);
  }
}

async function score(e) {
  const { scores, refused } = await post(bodyFor(e));
  if (refused) throw new Refused(refused);
  if (models.size > 1) {
    throw new Refused(`the service answered with ${[...models].join(' and ')}, so the scores do not compare`);
  }
  return scores;
}

// The closing line, on standard error beside any refusal, so it prints whether
// the run ranked or stopped partway. The agent passes it to the user: it is
// what the run spent.
function spent() {
  if (!sent) return;
  const answered = models.size ? ` Answered by ${[...models].join(' and ')}.` : '';
  console.error(`Sent ${requests(sent)} to ${provider.name}, charged to your key.${answered}`);
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
spent();

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

  // Under --sel the threshold is the full run's: the same controls, the same
  // rule and the same floor. It depends on the controls only, never on how
  // many edges are scored.
  const f2 = p => p.toFixed(2);
  const [model] = models;
  const lines = [box.title ?? boxPath];
  if (selCode !== undefined) lines.push(...selHeader());
  lines.push(`${ranked.length} argued edges, ranked by the ${CALIBRATED} score.`, `Scored by ${model}.`);
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
      `${e.flagged ? 'FLAG' : '    '}  ${edgeName(e)}`,
      `      ${NAMES.map(n => `${n} ${f2(e.scores[n])}`).join(', ')}`,
      `      top: ${e.top} ${f2(e.scores[e.top])}`,
      `      why: ${e.why}`,
      '',
    );
  }
  lines.push(...unscoredLines());
  console.log(lines.join('\n'));

  if (jsonPath) writeReport({ model, calibrated, threshold, ranked, controls: scoredControls });
}
